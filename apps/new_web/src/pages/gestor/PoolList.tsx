import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { FiPlus, FiTrendingUp, FiDollarSign, FiPercent } from 'react-icons/fi';
import { poolService, fundService } from '../../services/api';
import { useWallet } from '../../contexts/WalletContext';
import UsdcAmount from '../../components/UsdcAmount';

interface Pool {
  id: string;
  name: string;
  blendPoolAddress: string;
  assetAddress: string;
  totalDeposited: number;
  currentBalance: number;
  yieldEarned: number;
  apy: number | null;
  status: string;
  lastYieldUpdate: string | null;
  fund: {
    id: string;
    name: string;
    symbol: string;
  };
  currentYield?: number;
  yieldPercentage?: number;
}

interface Fund {
  id: string;
  name: string;
  symbol: string;
}

interface AvailableBlendPool {
  address: string;
  name: string;
  assetAddress: string;
  assetSymbol: string;
  description: string;
}

const PoolList: React.FC = () => {
  const [pools, setPools] = useState<Pool[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [availableBlendPools, setAvailableBlendPools] = useState<AvailableBlendPool[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const { publicKey, isConnected, connect, signAndSubmitTransaction } = useWallet();

  const loadPools = useCallback(async () => {
    setLoading(true);
    try {
      const response = await poolService.list();
      setPools(response.pools || []);
    } catch (error: any) {
      toast.error('Failed to load pools');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFunds = useCallback(async () => {
    try {
      const response = await fundService.list();
      setFunds(response.funds || []);
    } catch (error: any) {
      console.error('Failed to load funds:', error);
    }
  }, []);

  const loadAvailableBlendPools = useCallback(async () => {
    try {
      const response = await poolService.getAvailablePools();
      setAvailableBlendPools(response.pools || []);
    } catch (error: any) {
      console.error('Failed to load available Blend pools:', error);
    }
  }, []);

  useEffect(() => {
    loadPools();
    loadFunds();
    loadAvailableBlendPools();
  }, [loadPools, loadFunds, loadAvailableBlendPools]);

  const handleDeposit = (pool: Pool) => {
    setSelectedPool(pool);
    setShowDepositModal(true);
  };

  const handleWithdraw = (pool: Pool) => {
    setSelectedPool(pool);
    setShowWithdrawModal(true);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-cream-deep/70 border border-navy/10 rounded-card p-6 md:p-8 shadow-ink">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-28 font-medium">Yield Pools</h2>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-cream rounded-full hover:bg-navy"
          >
            <FiPlus /> Create Pool
          </button>
        </div>

        {pools.length === 0 ? (
          <div className="text-center py-12">
            <FiDollarSign className="mx-auto text-6xl text-gray-300 mb-4" />
            <p className="text-gray-500 mb-4">No pools created yet</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-3 bg-primary text-cream rounded-full hover:bg-navy"
            >
              Create Your First Pool
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pools.map((pool) => (
              <div
                key={pool.id}
                className="bg-cream-deep/70 border border-navy/10 rounded-card p-6 md:p-8 shadow-ink"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-20 font-medium text-white">{pool.name}</h3>
                    <p className="text-sm text-gray-300">{pool.fund.name}</p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      pool.status === 'ACTIVE'
                        ? 'bg-green-900/50 text-green-300'
                        : 'bg-gray-700/50 text-gray-300'
                    }`}
                  >
                    {pool.status}
                  </span>
                </div>

                <div className="space-y-3 mb-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 flex items-center gap-1">
                      <FiDollarSign size={16} /> Deposited
                    </span>
                    <span className="font-semibold text-white">
                      <UsdcAmount amount={pool.totalDeposited} />
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 flex items-center gap-1">
                      <FiTrendingUp size={16} /> Current Balance
                    </span>
                    <span className="font-semibold text-white">
                      <UsdcAmount amount={pool.currentBalance} />
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 flex items-center gap-1">
                      <FiPercent size={16} /> Yield Earned
                    </span>
                    <span className={`font-semibold ${
                      (pool.currentYield || 0) > 0 ? 'text-green-400' : 'text-gray-300'
                    }`}>
                      <UsdcAmount amount={pool.currentYield || 0} /> ({(pool.yieldPercentage || 0).toFixed(2)}%)
                    </span>
                  </div>

                  {pool.apy && (
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300">APY</span>
                      <span className="font-semibold text-primary">
                        {pool.apy.toFixed(2)}%
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleDeposit(pool)}
                    disabled={pool.status !== 'ACTIVE'}
                    className="flex-1 px-4 py-2 bg-primary text-cream rounded-full hover:bg-navy disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Deposit
                  </button>
                  <button
                    onClick={() => handleWithdraw(pool)}
                    disabled={pool.status !== 'ACTIVE' || pool.currentBalance === 0}
                    className="flex-1 px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Withdraw
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreatePoolModal
          funds={funds}
          availableBlendPools={availableBlendPools}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            loadPools();
            setShowCreateModal(false);
          }}
        />
      )}

      {showDepositModal && selectedPool && (
        <DepositModal
          pool={selectedPool}
          onClose={() => {
            setShowDepositModal(false);
            setSelectedPool(null);
          }}
          onSuccess={() => {
            loadPools();
            setShowDepositModal(false);
            setSelectedPool(null);
          }}
          publicKey={publicKey}
          isConnected={isConnected}
          connect={connect}
          signAndSubmitTransaction={signAndSubmitTransaction}
        />
      )}

      {showWithdrawModal && selectedPool && (
        <WithdrawModal
          pool={selectedPool}
          onClose={() => {
            setShowWithdrawModal(false);
            setSelectedPool(null);
          }}
          onSuccess={() => {
            loadPools();
            setShowWithdrawModal(false);
            setSelectedPool(null);
          }}
          publicKey={publicKey}
          isConnected={isConnected}
          connect={connect}
          signAndSubmitTransaction={signAndSubmitTransaction}
        />
      )}
    </>
  );
};

// Create Pool Modal
const CreatePoolModal: React.FC<{
  funds: Fund[];
  availableBlendPools: AvailableBlendPool[];
  onClose: () => void;
  onSuccess: () => void;
}> = ({ funds, availableBlendPools, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    name: '',
    fundId: '',
    blendPoolAddress: '',
    assetAddress: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await poolService.create(formData);
      toast.success('Pool created successfully!');
      onSuccess();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create pool');
    } finally {
      setLoading(false);
    }
  };

  const handleBlendPoolSelect = (poolAddress: string) => {
    const selected = availableBlendPools.find(p => p.address === poolAddress);
    if (selected) {
      setFormData(prev => ({
        ...prev,
        blendPoolAddress: selected.address,
        assetAddress: selected.assetAddress,
        name: prev.name || `${selected.name} - Yield Pool`,
      }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/30">
      <div className="bg-cream-deep/70 border border-navy/10 rounded-card w-full max-w-md p-6 md:p-8 shadow-ink">
        <h2 className="text-28 font-medium mb-6 text-white">Create Yield Pool</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-white/80 mb-1 tracking-wide uppercase">Pool Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-lg px-3 py-2 bg-white/5 border border-white/15 text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent transition"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-white/80 mb-1 tracking-wide uppercase">Fund</label>
            <select
              value={formData.fundId}
              onChange={(e) => setFormData({ ...formData, fundId: e.target.value })}
              className="w-full rounded-lg px-3 py-2 bg-white/5 border border-white/15 text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent transition"
              required
            >
              <option value="">Select fund...</option>
              {funds.map((fund) => (
                <option key={fund.id} value={fund.id}>
                  {fund.name} ({fund.symbol})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-white/80 mb-1 tracking-wide uppercase">Blend Pool</label>
            <select
              value={formData.blendPoolAddress}
              onChange={(e) => handleBlendPoolSelect(e.target.value)}
              className="w-full rounded-lg px-3 py-2 bg-white/5 border border-white/15 text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent transition"
              required
            >
              <option value="">Select Blend pool...</option>
              {availableBlendPools.map((pool) => (
                <option key={pool.address} value={pool.address}>
                  {pool.name} - {pool.assetSymbol}
                </option>
              ))}
            </select>
            {formData.blendPoolAddress && (
              <p className="text-xs text-gray-400 mt-1">
                {availableBlendPools.find(p => p.address === formData.blendPoolAddress)?.description}
              </p>
            )}
          </div>

          <div className="flex gap-4 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-primary text-cream rounded-full hover:bg-navy disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Pool'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Deposit Modal
const DepositModal: React.FC<{
  pool: Pool;
  onClose: () => void;
  onSuccess: () => void;
  publicKey: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  signAndSubmitTransaction: (xdr: string) => Promise<string>;
}> = ({ pool, onClose, onSuccess, publicKey, isConnected, connect, signAndSubmitTransaction }) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isConnected || !publicKey) {
      toast.error('Please connect your wallet first');
      await connect();
      return;
    }

    setLoading(true);
    let toastId = toast.loading('Building deposit transaction...');

    try {
      const depositAmount = parseFloat(amount);

      // Step 1: Build deposit transaction
      const buildResponse = await poolService.buildDepositTx(
        pool.id,
        depositAmount,
        publicKey
      );

      toast.dismiss(toastId);
      toastId = toast.loading('Please sign the transaction in your wallet...');

      // Step 2: Sign and submit transaction
      const txHash = await signAndSubmitTransaction(buildResponse.transactionXdr);

      toast.dismiss(toastId);
      toastId = toast.loading('Confirming deposit...');

      // Step 3: Confirm deposit on backend
      await poolService.confirmDeposit(pool.id, depositAmount, txHash);

      toast.dismiss(toastId);
      toast.success(`Successfully deposited $${depositAmount.toLocaleString()}!`);
      onSuccess();
    } catch (error: any) {
      toast.dismiss(toastId);
      console.error('Deposit error:', error);
      toast.error(error.message || 'Failed to deposit');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/30">
      <div className="bg-cream-deep/70 border border-navy/10 rounded-card w-full max-w-md p-6 md:p-8 shadow-ink">
        <h2 className="text-28 font-medium mb-4 text-white">Deposit to Pool</h2>
        <div className="mb-6">
          <p className="text-sm text-gray-300">Pool: {pool.name}</p>
          <p className="text-sm text-gray-300">Fund: {pool.fund.name}</p>
          <p className="text-sm text-gray-300">
            Current Balance: <UsdcAmount amount={pool.currentBalance} />
          </p>
        </div>

        <form onSubmit={handleDeposit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-white/80 mb-1 tracking-wide uppercase">Amount (USD)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0"
              step="0.01"
              className="w-full rounded-lg px-3 py-2 bg-white/5 border border-white/15 text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent transition"
              placeholder="0.00"
              required
            />
          </div>

          <div className="flex gap-4 mt-6">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-primary text-cream rounded-full hover:bg-navy disabled:opacity-50"
            >
              {loading ? 'Processing...' : 'Deposit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Withdraw Modal
const WithdrawModal: React.FC<{
  pool: Pool;
  onClose: () => void;
  onSuccess: () => void;
  publicKey: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  signAndSubmitTransaction: (xdr: string) => Promise<string>;
}> = ({ pool, onClose, onSuccess, publicKey, isConnected, connect, signAndSubmitTransaction }) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isConnected || !publicKey) {
      toast.error('Please connect your wallet first');
      await connect();
      return;
    }

    setLoading(true);
    let toastId = toast.loading('Building withdraw transaction...');

    try {
      const withdrawAmount = parseFloat(amount);

      if (withdrawAmount > pool.currentBalance) {
        toast.error('Insufficient balance in pool');
        return;
      }

      // Step 1: Build withdraw transaction
      const buildResponse = await poolService.buildWithdrawTx(
        pool.id,
        withdrawAmount,
        publicKey
      );

      toast.dismiss(toastId);
      toastId = toast.loading('Please sign the transaction in your wallet...');

      // Step 2: Sign and submit transaction
      const txHash = await signAndSubmitTransaction(buildResponse.transactionXdr);

      toast.dismiss(toastId);
      toastId = toast.loading('Confirming withdrawal...');

      // Step 3: Confirm withdrawal on backend
      await poolService.confirmWithdraw(pool.id, withdrawAmount, txHash);

      toast.dismiss(toastId);
      toast.success(`Successfully withdrew $${withdrawAmount.toLocaleString()}!`);
      onSuccess();
    } catch (error: any) {
      toast.dismiss(toastId);
      console.error('Withdraw error:', error);
      toast.error(error.message || 'Failed to withdraw');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/30">
      <div className="bg-cream-deep/70 border border-navy/10 rounded-card w-full max-w-md p-6 md:p-8 shadow-ink">
        <h2 className="text-28 font-medium mb-4 text-white">Withdraw from Pool</h2>
        <div className="mb-6">
          <p className="text-sm text-gray-300">Pool: {pool.name}</p>
          <p className="text-sm text-gray-300">Fund: {pool.fund.name}</p>
          <p className="text-sm font-semibold text-green-400">
            Available: ${pool.currentBalance.toLocaleString()}
          </p>
        </div>

        <form onSubmit={handleWithdraw} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-white/80 mb-1 tracking-wide uppercase">Amount (USD)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0"
              max={pool.currentBalance}
              step="0.01"
              className="w-full rounded-lg px-3 py-2 bg-white/5 border border-white/15 text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent transition"
              placeholder="0.00"
              required
            />
            <button
              type="button"
              onClick={() => setAmount(pool.currentBalance.toString())}
              className="text-xs text-primary mt-1 hover:underline"
            >
              Max: ${pool.currentBalance.toLocaleString()}
            </button>
          </div>

          <div className="flex gap-4 mt-6">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-primary text-cream rounded-full hover:bg-navy disabled:opacity-50"
            >
              {loading ? 'Processing...' : 'Withdraw'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PoolList;
