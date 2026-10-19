import React from 'react';
import { getTransactionUrl } from '../utils/stellar';
import { NETWORK_LABEL } from '../constants/labels';
import { shortHash } from '../utils/units';

/**
 * On-chain state of a transaction, in words, with colour only as a second channel:
 * amber for pending and awaiting issuer countersignature,
 * green only for confirmed on-chain and completed, seal red only for refusals. Nothing is ever shown
 * as done before the API has read the confirmed transaction.
 */

export type TxView =
  | { state: 'awaiting_signature'; note?: string }
  | { state: 'pending'; hash?: string; note?: string }
  | { state: 'confirmed'; hash: string; decision?: string | null; logSeq?: number | null; logRule?: string | null }
  | { state: 'awaiting_issuer'; hash?: string | null }
  | { state: 'completed'; hash: string; mintHash?: string | null }
  | { state: 'refused_contract'; code: number; name: string; detail?: string }
  | { state: 'refused_policy'; rule: string; detail?: string }
  | { state: 'failed'; message: string; hash?: string };

const WORD: Record<TxView['state'], string> = {
  awaiting_signature: 'awaiting your signature',
  pending: 'pending, not done',
  confirmed: 'confirmed on-chain',
  awaiting_issuer: 'awaiting issuer countersignature',
  completed: 'completed',
  refused_contract: 'refused by contract',
  refused_policy: 'refused by policy',
  failed: 'not done',
};

const TONE: Record<TxView['state'], string> = {
  awaiting_signature: 'text-amber-300 border-amber-400',
  pending: 'text-amber-300 border-amber-400',
  confirmed: 'text-emerald-300 border-emerald-400',
  awaiting_issuer: 'text-amber-300 border-amber-400',
  completed: 'text-emerald-300 border-emerald-400',
  refused_contract: 'text-red-300 border-red-400',
  refused_policy: 'text-red-300 border-red-400',
  failed: 'text-gray-100 border-white/40',
};

const MARK: Record<TxView['state'], string> = {
  awaiting_signature: '○',
  pending: '○',
  confirmed: '✓',
  awaiting_issuer: '○',
  completed: '✓',
  refused_contract: '✕',
  refused_policy: '✕',
  failed: '!',
};

export const HashLink: React.FC<{ hash: string; label?: string }> = ({ hash, label }) => (
  <a
    href={getTransactionUrl(hash)}
    target="_blank"
    rel="noopener noreferrer"
    className="font-mono tabular-nums text-gray-100 underline decoration-gray-500/60 underline-offset-2 hover:decoration-white"
    title={hash}
  >
    {label ? `${label} ` : ''}
    {shortHash(hash)}
  </a>
);

export const TxStatus: React.FC<{ view: TxView; title?: string; onRetry?: () => void }> = ({ view, title, onRetry }) => {
  const hash = 'hash' in view ? view.hash : undefined;
  return (
    <div className={`border-l-2 pl-3 py-1 text-sm text-gray-100 ${TONE[view.state].split(' ')[1]}`} data-tx-state={view.state}>
      {title && <p className="text-xs uppercase tracking-wide text-gray-400">{title}</p>}
      <p className={`font-semibold ${TONE[view.state].split(' ')[0]}`}>
        <span aria-hidden="true" className="mr-1">{MARK[view.state]}</span>
        {WORD[view.state]}
        {view.state === 'refused_contract' && (
          <span className="ml-2 font-mono tabular-nums">
            #{view.code} {view.name}
          </span>
        )}
        {view.state === 'refused_policy' && <span className="ml-2 font-mono">{view.rule}</span>}
      </p>
      <div className="mt-1 space-y-0.5 text-xs text-gray-400">
        <p>
          Network: <span className="text-gray-100">{NETWORK_LABEL}</span>
        </p>
        {hash && (
          <p>
            Transaction: <HashLink hash={hash} />
          </p>
        )}
        {view.state === 'confirmed' && view.decision && (
          <p>
            decision: <span className="font-mono tabular-nums text-gray-100" title={view.decision}>{shortHash(view.decision)}</span>
            {view.logSeq != null && (
              <span>
                {' '}
                = log line #{view.logSeq}
                {view.logRule ? ` (${view.logRule})` : ''}
              </span>
            )}
          </p>
        )}
        {view.state === 'completed' && view.mintHash && (
          <p>
            Issuer mint: <HashLink hash={view.mintHash} />
          </p>
        )}
        {'note' in view && view.note && <p>{view.note}</p>}
        {view.state === 'refused_contract' && (
          <p>The RPC's diagnostic events report Error(Contract, #{view.code}); they are not part of consensus and the explorer does not show this code.</p>
        )}
        {'detail' in view && view.detail && <p>{view.detail}</p>}
        {view.state === 'failed' && <p className="text-gray-100">{view.message}</p>}
      </div>
      {view.state === 'pending' && onRetry && (
        <button onClick={onRetry} className="mt-2 text-xs font-semibold text-gray-100 underline underline-offset-2">
          Check again
        </button>
      )}
    </div>
  );
};

export default TxStatus;
