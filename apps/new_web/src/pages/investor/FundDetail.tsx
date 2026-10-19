import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fundService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandler';
import InvestmentModal from '../../components/InvestmentModal';
import { useAuth } from '../../contexts/useAuth';
import { useWallet } from '../../contexts/WalletContext';
import UsdcAmount from '../../components/UsdcAmount';

interface Fund {
  id: string;
  name: string;
  symbol?: string;
  cnpj?: string;
  fundType?: string;
  investorProfile?: string;
  cvmCode?: string;
  administratorName?: string;
  administratorCnpj?: string;
  managerName?: string;
  managerCnpj?: string;
  custodianName?: string;
  auditorName?: string;
  fiduciaryAgentName?: string;
  sectorFocus?: string;
  eligibilityCriteria?: string;
  maxCedenteConcentrationPercent?: number;
  maxSacadoConcentrationPercent?: number;
  sectorConcentrationPercent?: number;
  targetPmt?: number;
  keyRisks?: string;
  administrationFee?: number;
  managementFee?: number;
  performanceFee?: number;
  otherFees?: string;
  liquidityType?: string;
  lockupDays?: number;
  redemptionTerms?: string;
  navPerShare?: number;
  aum?: number;
  return12m?: number;
  returnYtd?: number;
  returnSinceInception?: number;
  description?: string;
  price?: number;
  maxSupply?: number;
  totalIssued?: number;
  status?: string;
  tokenContractId?: string | null;
}

const Field: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div>
    <p className="text-xs uppercase text-gray-400 font-semibold">{label}</p>
    <p className="text-sm text-white">{value ?? 'N/A'}</p>
  </div>
);

