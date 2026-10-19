import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { Receivable } from '../../types/receivableChain';
import { toUnits } from '../../utils/units';
import { getErrorMessage } from '../../utils/errorHandler';
import UsdcAmount from '../UsdcAmount';
import { primaryButton, receivableInput, secondaryButton } from './receivablePresentation';

interface Props { item: Receivable; onClose: () => void; onConfirm: (amount: number) => Promise<void> }

export default function RecordPaymentModal({ item, onClose, onConfirm }: Props) {
  const [amount, setAmount] = useState(String(item.faceValue));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId(), descriptionId = useId(), amountId = useId(), errorId = useId();
  const dialog = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false), closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    input.current?.focus(); input.current?.select();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { if (!busyRef.current) closeRef.current(); event.preventDefault(); }
      if (event.key !== 'Tab') return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]');
      if (!elements?.length) { event.preventDefault(); dialog.current?.focus(); return; }
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    const units = toUnits(amount), value = Number(amount);
    if (units === null || units <= 0n || !Number.isFinite(value)) {
      setError('Enter an amount greater than zero, with up to 7 decimal places.'); return;
    }
    busyRef.current = true; setBusy(true); setError('');
    try { await onConfirm(value); }
    catch (e) { setError(getErrorMessage(e)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={event => { if (event.target === event.currentTarget && !busyRef.current) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
        aria-busy={busy} tabIndex={-1}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/[0.12] bg-[#0c1723]/95 p-6 text-white shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs uppercase tracking-[0.2em] text-emerald-300">Receivable payment</p>
            <h2 id={titleId} className="mt-1 text-xl font-semibold">Record payment</h2></div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close payment dialog" className="rounded-lg p-1 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-50"><X size={20} /></button>
        </div>
        <div className="my-5 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
          <p className="font-medium">{item.fund?.name}</p>
          <p className="mt-1 text-white/60">Debtor: {item.sacado?.name}</p>
          <p className="mt-2 text-white/80">Face value: <UsdcAmount amount={item.faceValue} /></p>
        </div>
        <p id={descriptionId} className="mb-5 text-sm leading-relaxed text-white/60">Record the amount received from the debtor. Moving USDC into the vault and distributing it require separate Stellar transactions.</p>
        <form onSubmit={submit} className="space-y-5">
          <div><label htmlFor={amountId} className="mb-2 block text-sm font-medium text-white/80">Amount received (USDC)</label>
            <input ref={input} id={amountId} type="number" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setError(''); }}
              min="0.0000001" step="0.0000001" required disabled={busy} className={receivableInput}
              aria-invalid={!!error} aria-describedby={error ? errorId : undefined} />
          </div>
          {error && <p id={errorId} role="alert" className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>Cancel</button>
            <button type="submit" disabled={busy || !amount} className={primaryButton}>{busy ? 'Saving...' : 'Record payment'}</button>
          </div>
        </form>
      </div>
    </div>, document.body,
  );
}
