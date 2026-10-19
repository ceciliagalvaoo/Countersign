import React, { useMemo } from 'react';
import type { PreparedCall, SignPhase } from '../hooks/useSignedCall';
import { buildCardModel, type CardContext, type SignerLine } from './approvalCardModel';
import TxStatus, { type TxView } from './TxStatus';
import {
  CARD_ENFORCED,
  CARD_FOOTER_DECODED,
  LABEL_FUNDS,
  LABEL_TEST_ASSETS,
  LABEL_WALLET_CONTRACT,
  NETWORK_NOTE,
} from '../constants/labels';
import { shortAddress } from '../utils/units';

/**
 * WYSIWYS approval card (build line 1.7). Rendered ONLY from the transaction decoder's output
 * (`prepared.decoded`) plus facts the API read from the chain or the database. No text written by the
 * language model is ever passed in. The wallet popup opens only from the "Sign in your wallet" button.
 */

interface Props {
  prepared: PreparedCall;
  phase: SignPhase;
  ctx: CardContext;
  connectedKey: string | null;
  onSign: () => void;
  onCancel: () => void;
  onRetryConfirm: () => void;
  onConnect?: () => void;
}

export function phaseToView(phase: SignPhase): TxView | null {
  switch (phase.kind) {
    case 'awaiting_wallet':
      return { state: 'awaiting_signature', note: 'Your wallet is open. Check that it shows the same contract and function.' };
    case 'pending':
      return { state: 'pending', hash: phase.hash, note: phase.note };
    case 'confirmed':
      return { state: 'confirmed', hash: phase.hash };
    case 'refused_contract':
      return { state: 'refused_contract', code: phase.code, name: phase.name, detail: phase.detail };
    case 'failed':
      return { state: 'failed', message: phase.message, hash: phase.hash };
    default:
      return null;
  }
}

const SignatureRow: React.FC<{ line: SignerLine; signed: boolean; awaiting: boolean }> = ({ line, signed, awaiting }) => (
  <div className="py-2">
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm font-semibold text-gray-100">{line.who}</span>
      {line.signsThis && (
        <span className={`text-xs font-semibold ${signed ? 'text-emerald-300' : 'text-amber-300'}`}>
          {signed ? 'signed' : awaiting ? 'awaiting your signature' : 'signature required'}
        </span>
      )}
    </div>
    {line.signsThis ? (
      <div className="relative mt-1 h-px w-full bg-gray-500/30">
        {signed ? (
          <div className="cs-sign-line absolute inset-0 h-[2px] -top-px bg-emerald-400" />
        ) : (
          <div className="cs-await-pulse absolute inset-0 h-[2px] -top-px bg-amber-400" />
        )}
      </div>
    ) : null}
    <p className="mt-1 text-xs text-gray-400">{line.text}</p>
  </div>
);

