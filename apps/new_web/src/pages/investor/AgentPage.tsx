import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import * as StellarSdk from '@stellar/stellar-sdk';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import { useWallet } from '../../contexts/WalletContext';
import { fundService } from '../../services/api';
import { agentClient } from '../../services/agentClient';
import {
  decisionLogService,
  mandateService,
  mandateWalletService,
  stellarConfigService,
} from '../../services/countersign';
import type {
  AgentSessionView,
  ChainVerifyResult,
  DecisionLogEntry,
  FundRef,
  MandateOverview,
  PurchasesResponse,
  WalletState,
} from '../../types/countersign';
import { useSignedCall } from '../../hooks/useSignedCall';
import type { CardContext } from '../../components/approvalCardModel';
import ApprovalCard from '../../components/ApprovalCard';
import EvidencePanel from '../../components/EvidencePanel';
import TxStatus, { type TxView } from '../../components/TxStatus';
import AgentChat from '../../components/agent/AgentChat';
import MandatePanel from '../../components/agent/MandatePanel';
import PlanDag from '../../components/agent/PlanDag';
import WalletSetup from '../../components/agent/WalletSetup';
import { currentPlanNodes, inFlightViews, isInFlight, latestPurchase as pickLatest, planPurchase, purchaseViews } from '../../components/agent/purchaseStatus';
import { errorText, parseContractError } from '../../utils/contractErrors';
import { LABEL_RECURRING, LABEL_TEST_ASSETS, NETWORK_LABEL, PRODUCT_NAME, TAGLINE } from '../../constants/labels';

/**
 * /agent (investor only): chat | typed mandate + plan | approval card or evidence (09 section 2.2 grid).
 * Every signature goes through the approval card rendered from the decoder; every "done" comes from the
 * API's verification of the confirmed transaction.
 */

type ActiveCall = 'deploy' | 'deposit' | 'set_limits' | 'allow_fund' | 'revoke_agent';

const SESSION_POLL_MS = 1500;
const CHAIN_POLL_MS = 4000;

function sessionKey(userId: string) {
  return `countersign.agentSession.${userId}`;
}

