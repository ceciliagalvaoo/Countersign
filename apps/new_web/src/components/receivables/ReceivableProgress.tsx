import { Check, Clock3, ExternalLink, ShieldCheck } from 'lucide-react';
import type { ChainProgress, Receivable } from '../../types/receivableChain';
import { shortAddress, shortHash } from '../../utils/units';
import { badgeClass, formatReceivableTime, statusLabel, visibleSteps } from './receivablePresentation';

export default function ReceivableProgress({ item, progress, publicKey }: {
  item: Receivable; progress: ChainProgress; publicKey: string | null;
}) {
  const steps = visibleSteps(item, progress);
  const completed = steps.filter(s => s.state === 'CONFIRMED').length;
  return <>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold text-white">Stellar activity</h2>
        <p className="mt-1 text-sm text-white/60">Each registration, payment and distribution is verified separately.</p></div>
      <span className="text-sm text-white/60">{completed} of {steps.length} steps confirmed</span>
    </div>
    <ol className="space-y-4">
      {steps.map((step, index) => {
        const confirmed = step.state === 'CONFIRMED';
        const m = step.multisig;
        // Labels come from step identity; do not expose legacy localized API labels.
        const label = ({ fund: 'Register fund', cedente: 'Register assignor', sacado: 'Register debtor',
          register: 'Register receivable', pay: 'Pay receivable', distribute: 'Distribute payment' } as Record<string, string>)[step.stepId || ''] || step.label;
        return <li key={step.stepId} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.025] p-4 md:p-5">
          <div className="flex items-start gap-3">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${confirmed ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/10 text-white/60'}`}>
              {confirmed ? <Check size={16} aria-hidden="true" /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium text-white">{label}</h3>
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${badgeClass(step.state || '')}`}>{statusLabel(step.state || 'NOT_STARTED')}</span>
              </div>
              {step.entity?.kind !== 'receivable' && <p className="mt-1 text-sm text-white/60 break-words">{step.entity?.name}</p>}
              {m && <p className="mt-2 text-sm text-white/70">{m.signedBy.length} {m.signedBy.length === 1 ? 'signer' : 'signers'} · Weight {m.weight} / {m.threshold}</p>}
              {step.txHash && <a href={`https://stellar.expert/explorer/testnet/tx/${step.txHash}`} target="_blank" rel="noopener noreferrer"
                title={step.txHash} className="mt-3 inline-flex items-center gap-2 text-sm text-emerald-300 hover:underline">
                <ShieldCheck size={15} aria-hidden="true" /> Confirmed transaction <span className="font-mono text-xs">{shortHash(step.txHash)}</span><ExternalLink size={13} aria-hidden="true" />
              </a>}
              {step.verificationHash && <p className="mt-3 flex items-center gap-2 text-sm text-amber-200"><Clock3 size={15} aria-hidden="true" />Transaction submitted; verification required.</p>}
              <details className="mt-3 text-sm text-white/60" open={step.state === 'PENDING_SIGNATURES' || step.state === 'SUBMITTED_UNVERIFIED'}>
                <summary className="cursor-pointer text-white/70 hover:text-white">{m ? 'Signers and transaction details' : 'Transaction details'}</summary>
                <dl className="mt-3 grid min-w-0 grid-cols-1 gap-3 rounded-lg bg-black/10 p-3 text-xs">
                  <div><dt className="text-white/40">Entity ID</dt><dd className="mt-1 break-all font-mono">{step.entity?.id}</dd></div>
                  {m && <>
                    <div><dt className="text-white/40">Request ID</dt><dd className="mt-1 break-all font-mono">{m.id}</dd></div>
                    <div><dt className="text-white/40">{confirmed ? 'Signing deadline' : 'Valid until'}</dt><dd className="mt-1">{formatReceivableTime(m.expiresAt)}</dd></div>
                  </>}
                  {(step.txHash || step.verificationHash) && <div><dt className="text-white/40">Transaction hash</dt><dd className="mt-1 break-all font-mono">{step.txHash || step.verificationHash}</dd></div>}
                </dl>
                {m && <ul className="mt-3 space-y-2">
                  {m.signers.map(signer => <li key={signer.key} className="min-w-0 rounded-lg border border-white/10 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs">{shortAddress(signer.key)}{publicKey === signer.key && <span className="ml-2 font-sans text-emerald-300">Connected</span>}</span>
                      <span className="text-xs">Weight {signer.weight} · {m.signedBy.includes(signer.key) ? 'Signed' : step.state === 'PENDING_SIGNATURES' ? 'Can sign' : 'Not signed'}</span>
                    </div>
                    <p className="mt-1 break-all font-mono text-[11px] text-white/40">{signer.key}</p>
                  </li>)}
                </ul>}
              </details>
            </div>
          </div>
        </li>;
      })}
    </ol>
  </>;
}
