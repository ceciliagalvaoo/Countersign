import React, { useState } from 'react';
import { useNavigate, Navigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { sacadoService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandler';
import { useAuth } from '../../contexts/useAuth';

type DebtorForm = {
  name: string;
  document: string;
  personType: 'PF' | 'PJ';
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  sector: string;
  size: string;
  rating: string;
  paymentHistory: string;
  exposure: string;
  creditLimitFund: string;
  concentrationPercent: string;
  defaultRate30d: string;
  defaultRate60d: string;
  defaultRate90d: string;
  fundId: string;
};

const DebtorCreate: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const params = useParams<{ fundId?: string }>();
  const [searchParams] = useSearchParams();
  const initialFundId = searchParams.get('fundId') || params.fundId || '';
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<DebtorForm>({
    name: '',
    document: '',
    personType: 'PJ',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    country: 'BR',
    postalCode: '',
    sector: '',
    size: '',
    rating: '',
    paymentHistory: '',
    exposure: '',
    creditLimitFund: '',
    concentrationPercent: '',
    defaultRate30d: '',
    defaultRate60d: '',
    defaultRate90d: '',
    fundId: initialFundId,
  });

  const handleChange = (field: keyof DebtorForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await sacadoService.create({
        name: form.name,
        document: form.document,
        personType: form.personType,
        email: form.email,
        phone: form.phone,
        address: form.address,
        city: form.city,
        state: form.state,
        country: form.country,
        postalCode: form.postalCode,
        sector: form.sector,
        size: form.size,
        rating: form.rating,
        paymentHistory: form.paymentHistory,
        exposure: form.exposure ? Number(form.exposure) : undefined,
        creditLimitFund: form.creditLimitFund ? Number(form.creditLimitFund) : undefined,
        concentrationPercent: form.concentrationPercent ? Number(form.concentrationPercent) : undefined,
        defaultRate30d: form.defaultRate30d ? Number(form.defaultRate30d) : undefined,
        defaultRate60d: form.defaultRate60d ? Number(form.defaultRate60d) : undefined,
        defaultRate90d: form.defaultRate90d ? Number(form.defaultRate90d) : undefined,
        fundId: form.fundId || undefined,
      });
      toast.success('Debtor created successfully');
      navigate('/debtors');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  if (user?.role !== 'CONSULTOR') {
    return <Navigate to="/dashboard" replace />;
  }

  const handleMock = () => {
    setForm((prev) => ({
      ...prev,
      name: 'Sacado Tech SA',
      document: '98.765.432/0001-10',
      personType: 'PJ',
      email: 'finance@debtor-tech.com',
      phone: '+1 555-8888-8888',
      address: '1000 Paulista Ave',
      city: 'São Paulo',
      state: 'SP',
      country: 'BR',
      postalCode: '01310-000',
      sector: 'Technology',
      size: 'Mid-size',
      rating: 'A-',
      paymentHistory: 'Good history, no recent delays',
      exposure: '200000',
      creditLimitFund: '500000',
      concentrationPercent: '10',
      defaultRate30d: '0.5',
      defaultRate60d: '0.3',
      defaultRate90d: '0.1',
    }));
  };

  const inputBase =
    'w-full rounded-lg px-3 py-2 bg-white/5 border border-white/15 text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#169976] focus:border-transparent transition';
  const labelBase =
    'block text-xs font-semibold text-white/80 mb-1 tracking-wide uppercase';
  const sectionTitle = 'text-sm font-semibold text-emerald-300';
  const sectionSubtitle = 'text-xs text-white/60';

  return (
    <div className="min-h-screen bg-[#00000] text-white">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
            <div>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
                Create Debtor
              </h2>
              <p className="text-xs md:text-sm text-white/70 mt-1">
                Register a new debtor with identification, risk and exposure limits.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleMock}
                className="text-xs md:text-sm px-3 py-2 rounded-lg border border-white/30 text-white/80 hover:bg-white/10 transition"
              >
                Fill with mock
              </button>
              <button
                onClick={() => navigate('/debtors')}
                className="text-xs md:text-sm text-white/70 hover:text-white underline-offset-4 hover:underline transition"
              >
                Back to debtors
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-10">
            {/* 1) Identification */}
            <div className="space-y-2">
              <h3 className={sectionTitle}>1) Identification</h3>
              <p className={sectionSubtitle}>
                Basic debtor data (sacado).
              </p>
            </div>
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelBase}>Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  required
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Document (CNPJ/CPF) *</label>
                <input
                  type="text"
                  value={form.document}
                  onChange={(e) => handleChange('document', e.target.value)}
                  required
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Person type</label>
                <select
                  value={form.personType}
                  onChange={(e) =>
                    handleChange('personType', e.target.value as DebtorForm['personType'])
                  }
                  className={inputBase}
                >
                  <option value="PJ" className="text-black">
                    PJ
                  </option>
                  <option value="PF" className="text-black">
                    PF
                  </option>
                </select>
              </div>
              <div>
                <label className={labelBase}>Sector</label>
                <input
                  type="text"
                  value={form.sector}
                  onChange={(e) => handleChange('sector', e.target.value)}
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Size</label>
                <input
                  type="text"
                  value={form.size}
                  onChange={(e) => handleChange('size', e.target.value)}
                  className={inputBase}
                  placeholder="ME, EPP, Mid, Large..."
                />
              </div>
              <div>
                <label className={labelBase}>Rating</label>
                <input
                  type="text"
                  value={form.rating}
                  onChange={(e) => handleChange('rating', e.target.value)}
                  className={inputBase}
                />
              </div>
            </section>

            {/* 2) Contact & address */}
            <div className="space-y-2">
              <h3 className={sectionTitle}>2) Contact &amp; address</h3>
              <p className={sectionSubtitle}>Contact and location information.</p>
            </div>
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelBase}>Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Phone</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  className={inputBase}
                />
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelBase}>Address</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => handleChange('address', e.target.value)}
                  className={inputBase}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => handleChange('city', e.target.value)}
                  className={inputBase}
                  placeholder="City"
                />
                <input
                  type="text"
                  value={form.state}
                  onChange={(e) => handleChange('state', e.target.value)}
                  className={inputBase}
                  placeholder="State"
                />
                <input
                  type="text"
                  value={form.country}
                  onChange={(e) => handleChange('country', e.target.value)}
                  className={inputBase}
                  placeholder="Country"
                />
              </div>
              <div>
                <label className={labelBase}>Postal code</label>
                <input
                  type="text"
                  value={form.postalCode}
                  onChange={(e) => handleChange('postalCode', e.target.value)}
                  className={inputBase}
                />
              </div>
            </section>

            {/* 3) Risk & exposure */}
            <div className="space-y-2">
              <h3 className={sectionTitle}>3) Risk &amp; exposure</h3>
              <p className={sectionSubtitle}>
                Payment history, current exposure and risk notes.
              </p>
            </div>
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelBase}>History / notes</label>
                <textarea
                  value={form.paymentHistory}
                  onChange={(e) => handleChange('paymentHistory', e.target.value)}
                  className={inputBase}
                  rows={3}
                  placeholder="Payment history with assignor, risk notes, etc."
                />
              </div>
              <div>
                <label className={labelBase}>Exposure (value in fund)</label>
                <input
                  type="number"
                  value={form.exposure}
                  onChange={(e) => handleChange('exposure', e.target.value)}
                  className={inputBase}
                />
              </div>
            </section>

            {/* 4) Limits & concentration */}
            <div className="space-y-2">
              <h3 className={sectionTitle}>4) Limits &amp; concentration</h3>
              <p className={sectionSubtitle}>
                Define exposure limits, concentration and observed default rates.
              </p>
            </div>
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelBase}>Credit limit in fund</label>
                <input
                  type="number"
                  value={form.creditLimitFund}
                  onChange={(e) => handleChange('creditLimitFund', e.target.value)}
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>% concentration allowed</label>
                <input
                  type="number"
                  value={form.concentrationPercent}
                  onChange={(e) => handleChange('concentrationPercent', e.target.value)}
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Default rate 30d (%)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.defaultRate30d}
                  onChange={(e) => handleChange('defaultRate30d', e.target.value)}
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Default rate 60d (%)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.defaultRate60d}
                  onChange={(e) => handleChange('defaultRate60d', e.target.value)}
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Default rate 90d (%)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.defaultRate90d}
                  onChange={(e) => handleChange('defaultRate90d', e.target.value)}
                  className={inputBase}
                />
              </div>
            </section>

            {/* Fund ID */}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {form.fundId && (
                <div>
                  <label className={labelBase}>Fund ID (auto)</label>
                  <input
                    type="text"
                    value={form.fundId}
                    disabled
                    className="w-full rounded-lg px-3 py-2 bg-white/5 border border-white/20 text-white/60 text-sm"
                  />
                </div>
              )}
            </section>

            {/* Actions */}
            <div className="flex justify-end pt-4">
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-3 text-sm font-medium rounded-2xl bg-white text-black hover:opacity-90 hover:scale-[1.02] shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? 'Saving…' : 'Create Debtor'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default DebtorCreate;
