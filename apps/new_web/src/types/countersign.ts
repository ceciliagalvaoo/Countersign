/**
 * Shapes consumed by the /agent page from the Countersign API and from apps/agent
 * (projeto/Agents/README.md section 6). Where the owner has not published a shape yet, the adapter
 * below is the single place to reconcile it.
 */

// ---------- apps/agent: GET /session/:id ----------

export type NodeState = 'pending' | 'active' | 'done' | 'refused' | 'interrupted' | 'skipped';

export interface PlanNode {
  id: string;
  label: string;
  state: NodeState;
  rule?: string | null;
  detail?: string | null;
  updatedAt?: string;
}

export interface ToolCallLog {
  id: string;
  turn: number;
  tool: string;
  input: unknown;
  output: unknown;
  isError: boolean;
  durationMs: number;
  at: string;
}

export interface TranscriptEntry {
  role: 'investor' | 'agent';
  text: string;
  turn: number;
  at: string;
  flags?: string[];
}

export interface PendingAction {
  /** awaiting_execution: APPROVED, the agent executes it unless interrupted; needs_investor_signature: allow_fund */
  kind: 'awaiting_execution' | 'needs_investor_signature' | string;
  fundId: string;
  decisionSeq: number | null;
  createdAt: string;
}

export interface AgentSessionView {
  sessionId: string;
  mandateDraft: Record<string, unknown> | null;
  mandateStatus: string | null;
  missingFields: string[] | null;
  plan: { nodes: PlanNode[]; focusFundId?: string | null; interrupted?: boolean;
    purchaseRef?: { orderId?: string | null; subscribeTxHash?: string | null; decision?: string | null; decisionSeq?: number | null } | null };
  turns: number;
  lastToolCalls: ToolCallLog[];
  pendingAction: PendingAction | null;
  interrupted?: boolean;
  transcript: TranscriptEntry[];
  updatedAt?: string;
}

/** POST /session/:id/recurring (apps/agent, line 3.1) */
export type RecurringStatus =
  | 'scheduled'
  | 'not_preauthorised'
  | 'fund_not_preauthorised'
  | 'fund_not_in_allowlist'
  | 'refused'
  | 'failed';

export interface RecurringResponse extends AgentSessionView {
  recurring: {
    status: RecurringStatus;
    message: string;
    decision: { seq: number; outcome: string; rule: string; explanation: string } | null;
    holdMs: number | null;
  };
  label?: string;
}

// ---------- API: GET /api/mandates ----------

export interface MandateOverview {
  draft: Record<string, unknown> | null;
  complete: boolean;
  mandateHash: string | null;
  missing: { path: string; message: string }[] | null;
  approved: { version: number; mandateHash: string; approvedAt: string; onChainTxHash: string | null; mandate: Record<string, unknown> } | null;
  onChainMandateHash: string | null;
  active: boolean;
}

export interface ApproveMandateResponse {
  status: 'APPROVED';
  active: boolean;
  version: number;
  mandateHash: string;
  setLimits: { perTxCapUnits: string; periodCapUnits: string; periodSecs: number; mandateHashHex: string };
}

// ---------- API: decision log ----------

export interface DecisionLogPayload {
  kind: 'decision' | 'onchain_event';
  seq: number;
  userId: string;
  at: string;
  origin?: string;
  fundId?: string | null;
  amountUnits?: string | null;
  rule: string;
  outcome: string;
  mandateHash?: string | null;
  toolCallId?: string | null;
  txHash?: string;
}

export interface DecisionLogEntry {
  seq: number;
  prevHash: string;
  hash: string;
  payload: DecisionLogPayload;
  createdAt: string;
}

export type ChainVerifyResult =
  | { ok: true; count: number; headHash: string }
  | { ok: false; count: number; firstBadSeq: number; reason: string };

// ---------- API: GET /api/mandate-wallet (shape PROVISIONAL, owner stellar-integrator) ----------

export interface AllowedFund {
  fundId: string | null;
  name: string | null;
  symbol: string | null;
  fundWallet: string;
  fundToken: string | null;
  capUnits: string | null;
  spentUnits: string | null;
}

