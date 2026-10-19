import React, { useState } from 'react';
import axios from 'axios';
import { stellarService } from '../../services/api';
import { useWallet } from '../../contexts/WalletContext';
import type { WalletState } from '../../types/countersign';
import { decodeLocally, type LocalOp } from '../../utils/localDecode';
import { errorText } from '../../utils/contractErrors';
import { formatUnits, shortAddress } from '../../utils/units';
import { LABEL_TEST_ASSETS, LABEL_WALLET_CONTRACT, NETWORK_LABEL } from '../../constants/labels';

/**
 * First use (S0): connect the wallet, get test USDC (USDC trustline, then a test transfer), create the mandate wallet (deploy card),
 * deposit USDC (transfer card), then show the balance the API read from the chain. The deploy and deposit
 * cards are rendered in the card column by the page, from the decoder, like every other signature.
 */

interface Props {
  wallet: WalletState | null;
  loading: boolean;
  /** The deploy carries the caps and hash of the approved mandate, so it needs one */
  mandateApproved: boolean;
  flowBusy: boolean;
  onCreate: () => void;
  onDeposit: (amountUsdc: string) => void;
  onRefresh: () => void;
}

const contractUrl = (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`;

const Step: React.FC<{ n: number; title: string; done: boolean; children?: React.ReactNode }> = ({ n, title, done, children }) => (
  <li className="flex gap-3">
    <span
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-mono ${
        done ? 'border-primary-400 bg-primary-700 text-white' : 'border-white/50 text-gray-100'
      }`}
    >
      {done ? '✓' : n}
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold">{title}</p>
      {children}
    </div>
  </li>
);

/**
 * Test USDC, default path: a single USDC trustline from her own account, then the operator account sends test
 * USDC (POST /api/stellar/test-usdc-transfer). The public testnet faucet (it adds trustlines for several test
 * assets) is offered only when the operator transfer is not available (404). Every transaction is read in the
 * browser and listed before the wallet opens.
 */
