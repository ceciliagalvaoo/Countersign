import React, { useState } from 'react';
import { useNavigate, Navigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { cedenteService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandler';
import { useAuth } from '../../contexts/useAuth';

type AssignorForm = {
  name: string;
  fantasyName: string;
  document: string;
  cnae: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  beneficialOwners: string;
  isPep: 'no' | 'yes';
  revenueLast12m: string;
  totalDebt: string;
  mainBanks: string;
  riskRating: string;
  operationDescription: string;
  creditPolicy: string;
  guarantees: string;
  fundId: string;
};

const AssignorCreate: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const params = useParams<{ fundId?: string }>();
  const [searchParams] = useSearchParams();
  const initialFundId = searchParams.get('fundId') || params.fundId || '';
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<AssignorForm>({
    name: '',
    fantasyName: '',
    document: '',
    cnae: '',
    email: '',
    phone: '',
    website: '',
    address: '',
    city: '',
    state: '',
    country: 'BR',
    postalCode: '',
    beneficialOwners: '',
    isPep: 'no',
    revenueLast12m: '',
    totalDebt: '',
    mainBanks: '',
    riskRating: '',
    operationDescription: '',
    creditPolicy: '',
    guarantees: '',
    fundId: initialFundId,
  });

  const handleChange = (field: keyof AssignorForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await cedenteService.create({
        name: form.name,
        fantasyName: form.fantasyName,
        document: form.document,
        cnae: form.cnae,
        email: form.email,
        phone: form.phone,
        website: form.website,
        address: form.address,
        city: form.city,
        state: form.state,
        country: form.country,
        postalCode: form.postalCode,
        beneficialOwners: form.beneficialOwners,
        isPep: form.isPep === 'yes',
        revenueLast12m: form.revenueLast12m ? Number(form.revenueLast12m) : undefined,
        totalDebt: form.totalDebt ? Number(form.totalDebt) : undefined,
        mainBanks: form.mainBanks,
        riskRating: form.riskRating,
        operationDescription: form.operationDescription,
        creditPolicy: form.creditPolicy,
        guarantees: form.guarantees,
        fundId: form.fundId || undefined,
      });
      toast.success('Assignor created successfully');
      navigate('/assignors');
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
      name: 'Assignor Agro Ltda',
      fantasyName: 'Assignor Agro',
      document: '12.345.678/0001-90',
      cnae: '0111-3/01',
      email: 'contact@assignoragro.com',
      phone: '+1 555-9999-9999',
      website: 'https://assignoragro.com',
      address: '123 Flower St, São Paulo',
      city: 'São Paulo',
      state: 'SP',
      country: 'BR',
      postalCode: '01000-000',
      beneficialOwners: 'John Doe; Mary Smith',
      isPep: 'no',
      revenueLast12m: '5000000',
      totalDebt: '2000000',
      mainBanks: 'Bank X; Bank Y',
      riskRating: 'BBB-',
      operationDescription: 'Supply of agricultural inputs',
      creditPolicy: 'Debtors with internal rating min B, registered invoices',
      guarantees: 'Recourse; credit insurance',
    }));
  };

  const inputBase =
    'w-full rounded-lg px-3 py-2 bg-white/5 border border-white/15 text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#169976] focus:border-transparent transition';
  const labelBase = 'block text-xs font-semibold text-white/80 mb-1 tracking-wide uppercase';
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
                Create Assignor
              </h2>
              <p className="text-xs md:text-sm text-white/70 mt-1">
                Onboard a new assignor with full KYC, risk and operational details.
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
                onClick={() => navigate('/assignors')}
                className="text-xs md:text-sm text-white/70 hover:text-white underline-offset-4 hover:underline transition"
              >
                Back to assignors
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-10">
            {/* 1) Identification & KYC */}
            <div className="space-y-2">
              <h3 className={sectionTitle}>1) Identification &amp; KYC</h3>
              <p className={sectionSubtitle}>
                Basic assignor info and regulatory identification.
              </p>
            </div>
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelBase}>Legal name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  required
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Trade name</label>
                <input
                  type="text"
                  value={form.fantasyName}
                  onChange={(e) => handleChange('fantasyName', e.target.value)}
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>CNPJ *</label>
                <input
                  type="text"
                  value={form.document}
                  onChange={(e) => handleChange('document', e.target.value)}
                  required
                  className={inputBase}
                  placeholder="00.000.000/0000-00"
                />
              </div>
              <div>
                <label className={labelBase}>CNAE / Activity</label>
                <input
                  type="text"
                  value={form.cnae}
                  onChange={(e) => handleChange('cnae', e.target.value)}
                  className={inputBase}
                />
              </div>
            </section>

            {/* 2) Contact & Address */}
            <div className="space-y-2">
              <h3 className={sectionTitle}>2) Contact &amp; address</h3>
              <p className={sectionSubtitle}>Contact and location information.</p>
            </div>
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelBase}>Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  required
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Phone *</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  required
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Website</label>
                <input
                  type="text"
                  value={form.website}
                  onChange={(e) => handleChange('website', e.target.value)}
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

            {/* 3) Compliance */}
            <div className="space-y-2">
              <h3 className={sectionTitle}>3) Compliance</h3>
              <p className={sectionSubtitle}>Beneficial owners and PEP.</p>
            </div>
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelBase}>Controllers / Beneficial owners</label>
                <textarea
                  value={form.beneficialOwners}
                  onChange={(e) => handleChange('beneficialOwners', e.target.value)}
                  className={inputBase}
                  rows={3}
                />
              </div>
              <div>
                <label className={labelBase}>PEP?</label>
                <select
                  value={form.isPep}
                  onChange={(e) => handleChange('isPep', e.target.value as AssignorForm['isPep'])}
                  className={inputBase}
                >
                  <option value="no" className="text-black">
                    No
                  </option>
                  <option value="yes" className="text-black">
                    Yes
                  </option>
                </select>
              </div>
            </section>

            {/* 4) Finance & risk */}
            <div className="space-y-2">
              <h3 className={sectionTitle}>4) Finance &amp; risk</h3>
              <p className={sectionSubtitle}>Revenue, debt, and rating.</p>
            </div>
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelBase}>Revenue last 12m</label>
                <input
                  type="number"
                  value={form.revenueLast12m}
                  onChange={(e) => handleChange('revenueLast12m', e.target.value)}
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Total debt</label>
                <input
                  type="number"
                  value={form.totalDebt}
                  onChange={(e) => handleChange('totalDebt', e.target.value)}
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Main banks</label>
                <input
                  type="text"
                  value={form.mainBanks}
                  onChange={(e) => handleChange('mainBanks', e.target.value)}
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Risk rating</label>
                <input
                  type="text"
                  value={form.riskRating}
                  onChange={(e) => handleChange('riskRating', e.target.value)}
                  className={inputBase}
                />
              </div>
            </section>

            {/* 5) Operation & guarantees */}
            <div className="space-y-2">
              <h3 className={sectionTitle}>5) Operation &amp; guarantees</h3>
              <p className={sectionSubtitle}>
                Describe credit origination, credit policy, and guarantees.
              </p>
            </div>
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-1">
                <label className={labelBase}>Operation description</label>
                <textarea
                  value={form.operationDescription}
                  onChange={(e) => handleChange('operationDescription', e.target.value)}
                  className={inputBase}
                  rows={3}
                />
              </div>
              <div className="md:col-span-1">
                <label className={labelBase}>Credit policy to debtors</label>
                <textarea
                  value={form.creditPolicy}
                  onChange={(e) => handleChange('creditPolicy', e.target.value)}
                  className={inputBase}
                  rows={3}
                />
              </div>
              <div className="md:col-span-1">
                <label className={labelBase}>Guarantees offered</label>
                <textarea
                  value={form.guarantees}
                  onChange={(e) => handleChange('guarantees', e.target.value)}
                  className={inputBase}
                  rows={3}
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
                {loading ? 'Saving…' : 'Create Assignor'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AssignorCreate;