const FundDetail: React.FC = () => {
  const { fundId } = useParams<{ fundId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { publicKey, isConnected, connect, signAndSubmitTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [fund, setFund] = useState<Fund | null>(null);
  const [showInvest, setShowInvest] = useState(false);
  const [selectedFund, setSelectedFund] = useState<Fund | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueAmount, setIssueAmount] = useState('');
  const [issuing, setIssuing] = useState(false);

  const isGestor = user?.role === 'GESTOR';

  const loadFund = useCallback(async () => {
    if (!fundId) return;
    setLoading(true);
    try {
      const response = await fundService.getById(fundId);
      const resolvedFund = response.fund || response;
      setFund(resolvedFund);
      setSelectedFund(resolvedFund);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [fundId]);

  useEffect(() => {
    loadFund();
  }, [loadFund]);

  const handleApprove = async (action: 'approve' | 'reject') => {
    if (!fundId || !fund) return;
    if (!isGestor) {
      toast.error('Only managers can approve or reject funds.');
      return;
    }

    if (action === 'approve') {
      if (!isConnected || !publicKey) {
        toast.error('Please connect your wallet first to approve the fund.');
        try {
          await connect();
          toast.success('Wallet connected! Click Approve again to continue.');
        } catch (error) {
          toast.error('Failed to connect wallet.');
        }
        return;
      }
    }

    setProcessing(true);
    toast.loading(action === 'approve' ? 'Approving fund...' : 'Rejecting fund...');
    try {
      await fundService.approve(
        fundId,
        action === 'approve' ? 'APPROVED' : 'REJECTED',
        action === 'approve' ? (publicKey || undefined) : undefined
      );
      toast.dismiss();
      toast.success(action === 'approve' ? 'Fund approved successfully.' : 'Fund rejected.');
      if (action === 'approve') {
        await deployShareToken();
      }
      await loadFund();
    } catch (error) {
      toast.dismiss();
      toast.error(getErrorMessage(error));
    } finally {
      setProcessing(false);
    }
  };

  // Deploys this fund's share token (FundToken contract); the connected fund wallet signs and becomes its admin
  const deployShareToken = async () => {
    if (!fundId || !publicKey) return;
    const toastId = toast.loading('Deploying the fund share token on Stellar...');
    try {
      const { transactionXdr } = await fundService.buildTokenDeploy(fundId, publicKey);
      const txHash = await signAndSubmitTransaction(transactionXdr);
      const { tokenContractId } = await fundService.confirmTokenDeploy(fundId, txHash);
      toast.success(`Share token deployed: ${tokenContractId.slice(0, 8)}...`, { id: toastId });
      await loadFund();
    } catch (error) {
      toast.error(getErrorMessage(error), { id: toastId });
    }
  };

  const handleDeactivate = async () => {
    if (!fundId) return;
    if (!confirm('Are you sure you want to deactivate this fund?')) return;

    toast.loading('Deactivating fund...');
    try {
      await fundService.deactivate(fundId);
      toast.dismiss();
      toast.success('Fund deactivated successfully.');
      await loadFund();
    } catch (error) {
      toast.dismiss();
      toast.error(getErrorMessage(error));
    }
  };

  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fund || !fundId) return;
    const amountNum = parseInt(issueAmount, 10);
    const maxAvailable = (fund.maxSupply ?? 0) - (fund.totalIssued ?? 0);

    if (!amountNum || amountNum <= 0 || amountNum > maxAvailable) {
      toast.error(`Amount must be between 1 and ${maxAvailable.toLocaleString()}`);
      return;
    }

    setIssuing(true);
    try {
      await fundService.issueQuotas(fundId, amountNum);
      toast.success(`Successfully issued ${amountNum.toLocaleString()} quotas!`);
      setShowIssueModal(false);
      setIssueAmount('');
      await loadFund();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIssuing(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Loading fund...</div>;
  if (!fund) return <div className="p-8 text-center text-gray-300">Fund not found.</div>;

  return (
    <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)] space-y-6 relative">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">{fund.name}</h1>
          <p className="text-sm text-gray-300">{fund.description}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(isGestor ? '/fundos' : '/marketplace')}
            className="text-primary text-sm hover:underline"
          >
            {isGestor ? 'Back to Manage Funds' : 'Back to marketplace'}
          </button>
          {isGestor ? (
            fund.status === 'PENDING' && (
              <div className="flex gap-2">
                <button
                  onClick={() => handleApprove('approve')}
                  disabled={processing}
                  className="px-4 py-2 text-white bg-primary rounded-lg hover:bg-primary/90 disabled:bg-primary/50"
                >
                  {processing ? 'Approving...' : 'Approve'}
                </button>
                <button
                  onClick={() => handleApprove('reject')}
                  disabled={processing}
                  className="px-4 py-2 text-white bg-[#fa7f7f]-500 rounded-lg hover:bg-[#fa7f7f]-600 disabled:bg-[#fa7f7f]-400"
                >
                  {processing ? 'Rejecting...' : 'Reject'}
                </button>
              </div>
            )
          ) : (
            fund && (
              <button
                onClick={() => {
                  setSelectedFund(fund);
                  setShowInvest(true);
                }}
                className="px-4 py-2 text-white bg-primary rounded-lg hover:bg-primary/90"
              >
                Invest Now
              </button>
            )
          )}
          {isGestor && fund.status === 'APPROVED' && (
            <div className="flex gap-2">
              {!fund.tokenContractId && (
                <button
                  onClick={deployShareToken}
                  className="px-4 py-2 text-white bg-primary rounded-lg hover:bg-primary/90"
                >
                  Deploy share token
                </button>
              )}
              <button
                onClick={() => setShowIssueModal(true)}
                className="px-4 py-2 text-white bg-primary rounded-lg hover:bg-primary/90"
              >
                Issue quotas
              </button>
              <button
                onClick={handleDeactivate}
                className="px-4 py-2 text-white bg-gray-700 rounded-lg hover:bg-gray-600"
              >
                Deactivate
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Field label="CNPJ" value={fund.cnpj} />
        <Field label="Type" value={fund.fundType} />
        <Field label="Target investor" value={fund.investorProfile} />
        <Field label="CVM code" value={fund.cvmCode} />
        <Field label="Status" value={fund.status} />
        <Field label="Price" value={fund.price ? <UsdcAmount amount={fund.price} /> : undefined} />
        <Field label="NAV (per share)" value={fund.navPerShare ? <UsdcAmount amount={fund.navPerShare} /> : undefined} />
        <Field label="AUM / PL" value={fund.aum ? <UsdcAmount amount={fund.aum} /> : undefined} />
        <Field label="Return 12m" value={fund.return12m ? `${fund.return12m}%` : undefined} />
        <Field label="Return YTD" value={fund.returnYtd ? `${fund.returnYtd}%` : undefined} />
        <Field label="Return since inception" value={fund.returnSinceInception ? `${fund.returnSinceInception}%` : undefined} />
        <Field
          label="Issued / Max"
          value={
            typeof fund.totalIssued === 'number' && typeof fund.maxSupply === 'number'
              ? `${fund.totalIssued.toLocaleString()} / ${fund.maxSupply.toLocaleString()}`
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <h3 className="font-semibold text-white">Service providers</h3>
          <Field label="Administrator" value={fund.administratorName} />
          <Field label="Administrator CNPJ" value={fund.administratorCnpj} />
          <Field label="Manager" value={fund.managerName} />
          <Field label="Manager CNPJ" value={fund.managerCnpj} />
          <Field label="Custodian" value={fund.custodianName} />
          <Field label="Auditor" value={fund.auditorName} />
          <Field label="Fiduciary agent" value={fund.fiduciaryAgentName} />
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold text-white">Policy & limits</h3>
          <Field label="Strategy / Sector focus" value={fund.sectorFocus} />
          <Field label="Eligibility" value={fund.eligibilityCriteria} />
          <Field label="% limit per cedente" value={fund.maxCedenteConcentrationPercent} />
          <Field label="% limit per sacado" value={fund.maxSacadoConcentrationPercent} />
          <Field label="% limit per sector" value={fund.sectorConcentrationPercent} />
          <Field label="PMT/PMH (days)" value={fund.targetPmt} />
          <Field label="Key risks" value={fund.keyRisks} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <h3 className="font-semibold text-white">Fees</h3>
          <Field label="Admin fee (% a.a.)" value={fund.administrationFee} />
          <Field label="Management fee (% a.a.)" value={fund.managementFee} />
          <Field label="Performance fee (%)" value={fund.performanceFee} />
          <Field label="Other fees" value={fund.otherFees} />
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold text-white">Liquidity</h3>
          <Field label="Type" value={fund.liquidityType} />
          <Field label="Lockup (days)" value={fund.lockupDays} />
          <Field label="Redemption terms" value={fund.redemptionTerms} />
        </div>
      </div>

      {showInvest && selectedFund && (
        <InvestmentModal
          fund={selectedFund as any}
          onClose={() => {
            setShowInvest(false);
            setSelectedFund(null);
          }}
          onConfirm={() => setShowInvest(false)}
        />
      )}

      {showIssueModal && fund && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)] w-full max-w-md m-4">
            <h2 className="text-xl font-bold mb-4 text-white">Issue Quotas - {fund.name}</h2>
            <form onSubmit={handleIssueSubmit} className="space-y-4">
              <div>
                <p className="text-sm text-gray-300 mb-2">
                  Current: <span className="font-semibold">{(fund.totalIssued ?? 0).toLocaleString()}</span> / {(fund.maxSupply ?? 0).toLocaleString()}
                </p>
                <p className="text-sm text-gray-300 mb-4">
                  Available to issue:{' '}
                  <span className="font-semibold text-primary">
                    {((fund.maxSupply ?? 0) - (fund.totalIssued ?? 0)).toLocaleString()}
                  </span>
                </p>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Amount to Issue
                </label>
                <input
                  type="number"
                  value={issueAmount}
                  onChange={(e) => setIssueAmount(e.target.value)}
                  placeholder="Enter amount"
                  min="1"
                  max={(fund.maxSupply ?? 0) - (fund.totalIssued ?? 0)}
                  className="w-full rounded-lg px-3 py-2 bg-white/5 border border-white/15 text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#169976] focus:border-transparent transition"
                  required
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowIssueModal(false);
                    setIssueAmount('');
                  }}
                  className="px-4 py-2 text-gray-200 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={issuing || !issueAmount}
                  className="px-4 py-2 text-white bg-primary rounded-md hover:bg-primary/90 disabled:bg-primary/50 transition-colors"
                >
                  {issuing ? 'Issuing...' : 'Issue Quotas'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FundDetail;