const TestUsdc: React.FC = () => {
  const { publicKey, signAndSubmitTransaction } = useWallet();
  const [review, setReview] = useState<{ xdr: string; ops: LocalOp[]; kind: 'trustline' | 'faucet' } | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'signing' | 'received'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const transfer = async () => {
    if (!publicKey) return;
    try {
      await stellarService.sendTestUsdc(publicKey);
      setNote('USDC trustline ready and test USDC received in your account.');
      setState('received');
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 404) {
        await loadFaucet();
        return;
      }
      setError(`USDC trustline ready. Test USDC was not sent (${errorText(e)}); ask the operator.`);
      setState('idle');
    }
  };

  const loadFaucet = async () => {
    if (!publicKey) return;
    try {
      const { transactionXdr } = await stellarService.getTestUsdc(publicKey);
      setReview({ xdr: transactionXdr, ops: decodeLocally(transactionXdr).ops, kind: 'faucet' });
      setState('idle');
    } catch (e) {
      setError(`USDC trustline ready. Ask the operator to send test USDC (${errorText(e)}).`);
      setState('idle');
    }
  };

  const start = async () => {
    if (!publicKey) return;
    setError(null);
    setState('loading');
    try {
      const { hasTrustline, transactionXdr } = await stellarService.getUsdcTrustline(publicKey);
      if (hasTrustline || !transactionXdr) {
        await transfer();
        return;
      }
      const ops = decodeLocally(transactionXdr).ops;
      if (!(ops.length === 1 && ops[0].type === 'classic' && ops[0].opType === 'changeTrust')) {
        throw new Error('The trustline transaction is not a single changeTrust');
      }
      setReview({ xdr: transactionXdr, ops, kind: 'trustline' });
      setState('idle');
    } catch (e) {
      setError(errorText(e));
      setState('idle');
    }
  };

  const sign = async () => {
    if (!review) return;
    const kind = review.kind;
    setState('signing');
    try {
      await signAndSubmitTransaction(review.xdr);
      setReview(null);
      if (kind === 'trustline') {
        await transfer();
      } else {
        setNote('Test USDC received in your account.');
        setState('received');
      }
    } catch (e) {
      const codes = (e as { response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } } })?.response?.data?.extras
        ?.result_codes;
      setError(`Not signed or not accepted: ${codes ? [codes.transaction, ...(codes.operations ?? [])].filter(Boolean).join(', ') : errorText(e)}`);
      setState('idle');
    }
  };

  if (state === 'received') return <p className="text-xs text-gray-100">{note}</p>;
  return (
    <div className="mt-1">
      {!review ? (
        <button onClick={start} disabled={!publicKey || state !== 'idle'} className="rounded border border-white/40 px-3 py-1 text-xs font-semibold disabled:opacity-40">
          {state === 'idle' ? 'Get test USDC' : 'Preparing...'}
        </button>
      ) : (
        <div className="rounded border border-white/[0.12] bg-white/[0.04] p-2 text-xs">
          <p className="text-gray-400">What you sign (read in your browser), network {NETWORK_LABEL}:</p>
          <ul className="mt-1 space-y-0.5 font-mono">
            {review.ops.map((op, i) => (
              <li key={i}>
                {op.type === 'classic'
                  ? `${op.opType}${op.fields.asset ? ` ${op.fields.asset.split(' ')[0]}` : op.fields.line ? ` ${op.fields.line.split(' ')[0]}` : ''}${op.fields.amount ? ` ${op.fields.amount}` : ''}${op.fields.destination ? ` to ${shortAddress(op.fields.destination)}` : ''}`
                  : op.type === 'invoke'
                    ? `${op.function} on ${shortAddress(op.contractId)}`
                    : 'contract deploy'}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-gray-400">
            {review.kind === 'trustline'
              ? 'Adds a USDC trustline to your own account; test USDC is then sent to it.'
              : 'Testnet faucet: adds trustlines for test assets, including USDC, and sends test USDC. Check each line before signing.'}
          </p>
          <div className="mt-2 flex gap-2">
            <button onClick={sign} disabled={state === 'signing'} className="rounded bg-primary-700 hover:bg-primary-600 px-3 py-1 font-semibold text-white disabled:opacity-40">
              {state === 'signing' ? 'Waiting...' : 'Sign in your wallet'}
            </button>
            <button onClick={() => setReview(null)} className="text-gray-400 underline underline-offset-2">
              Not now
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-gray-100">{error}</p>}
    </div>
  );
};

const WalletSetup: React.FC<Props> = ({ wallet, loading, mandateApproved, flowBusy, onCreate, onDeposit, onRefresh }) => {
  const { publicKey, isConnected, connect } = useWallet();
  const [amount, setAmount] = useState('');
  const balance = wallet?.usdcBalanceUnits ?? null;
  const funded = !!balance && /^\d+$/.test(balance) && BigInt(balance) > 0n;

  return (
    <section className="rounded-2xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.45)] p-4 text-gray-100 " aria-label="Mandate wallet">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold !text-white">Your mandate wallet</h3>
        <button onClick={onRefresh} disabled={loading} className="text-xs text-gray-400 underline underline-offset-2 disabled:opacity-50">
          {loading ? 'Reading...' : 'Refresh'}
        </button>
      </div>
      <p className="text-[11px] text-gray-400">{LABEL_WALLET_CONTRACT}</p>

      {wallet && funded ? (
        <div className="mt-2 space-y-1 text-sm">
          <p>
            Contract:{' '}
            <a href={contractUrl(wallet.contractId)} target="_blank" rel="noopener noreferrer" className="font-mono underline underline-offset-2" title={wallet.contractId}>
              {shortAddress(wallet.contractId)}
            </a>
          </p>
          <p>
            Balance (read from the chain): <span className="font-mono tabular-nums">{formatUnits(balance)} USDC</span>
          </p>
          {wallet.limits && (
            <p className="text-xs text-gray-400">
              Limits on-chain: <span className="font-mono tabular-nums text-gray-100">{formatUnits(wallet.limits.perTxCapUnits)}</span> per purchase,{' '}
              <span className="font-mono tabular-nums text-gray-100">{formatUnits(wallet.limits.periodCapUnits)}</span> per period
            </p>
          )}
          <p className="text-xs">
            Agent:{' '}
            {wallet.revoked ? <span className="font-semibold text-red-300">{'✕'} revoked</span> : <span className="text-gray-100">active within your mandate</span>}
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer text-gray-400">Deposit more</summary>
            <DepositForm amount={amount} setAmount={setAmount} disabled={flowBusy} onDeposit={onDeposit} />
          </details>
        </div>
      ) : (
        <ol className="mt-3 space-y-3">
          <Step n={1} title="Connect your wallet" done={isConnected && !!publicKey}>
            {!isConnected && (
              <button onClick={connect} className="mt-1 rounded bg-primary-700 hover:bg-primary-600 px-3 py-1 text-xs font-semibold text-white">
                Connect wallet
              </button>
            )}
            {publicKey && <p className="font-mono text-xs text-gray-400">{shortAddress(publicKey)}</p>}
          </Step>
          <Step n={2} title="Get test USDC" done={false}>
            <TestUsdc />
          </Step>
          <Step n={3} title="Create your mandate wallet" done={!!wallet}>
            {wallet ? (
              <p className="text-xs">
                <a href={contractUrl(wallet.contractId)} target="_blank" rel="noopener noreferrer" className="font-mono underline underline-offset-2" title={wallet.contractId}>
                  {shortAddress(wallet.contractId)}
                </a>
              </p>
            ) : (
              <>
                <p className="text-xs text-gray-400">
                  {mandateApproved
                    ? 'It starts with the limits of your approved mandate. You own it and can revoke the agent at any time. A card shows the deploy before your wallet opens.'
                    : 'Approve your mandate first: the wallet starts with its limits.'}
                </p>
                <button onClick={onCreate} disabled={!publicKey || flowBusy || !mandateApproved} className="mt-1 rounded bg-primary-700 hover:bg-primary-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">
                  Review the deploy
                </button>
              </>
            )}
          </Step>
          <Step n={4} title="Deposit USDC" done={funded}>
            {wallet ? (
              <DepositForm amount={amount} setAmount={setAmount} disabled={flowBusy} onDeposit={onDeposit} />
            ) : (
              <p className="text-xs text-gray-400">After the wallet exists.</p>
            )}
          </Step>
        </ol>
      )}
      <p className="mt-3 text-[11px] text-gray-400">{LABEL_TEST_ASSETS}</p>
    </section>
  );
};

const DepositForm: React.FC<{ amount: string; setAmount: (v: string) => void; disabled: boolean; onDeposit: (a: string) => void }> = ({
  amount,
  setAmount,
  disabled,
  onDeposit,
}) => {
  const valid = /^\d+(\.\d{1,7})?$/.test(amount.trim()) && Number(amount) > 0;
  return (
    <form
      className="mt-1 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onDeposit(amount.trim());
      }}
    >
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        placeholder="Amount"
        className="w-28 rounded border border-white/[0.12] bg-white/5 px-2 py-1 font-mono text-xs tabular-nums text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <span className="text-xs text-gray-400">USDC</span>
      <button type="submit" disabled={disabled || !valid} className="rounded bg-primary-700 hover:bg-primary-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">
        Review the deposit
      </button>
    </form>
  );
};

export default WalletSetup;
