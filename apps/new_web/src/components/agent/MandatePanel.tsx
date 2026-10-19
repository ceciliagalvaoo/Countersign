import React from 'react';
import type { MandateOverview } from '../../types/countersign';
import { shortHash } from '../../utils/units';

/**
 * Typed mandate next to the chat. The fields shown are the API's stored draft (GET /api/mandates), the
 * same object whose hash the investor approves; missing fields are highlighted. The agent can edit the
 * draft; only the investor approves it, and it becomes active only after she signs set_limits.
 */

const FIELDS: { key: string; label: string; unit?: string }[] = [
  { key: 'residences', label: 'Residences' },
  { key: 'horizonMonths', label: 'Horizon', unit: 'months' },
  { key: 'liquidityNeedPct', label: 'Liquidity need', unit: '%' },
  { key: 'liquidityWithinMonths', label: 'Liquidity within', unit: 'months' },
  { key: 'maxLossTolerance', label: 'Loss tolerance' },
  { key: 'totalAmountUsdc', label: 'Total amount', unit: 'USDC' },
  { key: 'perPurchaseCapUsdc', label: 'Cap per purchase', unit: 'USDC' },
  { key: 'periodCapUsdc', label: 'Cap per period', unit: 'USDC' },
  { key: 'periodDays', label: 'Period', unit: 'days' },
  { key: 'allowedSectors', label: 'Allowed sectors' },
  { key: 'maxPerSectorPct', label: 'Max per sector', unit: '%' },
  { key: 'recurring', label: 'Recurring (optional)' },
];

const OPTIONAL = new Set(['recurring']);

const SECTOR_NAMES: Record<string, string> = {
  AGRO: 'Agribusiness',
  VAREJO: 'Retail',
  INDUSTRIA: 'Industry',
  SERVICOS: 'Services',
  TECH: 'Technology',
  SAUDE: 'Health',
  OUTROS: 'Other',
};

function show(key: string, v: unknown, unit?: string): string {
  if (v === undefined || v === null || v === '') return '';
  if (key === 'allowedSectors' && Array.isArray(v)) return v.map((s) => SECTOR_NAMES[String(s)] ?? String(s)).join(', ');
  if (Array.isArray(v)) return v.join(', ');
  if (key === 'recurring' && typeof v === 'object') {
    const r = v as { amountUsdc?: string; everyDays?: number; fundIds?: string[] };
    return `${r.amountUsdc ?? '?'} USDC every ${r.everyDays ?? '?'} days, ${r.fundIds?.length ?? 0} fund(s)`;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return unit ? `${String(v)} ${unit}` : String(v);
}

interface Props {
  overview: MandateOverview | null;
  /** Draft as last seen by the agent session, used only while the API overview is unavailable */
  sessionDraft: Record<string, unknown> | null;
  sessionMissing: string[] | null;
  turns: number;
  hasWallet: boolean;
  busy: boolean;
  error: string | null;
  onApprove: () => void;
  onAnchor: () => void;
}

const MandatePanel: React.FC<Props> = ({ overview, sessionDraft, sessionMissing, turns, hasWallet, busy, error, onApprove, onAnchor }) => {
  const draft = overview?.draft ?? sessionDraft ?? {};
  const missing = new Set<string>([
    ...(overview?.missing ?? []).map((m) => m.path.split('.')[0]),
    ...(sessionMissing ?? []),
  ]);
  for (const f of FIELDS) if (!OPTIONAL.has(f.key) && (draft[f.key] === undefined || draft[f.key] === null)) missing.add(f.key);

  const status = overview?.active ? 'active' : overview?.approved ? 'approved' : 'draft';
  const draftHash = overview?.mandateHash ?? null;
  const approvedHash = overview?.approved?.mandateHash ?? null;
  const approvedIsCurrent = !!approvedHash && approvedHash === draftHash;
  // set_limits only when the wallet exists and its on-chain mandate hash differs from the approved one
  const needsAnchor = hasWallet && !!overview?.approved && !overview.active;
  const canApprove = !!overview?.complete && !!draftHash && !approvedIsCurrent;

  return (
    <section className="rounded-2xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.45)] p-4 text-gray-100 " aria-label="Mandate">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold !text-white">Investment mandate</h3>
        <span className="text-xs text-gray-400">
          Turns: <span className="font-mono tabular-nums text-gray-100">{turns}</span>
        </span>
      </div>
      <p className="text-xs text-gray-400">
        Status:{' '}
        <span className={status === 'active' ? 'font-semibold text-emerald-300' : status === 'approved' ? 'font-semibold text-amber-300' : 'font-semibold text-gray-100'}>
          {status === 'active' ? 'active on-chain' : status === 'approved' ? (hasWallet ? 'approved, waiting for your set_limits signature' : 'approved, anchored when you create your wallet') : 'draft'}
        </span>
      </p>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        {FIELDS.map((f) => {
          const isMissing = missing.has(f.key);
          const value = show(f.key, draft[f.key], f.unit);
          return (
            <div key={f.key} className={isMissing ? 'rounded border border-amber-400/70 px-2 py-1' : 'px-2 py-1'}>
              <dt className="text-[11px] text-gray-400">{f.label}</dt>
              <dd className={`font-mono tabular-nums ${isMissing ? 'text-amber-300' : ''}`}>
                {value || (isMissing ? 'missing' : OPTIONAL.has(f.key) ? 'none' : '')}
              </dd>
            </div>
          );
        })}
      </dl>

      {draftHash && (
        <p className="mt-3 text-xs text-gray-400">
          Mandate hash you approve: <span className="font-mono tabular-nums text-gray-100" title={draftHash}>{shortHash(draftHash)}</span>
        </p>
      )}
      {overview?.onChainMandateHash && (
        <p className="text-xs text-gray-400">
          On-chain mandate hash: <span className="font-mono tabular-nums text-gray-100" title={overview.onChainMandateHash}>{shortHash(overview.onChainMandateHash)}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {needsAnchor && approvedIsCurrent ? (
          <button onClick={onAnchor} disabled={busy} className="rounded bg-primary-700 hover:bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            Review set_limits card
          </button>
        ) : (
          <button onClick={onApprove} disabled={busy || !canApprove} className="rounded bg-primary-700 hover:bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            Approve mandate
          </button>
        )}
        {!overview?.complete && <span className="text-xs text-gray-400">Complete the highlighted fields in the chat.</span>}
        {!hasWallet && approvedIsCurrent && <span className="text-xs text-gray-400">Approved. Next: create your mandate wallet with these limits.</span>}
      </div>
      {error && <p className="mt-2 text-xs text-gray-100" role="alert">{error}</p>}
    </section>
  );
};

export default MandatePanel;
