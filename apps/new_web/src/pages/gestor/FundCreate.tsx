import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fundService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandler';
import { useAuth } from '../../contexts/useAuth';

type FundForm = {
  name: string;
  symbol: string;
  maxSupply: string;
  price: string;
  cnpj: string;
  type: 'FIDC' | 'FIDC_NP';
  targetInvestor: 'GERAL' | 'QUALIFICADO' | 'PROFISSIONAL';
  cvmCode: string;
  administratorName: string;
  administratorCnpj: string;
  managerName: string;
  managerCnpj: string;
  custodianName: string;
  auditorName: string;
  fiduciaryAgentName: string;
  strategy: string;
  eligibility: string;
  limitCedente: string;
  limitSacado: string;
  limitSector: string;
  pmt: string;
  risks: string;
  adminFee: string;
  managementFee: string;
  performanceFee: string;
  otherFees: string;
  liquidityType: 'ABERTO' | 'FECHADO' | 'RESTRITO';
  lockupDays: string;
  redemptionTerms: string;
  nav: string;
  aum: string;
  return12m: string;
  returnYtd: string;
  returnSinceInception: string;
  description: string;
  // Used by the investor recommendation engine
  riskLevel: '' | 'BAIXO' | 'MEDIO' | 'ALTO';
  sector: '' | 'AGRO' | 'VAREJO' | 'INDUSTRIA' | 'SERVICOS' | 'TECH' | 'SAUDE' | 'OUTROS';
  durationMonths: string;
  minTicket: string;
};

