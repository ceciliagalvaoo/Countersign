import React from 'react';
import { Link } from 'react-router-dom';
import type { PlanNode } from '../../types/countersign';
import { LABEL_COMPLIANCE, LABEL_ZK_TIER, TIER_GREEN, TIER_ISSUER, TIER_RED, TIER_YELLOW } from '../../constants/labels';

/**
 * Session steps with purchase progress reconciled from GET /mandate-wallet/purchases.
 * Current verified order state supersedes the historical tool snapshot only for
 * the exact purchase referenced by the session. Chat history remains unchanged.
 */

const ORDER = [
  'profile',
  'perimeter',
  'eligibility',
  'screening',
  'proposal',
  'investor_signature',
  'agent_purchase',
  'issuer_countersign',
  'confirmed',
];

/** Tier of each node (06 section 5.4); nodes not listed only read or decide in code, no signature */
const TIER: Record<string, string> = {
  investor_signature: TIER_RED,
  agent_purchase: TIER_YELLOW,
  issuer_countersign: TIER_ISSUER,
};

function wordFor(n: PlanNode): { word: string; tone: string } {
  switch (n.state) {
    case 'pending':
      return { word: 'waiting', tone: 'text-gray-400' };
    case 'skipped':
      return { word: 'not needed', tone: 'text-gray-400' };
    case 'interrupted':
      return { word: 'interrupted', tone: 'text-gray-100' };
    case 'refused':
      return { word: 'refused', tone: 'text-red-300' };
    case 'active':
      if (n.id === 'investor_signature') return { word: 'awaiting your signature', tone: 'text-amber-300' };
      if (n.id === 'issuer_countersign') return { word: 'awaiting issuer countersignature', tone: 'text-amber-300' };
      if (n.id === 'agent_purchase') return { word: 'pending, not done', tone: 'text-amber-300' };
      return { word: 'in progress', tone: 'text-amber-300' };
    case 'done':
      if (n.id === 'agent_purchase') return { word: 'confirmed on-chain', tone: 'text-emerald-300' };
      if (n.id === 'confirmed') return { word: 'completed', tone: 'text-emerald-300' };
      if (n.id === 'issuer_countersign') return { word: 'countersigned', tone: 'text-gray-100' };
      if (n.id === 'investor_signature') return { word: 'signed', tone: 'text-gray-100' };
      return { word: 'complete', tone: 'text-gray-100' };
    default:
      return { word: String(n.state), tone: 'text-gray-100' };
  }
}

const DOT: Record<string, string> = {
  pending: 'border-gray-500/50 bg-transparent',
  skipped: 'border-gray-500/30 bg-transparent',
  interrupted: 'border-white/40 bg-white/20',
  refused: 'border-red-400 bg-red-400',
  active: 'border-amber-400 bg-amber-400/30',
  done: 'border-primary-400 bg-primary-700',
};

interface Props {
  nodes: PlanNode[];
  interrupted: boolean;
  busy: boolean;
  onInterrupt: () => void;
  onResume: () => void;
  available: boolean;
  purchaseLabel?: string;
  statusError?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

const PlanDag: React.FC<Props> = ({ nodes, interrupted, busy, onInterrupt, onResume, available, purchaseLabel, statusError, onRefresh, refreshing }) => {
  const sorted = [...nodes].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  const eligibilityRefused = nodes.some((n) => n.id === 'eligibility' && n.state === 'refused');

  return (
    <section className="ink-card p-5 text-navy" aria-label="Plan">
      <div className="flex items-baseline justify-between">
        <h3 className="text-28">Plan</h3>
        <div className="flex gap-2">
          {onRefresh && <button onClick={onRefresh} disabled={refreshing} className="text-xs text-gray-400 underline underline-offset-2 disabled:opacity-40">{refreshing ? 'Reading...' : 'Refresh status'}</button>}
          {interrupted ? (
            <button onClick={onResume} disabled={busy || !available} className="btn btn-sm btn-secondary disabled:opacity-40">
              Resume
            </button>
          ) : (
            <button onClick={onInterrupt} disabled={busy || !available} className="btn btn-sm btn-secondary disabled:opacity-40">
              Interrupt
            </button>
          )}
        </div>
      </div>
      {purchaseLabel && <p className="mt-1 text-xs text-gray-400">Current purchase: {purchaseLabel}</p>}
      {statusError && <p role="status" className="mt-2 text-xs text-amber-300">{statusError}</p>}
      {interrupted && <p className="text-xs text-gray-100">Interrupted: the service starts no execution until you resume.</p>}
      {!available && <p className="text-xs text-gray-400">The plan appears after your first message.</p>}

      <ol className="mt-3">
        {sorted.map((n, i) => {
          const w = wordFor(n);
          return (
            <li key={n.id} className="relative flex gap-3 pb-3" data-node={n.id} data-state={n.state}>
              {i < sorted.length - 1 && <span className="absolute left-[5px] top-3 h-full w-px bg-white/20" aria-hidden="true" />}
              <span className={`relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full border ${DOT[n.state] ?? DOT.pending}`} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="font-semibold">{n.label}</span> <span className={`text-xs ${w.tone}`}>{w.word}</span>
                </p>
                <p className="eyebrow !text-[10px]" data-tier>{TIER[n.id] ?? TIER_GREEN}</p>
                {n.rule && <p className="font-mono text-11 text-gray-400 break-all">rule: {n.rule}</p>}
                {n.detail && <p className="text-11 text-gray-400 break-words">{n.detail}</p>}
                {n.id === 'eligibility' && eligibilityRefused && (
                  <p className="mt-1 text-xs">
                    Not eligible.{' '}
                    <Link to="/dashboard" className="font-semibold text-gray-100 underline underline-offset-2">
                      Prove your tier
                    </Link>
                    <span className="block text-11 text-gray-400">{LABEL_ZK_TIER}</span>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="text-11 text-gray-400">Perimeter, profile and suitability: {LABEL_COMPLIANCE}</p>
    </section>
  );
};

export default PlanDag;