export interface WalletState {
  contractId: string;
  owner: string | null;
  agent: string | null;
  revoked: boolean;
  limits: { perTxCapUnits: string; periodCapUnits: string; periodSecs: number } | null;
  mandateHash: string | null;
  spentInPeriodUnits: string | null;
  usdcBalanceUnits: string | null;
  funds: AllowedFund[];
}

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === 'object' ? null : String(v));

/** Accepts { wallet: {...} }, the wallet object itself, or { wallet: null } / { exists: false } */
export function toWalletState(raw: unknown): WalletState | null {
  if (!raw || typeof raw !== 'object') return null;
  const outer = raw as Raw;
  const w = (outer.wallet !== undefined ? outer.wallet : outer) as Raw | null;
  if (!w || typeof w !== 'object' || w.exists === false) return null;
  const contractId = s(w.contractId) ?? s(w.address) ?? s(w.walletContractId);
  if (!contractId) return null;
  const l = (w.limits ?? null) as Raw | null;
  const fundsRaw = Array.isArray(w.funds) ? w.funds : Array.isArray(w.allowedFunds) ? w.allowedFunds : [];
  return {
    contractId,
    owner: s(w.owner),
    agent: s(w.agent),
    revoked: Boolean(w.revoked ?? w.isRevoked),
    limits: l
      ? {
          perTxCapUnits: s(l.perTxCapUnits) ?? s(l.perTxCap) ?? s(l.per_tx_cap) ?? '0',
          periodCapUnits: s(l.periodCapUnits) ?? s(l.periodCap) ?? s(l.period_cap) ?? '0',
          periodSecs: Number(l.periodSecs ?? l.period_secs ?? 0),
        }
      : null,
    mandateHash: s(w.mandateHash) ?? s(w.mandate_hash),
    spentInPeriodUnits: s(w.spentInPeriodUnits) ?? s(w.spentInPeriod),
    usdcBalanceUnits: s(w.usdcBalanceUnits) ?? s(w.usdcBalance) ?? s(w.balanceUnits),
    funds: (fundsRaw as Raw[]).map((f) => ({
      fundId: s(f.fundId),
      name: s(f.name),
      symbol: s(f.symbol),
      fundWallet: s(f.fundWallet) ?? s(f.fund_wallet) ?? '',
      fundToken: s(f.fundToken) ?? s(f.fund_token),
      capUnits: s(f.capUnits) ?? s(f.cap) ?? s(f.fundCap),
      spentUnits: s(f.spentUnits) ?? s(f.spent),
    })),
  };
}

/** What the API returns when it built a transaction for a wallet to sign */
export interface BuiltTransaction {
  transactionXdr: string;
  decoded?: unknown;
  signer?: string;
}

// ---------- API: orders (extended with payerAddress and decisionHash) ----------

export interface OrderRow {
  id: string;
  quantity: number;
  total: number;
  status: string;
  approvalStatus: string;
  txHash: string | null;
  tokenMintTxHash: string | null;
  refundTxHash: string | null;
  payerAddress: string | null;
  decisionHash: string | null;
  createdAt: string;
  fund: { id: string; name: string; symbol: string };
}

// ---------- API: funds (subset used to label addresses) ----------

export interface FundRef {
  id: string;
  name: string;
  symbol: string;
  fundWalletPublicKey?: string | null;
  tokenContractId?: string | null;
  maxSacadoConcentrationPercent?: number | null;
  investorProfile?: string | null;
}

// ---------- API: GET /api/mandate-wallet/purchases (stellar-integrator) ----------

export type PurchaseStatus = 'PENDING_NETWORK' | 'CONFIRMED_AWAITING_ISSUER' | 'COUNTERSIGNED' | 'REFUNDED' | 'FAILED';

export interface Purchase {
  orderId: string;
  status: PurchaseStatus;
  decision: string | null;
  decisionSeq: number | null;
  fund: { id: string; name: string; symbol: string };
  amountUsdc: string;
  units: string;
  payer: string | null;
  subscribeTxHash: string | null;
  mintTxHash: string | null;
  refundTxHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchasesResponse {
  network: string;
  inFlight: { decisionSeq: number; status: 'PENDING_NETWORK'; executionStatus: string; since: string }[];
  purchases: Purchase[];
}