const ApprovalCard: React.FC<Props> = ({ prepared, phase, ctx, connectedKey, onSign, onCancel, onRetryConfirm, onConnect }) => {
  const model = useMemo(() => buildCardModel(prepared.decoded, ctx), [prepared.decoded, ctx]);
  const signer = prepared.decoded.signer;
  const wrongWallet = !!signer && !!connectedKey && signer !== connectedKey;
  const signed = phase.kind === 'confirmed';
  const busy = phase.kind === 'awaiting_wallet' || phase.kind === 'pending';
  const canSign = prepared.check.ok && !wrongWallet && !!connectedKey && phase.kind === 'review';
  const view = phaseToView(phase);

  return (
    <section
      className="rounded-2xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.45)] text-gray-100 shadow-[0_10px_40px_rgba(0,0,0,0.35)] "
      aria-label="Approval card"
      data-testid="approval-card"
    >
      <header className="border-b border-white/20 px-5 pt-4 pb-3">
        {model.intro && <p className="text-xs text-gray-400">{model.intro}</p>}
        <h3 className="text-lg font-semibold !text-white">{model.title}</h3>
      </header>

      {!prepared.check.ok && (
        <div className="mx-5 mt-3 border-l-2 border-red-400 pl-3 text-sm" role="alert">
          <p className="font-semibold text-red-300">{'✕'} Do not sign: the decoded view does not match the transaction</p>
          <ul className="mt-1 list-disc pl-4 text-xs text-gray-100">
            {prepared.check.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-0 md:grid-cols-2">
        {/* Left: what you sign, decoded from the XDR */}
        <div className="px-5 py-4 md:border-r border-white/20">
          <p className="mb-2 text-xs uppercase tracking-wide text-gray-400">What you sign</p>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-gray-400">Network</dt>
              <dd className="font-semibold">{model.network}</dd>
              <dd className="text-[11px] text-gray-400">{NETWORK_NOTE}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">Contract</dt>
              <dd className={model.contract.recognised ? 'font-semibold' : 'font-semibold text-red-300'}>
                {!model.contract.recognised && <span aria-hidden="true">{'✕'} </span>}
                {model.contract.label}
              </dd>
              {model.contract.id && (
                <dd className="font-mono text-xs tabular-nums text-gray-400" title={model.contract.id}>
                  {shortAddress(model.contract.id)}
                </dd>
              )}
              {model.contract.isMandateWallet && <dd className="text-[11px] text-gray-400">{LABEL_WALLET_CONTRACT}</dd>}
            </div>
            <div>
              <dt className="text-xs text-gray-400">Function</dt>
              <dd className="font-mono">{model.functionName}</dd>
            </div>
            {model.args.map((a, i) => (
              <div key={`${a.label}-${i}`}>
                <dt className="text-xs text-gray-400">{a.label}</dt>
                <dd className="font-mono tabular-nums">{a.value}</dd>
                {a.raw && <dd className="font-mono text-[11px] tabular-nums text-gray-400">{a.raw}</dd>}
              </div>
            ))}
            {model.maxFee && (
              <div>
                <dt className="text-xs text-gray-400">Maximum network fee</dt>
                <dd className="font-mono tabular-nums">{model.maxFee}</dd>
              </div>
            )}
            {model.planned && (
              <div className="border-t border-dashed border-white/20 pt-2">
                <dt className="text-xs text-gray-400">{model.planned.label}</dt>
                <dd className="font-mono tabular-nums">{model.planned.value}</dd>
                {model.planned.note && <dd className="text-[11px] text-gray-400">{model.planned.note}</dd>}
              </div>
            )}
          </dl>
        </div>

        {/* Right: who must sign, what you could lose */}
        <div className="px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Who must sign</p>
          <div className="divide-y divide-white/10">
            {model.signers.map((s) => (
              <SignatureRow key={s.who} line={s} signed={s.signsThis && signed} awaiting={phase.kind === 'awaiting_wallet'} />
            ))}
          </div>
          {signer && (
            <p className="mt-1 text-[11px] text-gray-400">
              Signing account: <span className="font-mono tabular-nums">{shortAddress(signer)}</span>
            </p>
          )}

          <p className="mt-4 text-xs uppercase tracking-wide text-gray-400">What you could lose</p>
          <ul className="mt-1 space-y-1 text-sm">
            {model.loss.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {model.showFundsLabel && <p className="mt-1 text-[11px] text-gray-400">{LABEL_FUNDS}</p>}
          {model.showEnforced && <p className="mt-3 text-sm font-semibold">{CARD_ENFORCED}</p>}
        </div>
      </div>

      <div className="border-t border-white/20 px-5 py-3">
        {view && <TxStatus view={view} onRetry={onRetryConfirm} />}
        {phase.kind === 'review' && phase.notice && <p className="mb-2 text-xs text-gray-100">{phase.notice}</p>}
        {!signed && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!connectedKey ? (
              <button onClick={onConnect} className="rounded bg-primary-700 hover:bg-primary-600 px-4 py-2 text-sm font-semibold text-white">
                Connect your wallet
              </button>
            ) : wrongWallet ? (
              <p className="text-sm text-gray-100">
                Connect the wallet <span className="font-mono">{shortAddress(signer)}</span> to sign this.
              </p>
            ) : (
              <button
                onClick={onSign}
                disabled={!canSign}
                className="rounded bg-primary-700 hover:bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy ? 'Waiting...' : 'Sign in your wallet'}
              </button>
            )}
            {!busy && (
              <button onClick={onCancel} className="px-3 py-2 text-sm text-gray-400 underline underline-offset-2">
                Not now
              </button>
            )}
          </div>
        )}
        {signed && (
          <button onClick={onCancel} className="mt-2 px-3 py-1 text-sm text-gray-400 underline underline-offset-2">
            Close
          </button>
        )}
      </div>

      <footer className="rounded-b-md border-t border-white/20 bg-white/[0.04] px-5 py-2 text-[11px] text-gray-400">
        <p>{LABEL_TEST_ASSETS}</p>
        <p>{CARD_FOOTER_DECODED}</p>
      </footer>
    </section>
  );
};

export default ApprovalCard;
