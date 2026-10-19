import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/useAuth';
import { useWallet } from '../../contexts/WalletContext';
import { multisigService, receivableService } from '../../services/api';
import { recordReceivableStep } from '../../services/receivableFlow';
import type { ChainProgress, Receivable } from '../../types/receivableChain';
import { getErrorMessage } from '../../utils/errorHandler';
import { shortHash } from '../../utils/units';
import UsdcAmount from '../../components/UsdcAmount';
import ReceivableProgress from '../../components/receivables/ReceivableProgress';
import RecordPaymentModal from '../../components/receivables/RecordPaymentModal';
import { badgeClass, formatReceivableDate, primaryButton, receivablePanel, secondaryButton, statusLabel, visibleSteps } from '../../components/receivables/receivablePresentation';

export default function ReceivableDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { publicKey, isConnected, connect, signTransaction, signAndSubmitTransaction } = useWallet();
  const [item, setItem] = useState<Receivable | null>(null);
  const [progress, setProgress] = useState<ChainProgress | null>(null);
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false), [paymentOpen, setPaymentOpen] = useState(false);
  const [error, setError] = useState(''), [progressError, setProgressError] = useState('');
  const [feedback, setFeedback] = useState<{ message: string; hash?: string; failed?: boolean } | null>(null);
  const latestLoad = useRef(0);

  const loadData = useCallback(async () => {
    if (!id) return;
    const version = ++latestLoad.current;
    setRefreshing(true);
    const [record, activity] = await Promise.allSettled([receivableService.get(id), receivableService.progress(id)]);
    if (version !== latestLoad.current) return;
    if (record.status === 'fulfilled') { setItem(record.value.receivable); setError(''); }
    else { setItem(current => current?.id === id ? current : null); setError(getErrorMessage(record.reason)); }
    if (activity.status === 'fulfilled') { setProgress(activity.value); setProgressError(''); }
    else { setProgressError(getErrorMessage(activity.reason)); }
    setLoading(false); setRefreshing(false);
  }, [id]);

  useEffect(() => {
    if (user?.role === 'GESTOR') void loadData();
    return () => { latestLoad.current++; };
  }, [loadData, publicKey, user?.role]);
  const closePayment = useCallback(() => setPaymentOpen(false), []);

  if (user?.role !== 'GESTOR') return <Navigate to="/dashboard" />;
  if (loading || (item && item.id !== id)) return <div className={`${receivablePanel} text-sm text-white/60`}>Loading receivable...</div>;
  if (!item) return <div className={`${receivablePanel} space-y-4 text-white`}>
    <h1 className="text-xl font-semibold">Unable to load receivable</h1><p role="alert" className="text-sm text-red-200">{error}</p>
    <Link to="/receivables" className={secondaryButton}>Back to receivables</Link>
    <button onClick={() => void loadData()} disabled={refreshing} className={secondaryButton}>Try again</button>
  </div>;

  const steps = visibleSteps(item, progress), nextStep = steps.find(s => s.state !== 'CONFIRMED');
  const chainStatus = progress?.chainStatus || item.chainStatus;
  const verificationRequired = progress?.steps.some(s => s.verificationHash);
  const waitingForAnotherSigner = !verificationRequired && !!nextStep?.multisig &&
    nextStep.multisig.weight < nextStep.multisig.threshold && nextStep.multisig.signedBy.includes(publicKey || '');
  const target = item.paidValue != null ? 'DISTRIBUTED' : 'PENDING';
  const ready = chainStatus === target || chainStatus === 'DISTRIBUTED';
  const canRecordPayment = item.status === 'PENDING' && item.paidValue == null;

  const recordOnChain = async () => {
    if (!isConnected || !publicKey) { await connect(); return; }
    setBusy(true); setFeedback(null);
    const toastId = toast.loading('Waiting for Stellar confirmation...');
    try {
      const result = await recordReceivableStep(item.id, publicKey, {
        expectedStepId: nextStep?.stepId, chain: receivableService.chain,
        sign: multisigService.sign, signTransaction, signAndSubmitTransaction,
      });
      setFeedback({ message: result.message, hash: result.kind === 'confirmed' ? result.step.txHash : undefined });
      if (result.kind === 'confirmed' || result.kind === 'done') toast.success(result.message, { id: toastId });
      else toast(result.message, { id: toastId });
    } catch (e) {
      const message = getErrorMessage(e); setFeedback({ message, failed: true }); toast.error(message, { id: toastId });
    } finally { await loadData(); setBusy(false); }
  };

  const recordPayment = async (amount: number) => {
    setBusy(true);
    try {
      const response = await receivableService.markPaid(item.id, amount);
      setItem(current => current ? { ...current, ...response.receivable } : current);
      setPaymentOpen(false);
      setFeedback({ message: 'Payment recorded. Review the next Stellar step to move the USDC into the vault.' });
      toast.success('Payment recorded');
      await loadData();
    } finally { setBusy(false); }
  };

  return <div className="mx-auto max-w-6xl space-y-6">
    <Link to="/receivables" className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white"><ArrowLeft size={16} aria-hidden="true" />Back to receivables</Link>
    <section className={receivablePanel}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0"><p className="text-xs uppercase tracking-[0.2em] text-emerald-300">Fund manager</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Receivable details</h1>
          <p className="mt-2 text-sm text-white/60">{item.fund?.name} <span className="text-white/40">· {item.fund?.symbol}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${badgeClass(item.status)}`}>{statusLabel(item.status)}</span>
          <button onClick={() => void loadData()} disabled={busy || refreshing} className={secondaryButton}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />{refreshing ? 'Refreshing...' : 'Refresh status'}
          </button>
        </div>
      </div>
      <dl className="mt-6 grid grid-cols-1 gap-5 border-t border-white/10 pt-6 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Face value"><UsdcAmount amount={item.faceValue} /></Field>
        <Field label="Due date">{formatReceivableDate(item.dueDate)}</Field>
        <Field label="Stellar status">{chainStatus === 'PENDING' ? 'Registered' : statusLabel(chainStatus)}</Field>
        <Field label="Assignor">{item.cedente?.name || 'Not recorded'}</Field>
        <Field label="Debtor">{item.sacado?.name || 'Not recorded'}</Field>
        <Field label="Amount received">{item.paidValue != null ? <UsdcAmount amount={item.paidValue} /> : 'Not recorded'}</Field>
        <Field label="Created">{formatReceivableDate(item.createdAt)}</Field>
        <Field label="Payment recorded">{formatReceivableDate(item.paidAt)}</Field>
        <Field label="Receivable ID"><span className="break-all font-mono text-xs">{item.id}</span></Field>
      </dl>
    </section>

    <section className={receivablePanel} aria-labelledby="receivable-actions-title">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0"><h2 id="receivable-actions-title" className="text-lg font-semibold text-white">{verificationRequired ? 'Verify submitted transaction' : ready ? chainStatus === 'DISTRIBUTED' ? 'Distribution complete' : 'Registration complete' : nextStep?.label || 'Next action'}</h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-white/60">
            {chainStatus === 'DISTRIBUTED' ? 'The payment has been distributed. Transaction records are available below.' :
              ready ? 'Record the debtor payment when it has been received.' : waitingForAnotherSigner ?
                'Your signature is saved. Connect another eligible wallet to complete this step.' :
                'Complete one step at a time. Each confirmed transaction appears in the activity below before you continue.'}
          </p>
          {nextStep?.multisig && !ready && <p className="mt-2 text-xs text-amber-200">{nextStep.multisig.signedBy.length} {nextStep.multisig.signedBy.length === 1 ? 'signer' : 'signers'} · Weight {nextStep.multisig.weight} / {nextStep.multisig.threshold}</p>}
        </div>
        <div className="flex flex-wrap gap-3">
          {canRecordPayment && <button onClick={() => setPaymentOpen(true)} disabled={busy || refreshing} className={secondaryButton}>Record payment</button>}
          {(!ready || verificationRequired) && <button onClick={() => void recordOnChain()} disabled={busy || refreshing || waitingForAnotherSigner || !progress || !!progressError || !!error} className={primaryButton}>
            {busy ? 'Processing...' : verificationRequired ? 'Verify transaction' : waitingForAnotherSigner ? 'Awaiting another signer' : !isConnected ? 'Connect wallet' : 'Record on Stellar'}
          </button>}
        </div>
      </div>
      {progressError && <p role="alert" className="mt-4 text-sm text-red-200">Unable to refresh Stellar progress: {progressError}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-200">{error}</p>}
      {feedback && <div role="status" className={`mt-4 rounded-xl border p-4 text-sm ${feedback.failed ? 'border-red-400/20 bg-red-400/10 text-red-200' : 'border-emerald-400/20 bg-emerald-400/5 text-white/80'}`}>
        <p>{feedback.message}</p>
        {feedback.hash && <a href={`https://stellar.expert/explorer/testnet/tx/${feedback.hash}`} target="_blank" rel="noopener noreferrer" title={feedback.hash} className="mt-2 inline-flex items-center gap-2 text-emerald-300 hover:underline">View confirmed transaction {shortHash(feedback.hash)}<ExternalLink size={14} /></a>}
      </div>}
    </section>

    <section className={receivablePanel}>
      <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-wider text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Stellar Testnet</div>
      {progress ? <ReceivableProgress item={item} progress={progress} publicKey={publicKey} /> : <p className="text-sm text-white/60">Activity is unavailable. Refresh status to try again.</p>}
    </section>
    {paymentOpen && <RecordPaymentModal item={item} onClose={closePayment} onConfirm={recordPayment} />}
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-white/50">{label}</dt><dd className="mt-1 text-sm font-medium text-white/90">{children}</dd></div>;
}
