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
      <span className="font-display text-20 font-medium text-navy">{line.who}</span>
      {line.signsThis && (
        <span className={`text-12 font-medium ${signed ? 'text-cobalt' : 'text-ochre'}`}>
          {signed ? 'signed' : awaiting ? 'awaiting your signature' : 'signature required'}
        </span>
      )}
    </div>
    {line.signsThis ? (
      // The signature line: an empty ochre line breathes until she signs, then her stroke is drawn in ink
      <svg viewBox="0 0 300 16" preserveAspectRatio="none" className="mt-1 h-4 w-full" aria-hidden="true" fill="none">
        <path d="M2 13C80 11 220 12 298 13" stroke="#1B2B6B" strokeOpacity={0.18} strokeWidth={1.2} strokeLinecap="round" />
        {signed ? (
          <path
            d="M4 12C22 2 34 4 40 9C46 14 54 12 66 6C80 0 92 10 106 9C150 6 230 10 296 8"
            pathLength={1}
            stroke="#2547C9"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="ink-draw ink-draw--in"
          />
        ) : (
          <path d="M2 13C80 11 220 12 298 13" stroke="#A06A12" strokeWidth={2} strokeLinecap="round" strokeDasharray="6 6" className="cs-await-pulse" />
        )}
      </svg>
    ) : null}
    <p className="mt-1 text-12 text-ink-soft">{line.text}</p>
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
      className="module-panel rounded-card border border-navy/15 bg-cream text-navy shadow-ink-lg"
      aria-label="Approval card"
      data-testid="approval-card"
    >
      <header className="border-b border-navy/10 px-5 pt-5 pb-4">
        <p className="eyebrow">Approval card</p>
        {model.intro && <p className="mt-1 text-12 text-ink-soft">{model.intro}</p>}
        <h3 className="mt-1 text-28">{model.title}</h3>
      </header>

      {!prepared.check.ok && (
        <div className="mx-5 mt-3 border-l-2 border-vermilion pl-3 text-14" role="alert">
          <p className="font-semibold text-vermilion">{'✕'} Do not sign: the decoded view does not match the transaction</p>
          <ul className="mt-1 list-disc pl-4 text-12 text-navy">
            {prepared.check.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-0 md:grid-cols-2">
        {/* Left: what you sign, decoded from the XDR */}
        <div className="px-5 py-4 md:border-r border-navy/10">
          <p className="eyebrow mb-3">What you sign</p>
          <dl className="space-y-2.5 text-14">
            <div>
              <dt className="text-12 text-ink-soft">Network</dt>
              <dd className="font-medium">{model.network}</dd>
              <dd className="text-11 text-ink-soft">{NETWORK_NOTE}</dd>
            </div>
            <div>
              <dt className="text-12 text-ink-soft">Contract</dt>
              <dd className={model.contract.recognised ? 'font-medium' : 'font-medium text-vermilion'}>
                {!model.contract.recognised && <span aria-hidden="true">{'✕'} </span>}
                {model.contract.label}
              </dd>
              {model.contract.id && (
                <dd className="font-mono text-xs tabular text-gray-400" title={model.contract.id}>
                  {shortAddress(model.contract.id)}
                </dd>
              )}
              {model.contract.isMandateWallet && <dd className="text-11 text-ink-soft">{LABEL_WALLET_CONTRACT}</dd>}
            </div>
            <div>
              <dt className="text-12 text-ink-soft">Function</dt>
              <dd className="font-mono">{model.functionName}</dd>
            </div>
            {model.args.map((a, i) => (
              <div key={`${a.label}-${i}`}>
                <dt className="text-12 text-ink-soft">{a.label}</dt>
                <dd className="font-mono tabular">{a.value}</dd>
                {a.raw && <dd className="font-mono text-11 tabular text-gray-400">{a.raw}</dd>}
              </div>
            ))}
            {model.maxFee && (
              <div>
                <dt className="text-12 text-ink-soft">Maximum network fee</dt>
                <dd className="font-mono tabular">{model.maxFee}</dd>
              </div>
            )}
            {model.planned && (
              <div className="border-t border-dashed border-navy/15 pt-2">
                <dt className="text-12 text-ink-soft">{model.planned.label}</dt>
                <dd className="font-mono tabular">{model.planned.value}</dd>
                {model.planned.note && <dd className="text-11 text-ink-soft">{model.planned.note}</dd>}
              </div>
            )}
          </dl>
        </div>

        {/* Right: who must sign, what you could lose */}
        <div className="px-5 py-4">
          <p className="eyebrow">Who must sign</p>
          <div className="divide-y divide-navy/10">
            {model.signers.map((s) => (
              <SignatureRow key={s.who} line={s} signed={s.signsThis && signed} awaiting={phase.kind === 'awaiting_wallet'} />
            ))}
          </div>
          {signer && (
            <p className="mt-1 text-11 text-ink-soft">
              Signing account: <span className="font-mono tabular">{shortAddress(signer)}</span>
            </p>
          )}

          <p className="eyebrow mt-5">What you could lose</p>
          <ul className="mt-1.5 space-y-1 text-14">
            {model.loss.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {model.showFundsLabel && <p className="mt-1 text-11 text-ink-soft">{LABEL_FUNDS}</p>}
          {model.showEnforced && <p className="mt-4 border-l-2 border-cobalt pl-3 font-display text-20 leading-snug">{CARD_ENFORCED}</p>}
        </div>
      </div>

      <div className="border-t border-navy/10 px-5 py-4">
        {view && <TxStatus view={view} onRetry={onRetryConfirm} />}
        {phase.kind === 'review' && phase.notice && <p className="mb-2 text-12 text-navy">{phase.notice}</p>}
        {!signed && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!connectedKey ? (
              <button onClick={onConnect} className="btn btn-md btn-primary">
                Connect your wallet
              </button>
            ) : wrongWallet ? (
              <p className="text-14 text-navy">
                Connect the wallet <span className="font-mono">{shortAddress(signer)}</span> to sign this.
              </p>
            ) : (
              <button
                onClick={onSign}
                disabled={!canSign}
                className="btn btn-md btn-primary"
              >
                {busy ? 'Waiting...' : 'Sign in your wallet'}
              </button>
            )}
            {!busy && (
              <button onClick={onCancel} className="btn btn-md btn-ghost">
                Not now
              </button>
            )}
          </div>
        )}
        {signed && (
          <button onClick={onCancel} className="btn btn-sm btn-secondary mt-2">
            Close
          </button>
        )}
      </div>

      <footer className="rounded-b-card border-t border-navy/10 bg-cream-deep/70 px-5 py-2.5 text-11 text-ink-soft">
        <p>{LABEL_TEST_ASSETS}</p>
        <p>{CARD_FOOTER_DECODED}</p>
      </footer>
    </section>
  );
};

export default ApprovalCard;
