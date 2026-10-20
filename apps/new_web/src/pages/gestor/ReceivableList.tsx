import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { cedenteService, fundService, receivableService, sacadoService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandler';
import { useAuth } from '../../contexts/useAuth';
import type { Receivable } from '../../types/receivableChain';
import UsdcAmount from '../../components/UsdcAmount';
import { badgeClass, formatReceivableDate, primaryButton, receivableInput, receivablePanel, secondaryButton, statusLabel } from '../../components/receivables/receivablePresentation';

interface Option {
  id: string; name: string; status?: string; fundId?: string; fund?: { id: string };
}

export default function ReceivableList() {
  const { user } = useAuth();
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [funds, setFunds] = useState<Option[]>([]);
  const [cedentes, setCedentes] = useState<Option[]>([]);
  const [sacados, setSacados] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true), [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ fundId: '', cedenteId: '', sacadoId: '', faceValue: '', dueDate: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rec, fundRes, cedRes, sacRes] = await Promise.all([
        receivableService.list(), fundService.list(), cedenteService.list(), sacadoService.list(),
      ]);
      setReceivables(rec.receivables || []);
      setFunds((fundRes.funds || []).filter((f: Option) => f.status === 'APPROVED'));
      setCedentes((cedRes.cedentes || []).filter((c: Option) => c.status === 'APPROVED'));
      setSacados((sacRes.sacados || []).filter((s: Option) => s.status === 'APPROVED'));
      setError('');
    } catch (e) { setError(getErrorMessage(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (user?.role === 'GESTOR') void loadData(); }, [loadData, user?.role]);
  const fundIdOf = (o: Option) => o.fundId || o.fund?.id;
  const fundCedentes = useMemo(() => cedentes.filter(c => fundIdOf(c) === form.fundId), [cedentes, form.fundId]);
  const fundSacados = useMemo(() => sacados.filter(s => fundIdOf(s) === form.fundId), [sacados, form.fundId]);
  if (user?.role !== 'GESTOR') return <Navigate to="/dashboard" />;

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      await receivableService.create({ fundId: form.fundId, cedenteId: form.cedenteId, sacadoId: form.sacadoId,
        faceValue: Number(form.faceValue), dueDate: new Date(form.dueDate).toISOString() });
      toast.success('Receivable created. Open its details to register it on Stellar.');
      setForm({ fundId: '', cedenteId: '', sacadoId: '', faceValue: '', dueDate: '' });
      await loadData();
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setCreating(false); }
  };

  return <div className="space-y-6">
    <section className={receivablePanel}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs uppercase tracking-[0.2em] text-emerald-300">Fund manager</p>
          <h1 className="mt-1 text-28 font-medium text-white">Receivables</h1>
          <p className="mt-2 text-sm text-white/60">Manage receivables, record payments and track their Stellar activity.</p>
        </div>
        <button disabled={loading || creating} onClick={() => void loadData()} className={secondaryButton}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" />Refresh
        </button>
      </div>
      <form onSubmit={handleCreate} className="mt-6 grid grid-cols-1 items-end gap-3 border-t border-white/10 pt-6 sm:grid-cols-2 xl:grid-cols-6">
        <label className="space-y-2 text-xs text-white/70">Fund
          <select className={receivableInput + ' mt-2'} value={form.fundId} onChange={e => setForm({ ...form, fundId: e.target.value, cedenteId: '', sacadoId: '' })} required disabled={creating}>
            <option value="">Select fund</option>{funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-xs text-white/70">Assignor
          <select className={receivableInput + ' mt-2'} value={form.cedenteId} onChange={e => setForm({ ...form, cedenteId: e.target.value })} required disabled={creating || !form.fundId}>
            <option value="">Select assignor</option>{fundCedentes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-xs text-white/70">Debtor
          <select className={receivableInput + ' mt-2'} value={form.sacadoId} onChange={e => setForm({ ...form, sacadoId: e.target.value })} required disabled={creating || !form.fundId}>
            <option value="">Select debtor</option>{fundSacados.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-xs text-white/70">Face value (USDC)
          <input className={receivableInput + ' mt-2'} type="number" min="0.01" step="0.01" placeholder="0.00" value={form.faceValue} onChange={e => setForm({ ...form, faceValue: e.target.value })} required disabled={creating} />
        </label>
        <label className="space-y-2 text-xs text-white/70">Due date
          <input className={receivableInput + ' mt-2'} type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} required disabled={creating} />
        </label>
        <button type="submit" disabled={creating || loading} className={primaryButton}>{creating ? 'Adding...' : 'Add receivable'}</button>
      </form>
    </section>

    <section className={receivablePanel}>
      <div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-20 font-medium text-white">All receivables</h2><span className="text-xs text-white/50">{receivables.length} total</span></div>
      {error && <p role="alert" className="mb-4 rounded-card border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
      {loading ? <p className="py-8 text-center text-sm text-white/60">Loading receivables...</p> : receivables.length === 0 ?
        <p className="py-8 text-center text-sm text-white/50">No receivables yet.</p> :
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-white/80">
            <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-white/40"><tr>
              <th className="pb-3 pr-5 font-medium">Fund</th><th className="pb-3 pr-5 font-medium">Assignor / Debtor</th>
              <th className="pb-3 pr-5 font-medium">Face value</th><th className="pb-3 pr-5 font-medium">Due date</th>
              <th className="pb-3 pr-5 font-medium">Status</th><th className="pb-3 pr-5 font-medium">On Stellar</th><th className="pb-3 text-right font-medium">Details</th>
            </tr></thead>
            <tbody>{receivables.map(item => <tr key={item.id} className="border-b border-white/5 last:border-0">
              <td className="py-4 pr-5"><p className="font-medium text-white">{item.fund?.name}</p><p className="mt-1 text-xs text-white/40">{item.fund?.symbol}</p></td>
              <td className="py-4 pr-5"><p>{item.cedente?.name || '-'}</p><p className="mt-1 text-xs text-white/50">{item.sacado?.name}</p></td>
              <td className="whitespace-nowrap py-4 pr-5"><UsdcAmount amount={item.faceValue} /></td>
              <td className="whitespace-nowrap py-4 pr-5">{formatReceivableDate(item.dueDate)}</td>
              <td className="py-4 pr-5"><span className={'inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs' + badgeClass(item.status)}>{statusLabel(item.status)}</span></td>
              <td className="py-4 pr-5"><span className={'inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs' + badgeClass(item.chainStatus)}>{item.chainStatus === 'PENDING' ? 'Registered' : statusLabel(item.chainStatus)}</span></td>
              <td className="py-4 text-right"><Link to={'/receivables/' + item.id} className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-emerald-300 hover:text-emerald-300 hover:underline">View details<ArrowUpRight size={15} aria-hidden="true" /></Link></td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>
  </div>;
}
