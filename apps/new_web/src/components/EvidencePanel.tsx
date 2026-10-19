import React from 'react';
import type { ChainVerifyResult, DecisionLogEntry, Purchase } from '../types/countersign';
import { HashLink } from './TxStatus';
import { NETWORK_LABEL } from '../constants/labels';
import { shortHash } from '../utils/units';

/**
 * Evidence panel: the investor's rows of the hash-chained decision log (GET /api/decision-log), the
 * transaction hash of each on-chain row, the purchase that carried a decision on-chain, and the result
 * of recomputing the whole chain (GET /api/decision-log/verify).
 */

const OUTCOME: Record<string, { word: string; tone: string }> = {
  APPROVED: { word: 'approved by policy', tone: 'text-gray-100' },
  REJECTED: { word: 'refused by policy', tone: 'text-red-300' },
  NEEDS_INVESTOR_SIGNATURE: { word: 'needs your signature', tone: 'text-amber-300' },
  CONFIRMED: { word: 'confirmed on-chain', tone: 'text-emerald-300' },
  FAILED: { word: 'failed, not done', tone: 'text-gray-100' },
};

interface Props {
  entries: DecisionLogEntry[];
  verify: ChainVerifyResult | null;
  purchases: Purchase[];
  loading?: boolean;
  onRefresh?: () => void;
}

const EvidencePanel: React.FC<Props> = ({ entries, verify, purchases, loading, onRefresh }) => {
  // decision hash -> purchase transaction that carried it as the `decision` argument
  const purchaseByDecision = new Map<string, string>();
  for (const p of purchases) if (p.decision && p.subscribeTxHash) purchaseByDecision.set(p.decision.toLowerCase(), p.subscribeTxHash);
  const rows = [...entries].sort((a, b) => b.seq - a.seq);

  return (
    <section className="rounded-2xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.45)] p-4 text-gray-100 " aria-label="Evidence">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold !text-white">Evidence</h3>
        {onRefresh && (
          <button onClick={onRefresh} disabled={loading} className="text-xs text-gray-400 underline underline-offset-2 disabled:opacity-50">
            {loading ? 'Reading...' : 'Refresh'}
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400">Network: {NETWORK_LABEL}. Each purchase carries the hash of its log line as the decision argument.</p>

      <div className="mt-2 text-xs" data-testid="chain-verify">
        {verify === null ? (
          <p className="text-gray-400">Chain check not run yet.</p>
        ) : verify.ok ? (
          <p>
            <span className="font-semibold text-emerald-300">{'✓'} chain verified</span>{' '}
            <span className="text-gray-400">
              {verify.count} lines recomputed, head <span className="font-mono tabular-nums">{shortHash(verify.headHash)}</span>
            </span>
          </p>
        ) : (
          <p>
            <span className="font-semibold text-red-300">{'✕'} chain broken at line #{verify.firstBadSeq}</span>{' '}
            <span className="text-gray-400">{verify.reason}</span>
          </p>
        )}
      </div>

      <div className="mt-3 max-h-[28rem] overflow-y-auto">
        {rows.length === 0 ? (
          <p className="text-xs text-gray-400">No decision yet.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-gray-400">
              <tr>
                <th className="py-1 pr-2 font-normal">#</th>
                <th className="py-1 pr-2 font-normal">Rule</th>
                <th className="py-1 pr-2 font-normal">Result</th>
                <th className="py-1 font-normal">Hash</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const out = OUTCOME[e.payload.outcome] ?? { word: e.payload.outcome, tone: 'text-gray-100' };
                const purchase = purchaseByDecision.get(e.hash.toLowerCase());
                return (
                  <tr key={e.seq} className="border-t border-white/10 align-top">
                    <td className="py-1.5 pr-2 font-mono tabular-nums">{e.seq}</td>
                    <td className="py-1.5 pr-2 font-mono break-all">{e.payload.rule}</td>
                    <td className={`py-1.5 pr-2 ${out.tone}`}>{out.word}</td>
                    <td className="py-1.5">
                      <span className="font-mono tabular-nums text-gray-400" title={e.hash}>
                        {shortHash(e.hash)}
                      </span>
                      {e.payload.txHash && (
                        <div>
                          <HashLink hash={e.payload.txHash} label="tx" />
                        </div>
                      )}
                      {purchase && (
                        <div className="text-gray-400">
                          decision on-chain in <HashLink hash={purchase} label="tx" />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};

export default EvidencePanel;