const FundCreate: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FundForm>({
    name: '',
    symbol: '',
    maxSupply: '',
    price: '',
    cnpj: '',
    type: 'FIDC',
    targetInvestor: 'PROFISSIONAL',
    cvmCode: '',
    administratorName: '',
    administratorCnpj: '',
    managerName: '',
    managerCnpj: '',
    custodianName: '',
    auditorName: '',
    fiduciaryAgentName: '',
    strategy: '',
    eligibility: '',
    limitCedente: '',
    limitSacado: '',
    limitSector: '',
    pmt: '',
    risks: '',
    adminFee: '',
    managementFee: '',
    performanceFee: '',
    otherFees: '',
    liquidityType: 'FECHADO',
    lockupDays: '',
    redemptionTerms: '',
    nav: '',
    aum: '',
    return12m: '',
    returnYtd: '',
    returnSinceInception: '',
    description: '',
    riskLevel: '',
    sector: '',
    durationMonths: '',
    minTicket: '',
  });

  const handleChange = (field: keyof FundForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleMockFill = () => {
    setForm({
      name: 'Agri Receivables Fund',
      symbol: 'FRA',
      maxSupply: '1000000',
      price: '1.00',
      cnpj: '12.345.678/0001-90',
      type: 'FIDC',
      targetInvestor: 'PROFISSIONAL',
      cvmCode: '99999',
      administratorName: 'Admin XYZ',
      administratorCnpj: '11.222.333/0001-44',
      managerName: 'Manager ABC',
      managerCnpj: '55.666.777/0001-88',
      custodianName: 'Custodian XYZ',
      auditorName: 'Auditor XYZ',
      fiduciaryAgentName: 'Fiduciary Agent XYZ',
      strategy: 'Multisector focus in agro',
      eligibility: 'Approved assignors; debtors with internal rating min B; registered invoices/receivables.',
      limitCedente: '20',
      limitSacado: '15',
      limitSector: '30',
      pmt: '60',
      risks: 'Credit, concentration, liquidity; mitigated via registration and limits.',
      adminFee: '1.5',
      managementFee: '1.0',
      performanceFee: '10',
      otherFees: 'Custody/registry/audit per regulation',
      liquidityType: 'FECHADO', // value kept for backend
      lockupDays: '0',
      redemptionTerms: 'No redemption; secondary trading only.',
      nav: '1.05',
      aum: '5000000',
      return12m: '12.5',
      returnYtd: '4.2',
      returnSinceInception: '18.3',
    description: 'Multisector receivables fund focused on agro with low default history.',
      riskLevel: 'MEDIO',
      sector: 'AGRO',
      durationMonths: '12',
      minTicket: '100',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fundService.create({
        name: form.name,
        symbol: form.symbol,
        maxSupply: Number(form.maxSupply),
        price: form.price ? Number(form.price) : undefined,
        cnpj: form.cnpj || undefined,
        fundType: form.type,
        investorProfile: form.targetInvestor,
        cvmCode: form.cvmCode || undefined,
        administratorName: form.administratorName || undefined,
        administratorCnpj: form.administratorCnpj || undefined,
        managerName: form.managerName || undefined,
        managerCnpj: form.managerCnpj || undefined,
        custodianName: form.custodianName || undefined,
        auditorName: form.auditorName || undefined,
        fiduciaryAgentName: form.fiduciaryAgentName || undefined,
        sectorFocus: form.strategy || undefined,
        eligibilityCriteria: form.eligibility || undefined,
        maxCedenteConcentrationPercent: form.limitCedente ? Number(form.limitCedente) : undefined,
        maxSacadoConcentrationPercent: form.limitSacado ? Number(form.limitSacado) : undefined,
        sectorConcentrationPercent: form.limitSector ? Number(form.limitSector) : undefined,
        targetPmt: form.pmt ? Number(form.pmt) : undefined,
        keyRisks: form.risks || undefined,
        administrationFee: form.adminFee ? Number(form.adminFee) : undefined,
        managementFee: form.managementFee ? Number(form.managementFee) : undefined,
        performanceFee: form.performanceFee ? Number(form.performanceFee) : undefined,
        otherFees: form.otherFees || undefined,
        liquidityType: form.liquidityType,
        lockupDays: form.lockupDays ? Number(form.lockupDays) : undefined,
        redemptionTerms: form.redemptionTerms || undefined,
        navPerShare: form.nav ? Number(form.nav) : undefined,
        aum: form.aum ? Number(form.aum) : undefined,
        return12m: form.return12m ? Number(form.return12m) : undefined,
        returnYtd: form.returnYtd ? Number(form.returnYtd) : undefined,
        returnSinceInception: form.returnSinceInception ? Number(form.returnSinceInception) : undefined,
        description: form.description || undefined,
        riskLevel: form.riskLevel || undefined,
        sector: form.sector || undefined,
        durationMonths: form.durationMonths ? Number(form.durationMonths) : undefined,
        minTicket: form.minTicket ? Number(form.minTicket) : undefined,
      });
      toast.success('Fund created successfully');
      navigate('/fundos');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  if (user?.role !== 'CONSULTOR') {
    return <Navigate to="/dashboard" replace />;
  }

  const inputBase =
    'w-full rounded-lg px-3 py-2 bg-white/5 border border-white/15 text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent transition';
  const labelBase = 'block text-xs font-semibold text-white/80 mb-1 tracking-wide uppercase';
  const sectionTitle = 'font-display text-20 font-medium text-cobalt';
  const sectionSubtitle = 'text-xs text-white/60';

  return (
    <div className="min-h-screen bg-cream-deep text-white">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="bg-cream-deep/70 border border-navy/10 rounded-card p-6 md:p-8 shadow-ink">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
            <div>
              <h2 className="text-28 md:text-40 font-medium text-white">
                Create Fund
              </h2>
              <p className="text-xs md:text-sm text-white/70 mt-1">
                Register a new fund with identification, risk and operational details.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleMockFill}
                className="text-xs md:text-sm px-3 py-2 rounded-lg border border-white/30 text-white/80 hover:bg-white/10 transition"
              >
                Fill with mock
              </button>
              <button
                onClick={() => navigate('/fundos')}
                className="text-xs md:text-sm text-white/70 hover:text-white underline-offset-4 hover:underline transition"
              >
                Back to funds
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-10">
            <div className="space-y-2">
              <h3 className={sectionTitle}>1) Identification & strategy</h3>
              <p className={sectionSubtitle}>Fill in basic fund info and strategy focus.</p>
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
            <label className={labelBase}>Symbol *</label>
            <input
              type="text"
              value={form.symbol}
              onChange={(e) => handleChange('symbol', e.target.value.toUpperCase())}
              required
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>Max supply *</label>
            <input
              type="number"
              value={form.maxSupply}
              onChange={(e) => handleChange('maxSupply', e.target.value)}
              required
              className={inputBase}
              min={1}
            />
          </div>
          <div>
            <label className={labelBase}>
              Price (USDC) *
              <span className={sectionSubtitle}>Quota price in USDC (1 USDC ≈ 1 USD). Investors pay in USDC on Stellar.</span>
            </label>
            <input
              type="number"
              step="0.01"
              value={form.price}
              onChange={(e) => handleChange('price', e.target.value)}
              className={inputBase}
              required
              placeholder="Enter price in USDC"
            />
          </div>
          <div>
            <label className={labelBase}>Registry ID</label>
            <input
              type="text"
              value={form.cnpj}
              onChange={(e) => handleChange('cnpj', e.target.value)}
              className={inputBase}
              placeholder="00.000.000/0000-00"
            />
          </div>
          <div>
            <label className={labelBase}>Type *</label>
            <select
              value={form.type}
              onChange={(e) => handleChange('type', e.target.value as FundForm['type'])}
              className={inputBase}
            >
              <option value="FIDC">Receivables fund</option>
              <option value="FIDC_NP">Receivables fund (non-standard)</option>
            </select>
          </div>
          <div>
            <label className={labelBase}>Target Investor *</label>
            <select
              value={form.targetInvestor}
              onChange={(e) => handleChange('targetInvestor', e.target.value as FundForm['targetInvestor'])}
              className={inputBase}
            >
              <option value="GERAL">Open to all investors</option>
              <option value="QUALIFICADO">Tier proof required (zero-knowledge)</option>
              <option value="PROFISSIONAL">Professional</option>
            </select>
          </div>
          <div>
            <label className={labelBase}>Regulator code</label>
            <input
              type="text"
              value={form.cvmCode}
              onChange={(e) => handleChange('cvmCode', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>Strategy / Sector Focus *</label>
            <input
              type="text"
              value={form.strategy}
              onChange={(e) => handleChange('strategy', e.target.value)}
              required
              className={inputBase}
              placeholder="e.g., Multisector receivables"
            />
          </div>
          <div>
            <label className={labelBase}>Risk level</label>
            <select
              value={form.riskLevel}
              onChange={(e) => handleChange('riskLevel', e.target.value)}
              className={inputBase}
            >
              <option value="">Not set</option>
              <option value="BAIXO">Low</option>
              <option value="MEDIO">Medium</option>
              <option value="ALTO">High</option>
            </select>
          </div>
          <div>
            <label className={labelBase}>Main sector</label>
            <select
              value={form.sector}
              onChange={(e) => handleChange('sector', e.target.value)}
              className={inputBase}
            >
              <option value="">Not set</option>
              <option value="AGRO">Agribusiness</option>
              <option value="VAREJO">Retail</option>
              <option value="INDUSTRIA">Industry</option>
              <option value="SERVICOS">Services</option>
              <option value="TECH">Technology</option>
              <option value="SAUDE">Healthcare</option>
              <option value="OUTROS">Other</option>
            </select>
          </div>
          <div>
            <label className={labelBase}>Average duration (months)</label>
            <input
              type="number"
              min="1"
              step="1"
              value={form.durationMonths}
              onChange={(e) => handleChange('durationMonths', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>Minimum ticket (USDC)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.minTicket}
              onChange={(e) => handleChange('minTicket', e.target.value)}
              className={inputBase}
            />
          </div>
        </section>

        <div className="space-y-2">
          <h3 className={sectionTitle}>2) Service providers</h3>
              <p className={sectionSubtitle}>Administrator, manager, custodian, auditor, fiduciary agent.</p>
            </div>
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
            <label className={labelBase}>Administrator (name)</label>
            <input
              type="text"
              value={form.administratorName}
              onChange={(e) => handleChange('administratorName', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>Administrator registry ID</label>
            <input
              type="text"
              value={form.administratorCnpj}
              onChange={(e) => handleChange('administratorCnpj', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>Manager (name)</label>
            <input
              type="text"
              value={form.managerName}
              onChange={(e) => handleChange('managerName', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>Manager registry ID</label>
            <input
              type="text"
              value={form.managerCnpj}
              onChange={(e) => handleChange('managerCnpj', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>Custodian</label>
            <input
              type="text"
              value={form.custodianName}
              onChange={(e) => handleChange('custodianName', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>Auditor</label>
            <input
              type="text"
              value={form.auditorName}
              onChange={(e) => handleChange('auditorName', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>Fiduciary Agent</label>
            <input
              type="text"
              value={form.fiduciaryAgentName}
              onChange={(e) => handleChange('fiduciaryAgentName', e.target.value)}
              className={inputBase}
            />
              </div>
            </section>

            <div className="space-y-2">
              <h3 className={sectionTitle}>3) Eligibility & risks</h3>
              <p className={sectionSubtitle}>Credit eligibility and key risks for investors.</p>
            </div>
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
            <label className={labelBase}>Eligibility criteria (cedente/sacado/credit)</label>
            <textarea
              value={form.eligibility}
              onChange={(e) => handleChange('eligibility', e.target.value)}
              className={inputBase}
              rows={3}
            />
          </div>
          <div>
            <label className={labelBase}>Key risks (credit/liquidity/concentration)</label>
            <textarea
              value={form.risks}
              onChange={(e) => handleChange('risks', e.target.value)}
              className={inputBase}
              rows={3}
            />
              </div>
            </section>

            <div className="space-y-2">
              <h3 className={sectionTitle}>4) Concentration limits & tenor</h3>
              <p className={sectionSubtitle}>Limits per assignor/debtor/sector and PMT/PMH.</p>
            </div>
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
            <label className={labelBase}>% Limit per assignor</label>
            <input
              type="number"
              value={form.limitCedente}
              onChange={(e) => handleChange('limitCedente', e.target.value)}
              className={inputBase}
              placeholder="e.g., 20"
            />
          </div>
          <div>
            <label className={labelBase}>% Limit per account debtor</label>
            <input
              type="number"
              value={form.limitSacado}
              onChange={(e) => handleChange('limitSacado', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>% Limit per Sector</label>
            <input
              type="number"
              value={form.limitSector}
              onChange={(e) => handleChange('limitSector', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>PMT/PMH (days)</label>
            <input
              type="number"
              value={form.pmt}
              onChange={(e) => handleChange('pmt', e.target.value)}
              className={inputBase}
              placeholder="e.g., 60"
            />
              </div>
            </section>

            <div className="space-y-2">
              <h3 className={sectionTitle}>5) Fees</h3>
              <p className={sectionSubtitle}>Mandatory fees and other relevant charges.</p>
            </div>
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
            <label className={labelBase}>Admin fee (% a.a.)</label>
            <input
              type="number"
              step="0.01"
              value={form.adminFee}
              onChange={(e) => handleChange('adminFee', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>Management fee (% a.a.)</label>
            <input
              type="number"
              step="0.01"
              value={form.managementFee}
              onChange={(e) => handleChange('managementFee', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>Performance fee (% over benchmark)</label>
            <input
              type="number"
              step="0.01"
              value={form.performanceFee}
              onChange={(e) => handleChange('performanceFee', e.target.value)}
              className={inputBase}
            />
          </div>
          <div className="md:col-span-3">
            <label className={labelBase}>Other fees</label>
            <input
              type="text"
              value={form.otherFees}
              onChange={(e) => handleChange('otherFees', e.target.value)}
              className={inputBase}
              placeholder="Custody, registry, audit..."
            />
              </div>
            </section>

            <div className="space-y-2">
              <h3 className={sectionTitle}>6) Liquidity</h3>
              <p className={sectionSubtitle}>Liquidity type, lockup, and redemption terms.</p>
            </div>
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
            <label className={labelBase}>Liquidity type</label>
            <select
              value={form.liquidityType}
              onChange={(e) => handleChange('liquidityType', e.target.value as FundForm['liquidityType'])}
              className={inputBase}
            >
              <option value="ABERTO">Open</option>
              <option value="FECHADO">Closed</option>
              <option value="RESTRITO">Restricted</option>
            </select>
          </div>
          <div>
            <label className={labelBase}>Lockup (days)</label>
            <input
              type="number"
              value={form.lockupDays}
              onChange={(e) => handleChange('lockupDays', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>Redemption terms</label>
            <input
              type="text"
              value={form.redemptionTerms}
              onChange={(e) => handleChange('redemptionTerms', e.target.value)}
              className={inputBase}
              placeholder="Ex.: D+30, sem resgate"
            />
              </div>
            </section>

            <div className="space-y-2">
              <h3 className={sectionTitle}>7) Indicators</h3>
              <p className={sectionSubtitle}>NAV, AUM, and returns for investor exposure.</p>
            </div>
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
            <label className={labelBase}>NAV (per share)</label>
            <input
              type="number"
              step="0.01"
              value={form.nav}
              onChange={(e) => handleChange('nav', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>AUM / PL</label>
            <input
              type="number"
              step="0.01"
              value={form.aum}
              onChange={(e) => handleChange('aum', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>Return 12m (%)</label>
            <input
              type="number"
              step="0.01"
              value={form.return12m}
              onChange={(e) => handleChange('return12m', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>Return YTD (%)</label>
            <input
              type="number"
              step="0.01"
              value={form.returnYtd}
              onChange={(e) => handleChange('returnYtd', e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase}>Return since inception (%)</label>
            <input
              type="number"
              step="0.01"
              value={form.returnSinceInception}
              onChange={(e) => handleChange('returnSinceInception', e.target.value)}
              className={inputBase}
            />
              </div>
            </section>

            <section>
              <label className={labelBase}>Short description</label>
          <textarea
            value={form.description}
            onChange={(e) => handleChange('description', e.target.value)}
            className={inputBase}
            rows={3}
            placeholder="Fund focus, risk highlights, track record summary"
              />
            </section>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-3 text-sm font-medium rounded-full bg-cobalt text-cream hover:bg-navy shadow-ink transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? 'Saving…' : 'Create Fund'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default FundCreate;