function newSessionId() {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `cs_${rnd.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 60);
}

const AgentPage: React.FC = () => {
  const { user } = useAuth();
  const { publicKey, connect } = useWallet();
  const flow = useSignedCall();
  const { prepare } = flow;

  const [sessionId, setSessionId] = useState<string>(() => {
    if (!user) return newSessionId();
    const saved = localStorage.getItem(sessionKey(user.id));
    if (saved) return saved;
    const id = newSessionId();
    localStorage.setItem(sessionKey(user.id), id);
    return id;
  });
  const [session, setSession] = useState<AgentSessionView | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [controlBusy, setControlBusy] = useState(false);

  const [overview, setOverview] = useState<MandateOverview | null>(null);
  const [mandateError, setMandateError] = useState<string | null>(null);
  const [mandateBusy, setMandateBusy] = useState(false);

  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [usdcContractId, setUsdcContractId] = useState<string | null>(null);
  const [funds, setFunds] = useState<Record<string, FundRef>>({});

  const [log, setLog] = useState<DecisionLogEntry[]>([]);
  const [verify, setVerify] = useState<ChainVerifyResult | null>(null);
  const [purchases, setPurchases] = useState<PurchasesResponse | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const evidenceRequest = useRef(0);

  const [active, setActive] = useState<ActiveCall | null>(null);
  const [plannedSeq, setPlannedSeq] = useState<number | null>(null);
  const [recurringView, setRecurringView] = useState<TxView | null>(null);
  const [recurringNote, setRecurringNote] = useState<string | null>(null);
  const [recurringLabel, setRecurringLabel] = useState<string | null>(null);
  /** End of the interruption window of a scheduled recurring purchase (ms since epoch) */
  const [holdUntil, setHoldUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // ---------- reads ----------

  const refreshSession = useCallback(async () => {
    try {
      const s = await agentClient.session(sessionId);
      setSession(s);
    } catch (e) {
      setChatError(`Agent service: ${errorText(e)}`);
    }
  }, [sessionId]);

  const refreshOverview = useCallback(async () => {
    try {
      setOverview(await mandateService.overview());
    } catch (e) {
      setMandateError(errorText(e));
    }
  }, []);

  const refreshWallet = useCallback(async () => {
    setWalletLoading(true);
    try {
      setWallet(await mandateWalletService.get());
    } catch (e) {
      // Leave the last known state; the setup shows the error only through its refresh
      console.error('mandate wallet read failed', errorText(e));
    } finally {
      setWalletLoading(false);
    }
  }, []);

  const refreshEvidence = useCallback(async (withVerify = false) => {
    const version = ++evidenceRequest.current;
    setEvidenceLoading(true);
    try {
      const [entries, ps] = await Promise.allSettled([
        decisionLogService.list(),
        mandateWalletService.purchases(),
      ]);
      if (version !== evidenceRequest.current) return;
      if (entries.status === 'fulfilled') setLog(entries.value);
      else console.error('decision log read failed', errorText(entries.reason));
      if (ps.status === 'fulfilled') { setPurchases(ps.value); setPurchaseError(null); }
      else setPurchaseError('Purchase status could not be refreshed. Showing the last known state.');
      if (withVerify) {
        const checked = await decisionLogService.verify();
        if (version === evidenceRequest.current) setVerify(checked);
      }
    } catch (e) {
      console.error('evidence read failed', errorText(e));
    } finally {
      if (version === evidenceRequest.current) setEvidenceLoading(false);
    }
  }, []);

  const loadFund = useCallback(
    async (fundId: string) => {
      if (funds[fundId]) return;
      try {
        const r = await fundService.getById(fundId);
        const f = r.fund as FundRef;
        setFunds((prev) => ({ ...prev, [fundId]: f }));
      } catch {
        // Unknown fund: its addresses show as "Unrecognised address" on the card
      }
    },
    [funds],
  );

  useEffect(() => {
    void refreshSession();
    void refreshOverview();
    void refreshWallet();
    void refreshEvidence(true);
    stellarConfigService
      .get()
      .then((c) => {
        if (c.paymentAsset?.code && c.paymentAsset.issuer) {
          setUsdcContractId(new StellarSdk.Asset(c.paymentAsset.code, c.paymentAsset.issuer).contractId(StellarSdk.Networks.TESTNET));
        }
      })
      .catch(() => undefined);
  }, [refreshSession, refreshOverview, refreshWallet, refreshEvidence]);

  // The mandate panel follows the agent: re-read the stored draft whenever the session changes
  const sessionStamp = `${session?.turns ?? 0}:${session?.updatedAt ?? ''}`;
  useEffect(() => {
    if (session) void refreshOverview();
  }, [sessionStamp, session, refreshOverview]);

  // ---------- derived ----------

  const nodes = useMemo(() => currentPlanNodes(session?.plan, purchases), [session, purchases]);
  const focusedPurchase = useMemo(() => planPurchase(session?.plan, purchases), [session, purchases]);
  const focusFundId = session?.pendingAction?.fundId ?? session?.plan?.focusFundId ?? null;
  const signatureNeeded =
    session?.pendingAction?.kind === 'needs_investor_signature' || nodes.some((n) => n.id === 'investor_signature' && n.state === 'active');
  const latestPurchase = useMemo(() => pickLatest(purchases), [purchases]);
  const purchaseInFlight = isInFlight(purchases);
  const anyActiveNode = nodes.some((n) => n.state === 'active');
  const purchaseNode = nodes.find((n) => n.id === 'agent_purchase');
  const canStop = !!purchaseNode && (purchaseNode.state === 'active' || (purchaseNode.state === 'pending' && !!session?.plan?.focusFundId && nodes.some((n) => n.id === 'proposal' && n.state === 'done')));
  const interrupted = !!(session?.plan?.interrupted ?? session?.interrupted);

  // A decision APPROVED by the policy that the agent has not executed yet (it executes it through its own
  // tool; there is no manual execution button). Shown until the purchases endpoint knows about it.
  const awaitingExecution = useMemo(() => {
    const pa = session?.pendingAction;
    if (pa?.kind === 'awaiting_execution') {
      const e = log.find((x) => x.seq === pa.decisionSeq);
      const known =
        purchases?.inFlight.some((f) => f.decisionSeq === pa.decisionSeq) || purchases?.purchases.some((p) => p.decisionSeq === pa.decisionSeq);
      if (e && !known) return e;
    }
    if (!purchaseNode || (purchaseNode.state !== 'pending' && purchaseNode.state !== 'active')) return null;
    if (!nodes.some((n) => n.id === 'proposal' && n.state === 'done')) return null;
    if (!nodes.some((n) => n.id === 'investor_signature' && (n.state === 'skipped' || n.state === 'done'))) return null;
    const fundId = session?.plan?.focusFundId ?? null;
    const entry = [...log].reverse().find((e) => e.payload.kind === 'decision' && e.payload.outcome === 'APPROVED' && (!fundId || e.payload.fundId === fundId));
    if (!entry) return null;
    const known =
      purchases?.inFlight.some((f) => f.decisionSeq === entry.seq) ||
      purchases?.purchases.some((p) => p.decisionSeq === entry.seq || p.decision?.toLowerCase() === entry.hash.toLowerCase());
    return known ? null : entry;
  }, [purchaseNode, nodes, session, log, purchases]);

  useEffect(() => {
    if (focusFundId) void loadFund(focusFundId);
  }, [focusFundId, loadFund]);

  // ---------- polling: only while something is moving ----------

  useEffect(() => {
    if (!(sending || anyActiveNode || purchaseInFlight || awaitingExecution || holdUntil !== null)) return;
    const t = window.setInterval(() => void refreshSession(), SESSION_POLL_MS);
    return () => window.clearInterval(t);
  }, [sending, anyActiveNode, purchaseInFlight, awaitingExecution, holdUntil, refreshSession]);

  useEffect(() => {
    if (!(purchaseInFlight || sending || awaitingExecution || holdUntil !== null)) return;
    const t = window.setInterval(() => void refreshEvidence(false), CHAIN_POLL_MS);
    return () => window.clearInterval(t);
  }, [purchaseInFlight, sending, awaitingExecution, holdUntil, refreshEvidence]);

  // ---------- chat ----------

  const send = async (message: string) => {
    setSending(true);
    setPendingMessage(message);
    setChatError(null);
    try {
      const r = await agentClient.chat(sessionId, message);
      setSession(r);
    } catch (e) {
      setChatError(`The agent did not answer: ${errorText(e)}. Nothing was proposed or bought.`);
      void refreshSession();
    } finally {
      setPendingMessage(null);
      setSending(false);
      void refreshEvidence(false);
    }
  };

  const newConversation = () => {
    if (!user) return;
    const id = newSessionId();
    localStorage.setItem(sessionKey(user.id), id);
    setSessionId(id);
    setSession(null);
  };

  const control = async (fn: () => Promise<AgentSessionView>) => {
    setControlBusy(true);
    try {
      setSession(await fn());
    } catch (e) {
      setChatError(`Agent service: ${errorText(e)}`);
    } finally {
      setControlBusy(false);
    }
  };

  // ---------- signatures (all through the card) ----------

  const afterConfirm = useCallback(() => {
    void refreshWallet();
    void refreshOverview();
    void refreshEvidence(true);
  }, [refreshWallet, refreshOverview, refreshEvidence]);

  const startDeploy = () => {
    if (!publicKey) return;
    setActive('deploy');
    void flow.prepare({ build: () => mandateWalletService.buildDeploy(publicKey), confirm: (h) => mandateWalletService.confirmDeploy(h) });
  };

  const startDeposit = (amountUsdc: string) => {
    setActive('deposit');
    void flow.prepare({ build: () => mandateWalletService.buildDeposit(amountUsdc), confirm: (h) => mandateWalletService.confirmDeposit(h, amountUsdc) });
  };

  // The API reads per_tx_cap, period_cap, period_secs and mandate_hash from the approved mandate
  const startSetLimits = () => {
    setActive('set_limits');
    void flow.prepare({
      build: () => mandateWalletService.buildCall('set_limits'),
      confirm: (h) => mandateWalletService.confirmCall(h, 'set_limits'),
    });
  };

  const startAllowFund = useCallback(
    (fundId: string, decisionSeq: number | null, fundCapUsdc: string) => {
      setActive('allow_fund');
      setPlannedSeq(decisionSeq);
      const params = { fundId, fundCapUsdc };
      void prepare({
        build: () => mandateWalletService.buildCall('allow_fund', params),
        confirm: (h) => mandateWalletService.confirmCall(h, 'allow_fund', params),
      });
    },
    [prepare],
  );

  const startRevoke = () => {
    setActive('revoke_agent');
    void flow.prepare({ build: () => mandateWalletService.buildCall('revoke_agent'), confirm: (h) => mandateWalletService.confirmCall(h, 'revoke_agent') });
  };

  // When the agent's plan waits for the investor's allow_fund signature, prepare the card (no signing)
  const decisionForFund = useMemo(() => {
    if (!focusFundId) return null;
    const seq = session?.pendingAction?.decisionSeq ?? null;
    const entry =
      (seq !== null ? log.find((e) => e.seq === seq) : undefined) ??
      [...log].reverse().find((e) => e.payload.fundId === focusFundId && e.payload.outcome === 'NEEDS_INVESTOR_SIGNATURE');
    return entry ? { seq: entry.seq, amountUnits: entry.payload.amountUnits ?? null } : seq !== null ? { seq, amountUnits: null } : null;
  }, [focusFundId, session, log]);

  // Default cap for a newly approved fund: the per purchase cap of her approved mandate (team decision f,
  // 18/10). She can change it before the card is built; the card shows the value in the XDR, from the decoder.
  const defaultFundCap = overview?.approved?.mandate?.perPurchaseCapUsdc != null ? String(overview.approved.mandate.perPurchaseCapUsdc) : '';
  const [fundCapUsdc, setFundCapUsdc] = useState('');
  const capValue = fundCapUsdc || defaultFundCap;
  const capValid = /^\d+(\.\d{1,7})?$/.test(capValue) && Number(capValue) > 0;

  // No auto build: she reviews (and may edit) the cap first, then the card is built from the decoder

  useEffect(() => {
    if (flow.phase.kind === 'confirmed') afterConfirm();
  }, [flow.phase.kind, afterConfirm]);

  const closeCard = () => {
    flow.reset();
    setActive(null);
  };

  // ---------- mandate ----------

  const approveMandate = async () => {
    if (!overview?.mandateHash) return;
    setMandateBusy(true);
    setMandateError(null);
    try {
      await mandateService.approve(overview.mandateHash);
      const fresh = await mandateService.overview();
      setOverview(fresh);
      // Without a wallet the deploy carries the approved limits and hash (S0). With a wallet, set_limits
      // only when the on-chain mandate hash differs from the newly approved one.
      if (wallet && !fresh.active) startSetLimits();
    } catch (e) {
      setMandateError(errorText(e));
      void refreshOverview();
    } finally {
      setMandateBusy(false);
    }
  };

  // ---------- recurring ----------

  const RECURRING_WORDS: Record<string, string> = {
    not_preauthorised: 'Not run: your mandate has no pre-authorised recurring purchase.',
    fund_not_preauthorised: 'Not run: this fund is not in the recurring part of your mandate.',
    fund_not_in_allowlist: 'Not run: the fund is not in your wallet allowlist yet; the first purchase needs your signature.',
    failed: 'Not run: the policy could not be reached. Nothing was bought.',
  };

  const runRecurring = async () => {
    setRecurringView(null);
    setRecurringNote(null);
    setHoldUntil(null);
    setControlBusy(true);
    try {
      const r = await agentClient.recurring(sessionId);
      setSession(r);
      setRecurringLabel(r.label ?? null);
      const rec = r.recurring;
      if (rec.status === 'scheduled') {
        const hold = rec.holdMs ?? 15_000;
        setHoldUntil(Date.now() + hold);
        setNow(Date.now());
        setRecurringNote(
          `Approved by the policy${rec.decision ? ` (decision #${rec.decision.seq}, rule ${rec.decision.rule})` : ''}. The agent executes it when the window closes unless you interrupt.`,
        );
      } else if (rec.status === 'refused') {
        setRecurringView({ state: 'refused_policy', rule: rec.decision?.rule ?? 'policy', detail: rec.decision?.explanation ?? rec.message });
      } else {
        setRecurringNote(RECURRING_WORDS[rec.status] ?? rec.message);
      }
      void refreshEvidence(false);
    } catch (e) {
      const contract = parseContractError(e);
      if (contract) setRecurringView({ state: 'refused_contract', ...contract });
      else if (axios.isAxiosError(e) && e.response?.status === 409) setRecurringNote(`Not run: ${errorText(e)}`);
      else if (axios.isAxiosError(e) && e.response?.status === 501) setRecurringNote(`Not available yet: ${errorText(e)}`);
      else setRecurringNote(`Not run: ${errorText(e)}. Nothing was bought.`);
      void refreshSession();
    } finally {
      setControlBusy(false);
    }
  };

  // Visible countdown of the interruption window (only while it is open)
  useEffect(() => {
    if (holdUntil === null) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [holdUntil]);
  const holdLeftMs = holdUntil === null ? 0 : Math.max(0, holdUntil - now);
  const windowOpen = holdUntil !== null && holdLeftMs > 0 && !interrupted;
  // Once the window closed and the decision is no longer waiting, the purchase status block takes over
  useEffect(() => {
    if (holdUntil !== null && holdLeftMs === 0 && !interrupted && !awaitingExecution && session?.pendingAction?.kind !== 'awaiting_execution') {
      setHoldUntil(null);
    }
  }, [holdUntil, holdLeftMs, interrupted, awaitingExecution, session]);

  // ---------- card context: facts from the API and the chain only ----------

  const cardCtx: CardContext = useMemo(
    () => ({
      userPublicKey: publicKey,
      walletContractId: wallet?.contractId ?? null,
      agentPublicKey: wallet?.agent ?? null,
      usdcContractId,
      funds: [
        ...Object.values(funds),
        ...(wallet?.funds ?? [])
          .filter((f) => f.name && f.symbol)
          .map((f) => ({ id: f.fundId ?? f.fundWallet, name: f.name!, symbol: f.symbol!, fundWalletPublicKey: f.fundWallet, tokenContractId: f.fundToken })),
      ],
      walletLimits: wallet?.limits ?? null,
      plannedPurchase:
        active === 'allow_fund' && decisionForFund?.amountUnits && (plannedSeq === null || plannedSeq === decisionForFund.seq)
          ? { amountUnits: decisionForFund.amountUnits, seq: decisionForFund.seq }
          : null,
      audience: 'investor',
    }),
    [publicKey, wallet, usdcContractId, funds, active, decisionForFund, plannedSeq],
  );

  if (user && user.role !== 'INVESTIDOR') return <Navigate to="/dashboard" replace />;

  const turns = session?.turns ?? 0;
  const liveToolCalls = sending && session ? session.lastToolCalls.filter((c) => c.turn > turns) : [];
  const showCard = flow.phase.kind !== 'idle';

  return (
    <div className="min-h-full">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2 text-white">
        <div>
          <h1 className="text-2xl font-semibold !text-white">{PRODUCT_NAME}</h1>
          <p className="text-sm text-white/80">{TAGLINE}</p>
        </div>
        <div className="text-right text-xs text-white/80">
          <p>
            Network: <span className="font-semibold text-white">{NETWORK_LABEL}</span>
          </p>
          <p>{LABEL_TEST_ASSETS}</p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Left: chat */}
        <div className="flex flex-col gap-4">
          <AgentChat
            transcript={session?.transcript ?? []}
            sending={sending}
            pendingMessage={pendingMessage}
            liveToolCalls={liveToolCalls}
            turns={turns}
            error={chatError}
            onSend={send}
            onNewConversation={newConversation}
          />
        </div>

        {/* Centre: mandate, plan, controls */}
        <div className="flex flex-col gap-4">
          <MandatePanel
            overview={overview}
            sessionDraft={session?.mandateDraft ?? null}
            sessionMissing={session?.missingFields ?? null}
            turns={turns}
            hasWallet={!!wallet}
            busy={mandateBusy || showCard}
            error={mandateError}
            onApprove={approveMandate}
            onAnchor={startSetLimits}
          />
          <PlanDag
            nodes={nodes}
            interrupted={interrupted}
            busy={controlBusy}
            available={!!session}
            purchaseLabel={focusedPurchase ? `${focusedPurchase.fund.symbol} · Decision #${focusedPurchase.decisionSeq ?? 'unknown'}` : undefined}
            statusError={purchaseError}
            onRefresh={() => void refreshEvidence(false)}
            refreshing={evidenceLoading}
            onInterrupt={() => control(() => agentClient.interrupt(sessionId))}
            onResume={() => control(() => agentClient.resume(sessionId))}
          />
          <section className="rounded-2xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.45)] p-4 text-gray-100" aria-label="Controls">
            <h3 className="text-base font-semibold !text-white">Controls</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={runRecurring} disabled={controlBusy || !session || interrupted} className="rounded bg-primary-700 hover:bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                Run recurring now
              </button>
              {canStop && !interrupted && (
                <button onClick={() => control(() => agentClient.interrupt(sessionId))} disabled={controlBusy} className="rounded border border-white/40 px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
                  Stop
                </button>
              )}
              {wallet && !wallet.revoked && (
                <button onClick={startRevoke} disabled={showCard} className="rounded border border-red-400 px-3 py-1.5 text-xs font-semibold text-red-300 disabled:opacity-40">
                  Revoke agent
                </button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-gray-400">{LABEL_RECURRING}</p>
            {wallet?.revoked && <p className="mt-1 text-xs font-semibold text-red-300">{'✕'} Agent revoked: our wallet contract on Stellar (not audited) refuses its purchases.</p>}
            {windowOpen && (
              <div className="mt-3 rounded border border-amber-400 p-3" role="status" aria-live="polite">
                <p className="text-sm font-semibold text-amber-300">
                  Scheduled: executes in <span className="font-mono tabular-nums">{Math.ceil(holdLeftMs / 1000)}</span> s, pending, not done
                </p>
                <button
                  onClick={() => control(() => agentClient.interrupt(sessionId))}
                  disabled={controlBusy}
                  className="mt-2 w-full rounded bg-primary-700 hover:bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Interrupt
                </button>
              </div>
            )}
            {holdUntil !== null && interrupted && (
              <p className="mt-2 text-xs font-semibold text-gray-100">Interrupted: the recurring purchase was not executed. Resume to execute it.</p>
            )}
            {holdUntil !== null && !windowOpen && !interrupted && (
              <p className="mt-2 text-xs text-amber-300">Window closed: the agent is executing it. Pending, not done until the API verifies the payment.</p>
            )}
            {recurringView && <div className="mt-2"><TxStatus view={recurringView} /></div>}
            {recurringNote && <p className="mt-2 text-xs text-gray-100">{recurringNote}</p>}
            {recurringLabel && <p className="mt-2 text-[11px] text-gray-400">{recurringLabel}</p>}
          </section>
        </div>

        {/* Right: card or evidence */}
        <div className="flex flex-col gap-4">
          {!showCard && (
            <WalletSetup wallet={wallet} loading={walletLoading} flowBusy={showCard} mandateApproved={!!overview?.approved} onCreate={startDeploy} onDeposit={startDeposit} onRefresh={refreshWallet} />
          )}
          {showCard && flow.prepared && (
            <ApprovalCard
              prepared={flow.prepared}
              phase={flow.phase}
              ctx={cardCtx}
              connectedKey={publicKey}
              onSign={flow.sign}
              onCancel={closeCard}
              onRetryConfirm={flow.retryConfirm}
              onConnect={connect}
            />
          )}
          {showCard && !flow.prepared && (
            <section className="rounded-2xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.45)] p-4 text-sm text-gray-100">
              {flow.phase.kind === 'preparing' ? (
                <p>Building and decoding the transaction...</p>
              ) : (
                (() => {
                  const v = flow.phase.kind === 'refused_contract'
                    ? ({ state: 'refused_contract', code: flow.phase.code, name: flow.phase.name, detail: flow.phase.detail } as TxView)
                    : flow.phase.kind === 'failed'
                      ? ({ state: 'failed', message: flow.phase.message } as TxView)
                      : null;
                  return v ? <TxStatus view={v} /> : null;
                })()
              )}
              {flow.phase.kind !== 'preparing' && (
                <button onClick={closeCard} className="mt-2 text-xs text-gray-400 underline underline-offset-2">
                  Close
                </button>
              )}
            </section>
          )}
          {signatureNeeded && !showCard && wallet && focusFundId && (
            <section className="rounded-md border border-amber-400 bg-white/[0.04] p-4 text-sm text-gray-100">
              <p className="font-semibold text-amber-300">awaiting your signature</p>
              <p className="text-xs">The plan waits for your approval of a new fund.</p>
              <label className="mt-2 flex items-center gap-2 text-xs">
                Cap for this fund
                <input
                  value={capValue}
                  onChange={(e) => setFundCapUsdc(e.target.value)}
                  inputMode="decimal"
                  className="w-28 rounded border border-white/[0.12] bg-white/5 px-2 py-1 font-mono tabular-nums text-gray-100"
                />
                USDC
              </label>
              <button onClick={() => startAllowFund(focusFundId, decisionForFund?.seq ?? null, capValue)} disabled={!capValid} className="mt-2 rounded bg-primary-700 hover:bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                Review the card
              </button>
            </section>
          )}
          {active === 'allow_fund' && flow.phase.kind === 'confirmed' && (
            <button onClick={() => void send('I signed the approval for this fund. Please continue.')} disabled={sending} className="rounded bg-white/[0.04] px-3 py-2 text-xs font-semibold text-gray-100 disabled:opacity-40">
              Tell the agent to continue
            </button>
          )}
          {awaitingExecution && (
            <section className="rounded-2xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.45)] p-4 text-gray-100" aria-label="Approved decision">
              <TxStatus
                title="Agent payment"
                view={{
                  state: 'pending',
                  note: `Decision #${awaitingExecution.seq} approved by policy (${awaitingExecution.payload.rule}); the agent executes it within your mandate. Not submitted yet.`,
                }}
              />
            </section>
          )}
          {inFlightViews(purchases).map((v, i) => (
            <section key={`f${i}`} className="rounded-2xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.45)] p-4 text-gray-100">
              <TxStatus view={v} title="Agent payment" />
            </section>
          ))}
          {latestPurchase && (
            <section className="rounded-2xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.45)] p-4 text-gray-100" aria-label="Latest purchase">
              <h3 className="text-base font-semibold !text-white">Latest agent purchase</h3>
              <p className="text-xs text-gray-400">
                {latestPurchase.fund.name} ({latestPurchase.fund.symbol}),{' '}
                <span className="font-mono tabular-nums text-gray-100">{latestPurchase.amountUsdc}</span> USDC
              </p>
              {purchaseError && <p role="status" className="mt-2 text-xs text-amber-300">{purchaseError}</p>}
              <div className="mt-2 space-y-2">
                {purchaseViews(latestPurchase, log).map((v, i) => (
                  <TxStatus key={i} view={v} title={i === 0 ? 'Agent payment' : 'Issuer'} />
                ))}
              </div>
            </section>
          )}
          {!showCard && (
            <EvidencePanel entries={log} verify={verify} purchases={purchases?.purchases ?? []} loading={evidenceLoading} onRefresh={() => void refreshEvidence(true)} />
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentPage;
