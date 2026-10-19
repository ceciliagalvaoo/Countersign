import React, { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { fundService } from '../../services/api';
import { useWallet } from '../../contexts/WalletContext';
import { FiSearch } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import InvestmentModal from '../../components/InvestmentModal';
import UsdcAmount from '../../components/UsdcAmount';

interface Fund {
  id: string;
  name: string;
  symbol: string;
  description: string;
  status: string;
  totalIssued: number;
  maxSupply: number;
  price: number;
  fundWalletPublicKey?: string;
  consultor?: {
    publicKey?: string;
  };
}

const Marketplace: React.FC = () => {
  const [funds, setFunds] = useState<Fund[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFund, setSelectedFund] = useState<Fund | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { isConnected } = useWallet();

  const loadFunds = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fundService.list();
      setFunds(
        response.funds.filter((f: Fund) => f.status === 'APPROVED') || []
      );
    } catch (error) {
      toast.error('Failed to load marketplace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFunds();
  }, [loadFunds]);

  const filteredFunds = useMemo(() => {
    if (!searchQuery) return funds;
    return funds.filter(
      (fund) =>
        fund.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        fund.symbol.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [funds, searchQuery]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-10 h-10 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      {selectedFund && (
        <InvestmentModal
          fund={selectedFund}
          onClose={() => setSelectedFund(null)}
          onConfirm={loadFunds}
        />
      )}

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
          {/* Header + search */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div>
              <p className="text-[10px] tracking-[0.2em] uppercase text-emerald-300">
                Primary market
              </p>
              <h2 className="text-2xl md:text-3xl font-bold text-white">
                Marketplace
              </h2>
              <p className="mt-1 text-xs md:text-sm text-white/70">
                Discover tokenized receivables funds and invest directly on-chain.
              </p>
            </div>

            <div className="relative w-full sm:max-w-xs">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search funds..."
                className="w-full rounded-lg px-3 pl-10 py-2 bg-white/5 border border-white/15 text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#169976] focus:border-transparent transition"
              />
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
            </div>
          </div>

          {/* Wallet notice */}
          {!isConnected && (
            <div className="mb-6 rounded-2xl border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-xs md:text-sm text-amber-100 flex gap-2">
              <span>💡</span>
              <p>
                <strong>Connect your wallet</strong> in the header to invest and
                make payments via Stellar Testnet.
              </p>
            </div>
          )}

          {/* Grid de fundos */}
          {filteredFunds.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
              {filteredFunds.map((fund) => {
                const available = fund.maxSupply - fund.totalIssued;
                const availablePct =
                  fund.maxSupply > 0
                    ? Math.max(
                        0,
                        Math.min(100, (available / fund.maxSupply) * 100)
                      )
                    : 0;

                return (
                  <div
                    key={fund.id}
                    className="bg-white/[0.03] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-5 md:p-6 shadow-[0_12px_40px_rgba(0,0,0,0.35)] flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-2">
                      <h3 className="text-lg md:text-xl font-semibold text-white">
                        {fund.name}
                      </h3>
                      <p className="text-xs uppercase tracking-wide text-white/50">
                        {fund.symbol}
                      </p>
                      <p className="text-sm text-white/70 line-clamp-3">
                        {fund.description}
                      </p>
                    </div>

                    <div className="mt-2 space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-white/60">Price</span>
                        <span className="font-semibold text-emerald-200">
                          <UsdcAmount amount={fund.price} />
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-white/60">Available</span>
                        <span className="font-semibold text-white">
                          {available.toLocaleString()}
                        </span>
                      </div>

                      {/* Barra de disponibilidade */}
                      {fund.maxSupply > 0 && (
                        <div className="space-y-1">
                          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-400"
                              style={{ width: `${availablePct}%` }}
                            />
                          </div>
                          <p className="text-[11px] text-white/50">
                            {availablePct.toFixed(0)}% of max supply still
                            available
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 mt-2">
                      <button
                        onClick={() => setSelectedFund(fund)}
                        className="w-full px-4 py-2.5 text-sm font-medium rounded-2xl bg-white text-black hover:opacity-90 hover:scale-[1.02] shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={!isConnected}
                      >
                        {isConnected ? 'Invest now' : 'Connect wallet to invest'}
                      </button>
                      <Link
                        to={`/marketplace/${fund.id}`}
                        className="w-full px-4 py-2.5 text-sm text-center rounded-2xl bg-white/5 border border-white/15 text-white/90 hover:bg-white/10 transition"
                      >
                        View details
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center text-white/70 py-10">
              <p className="text-base md:text-lg">
                No funds available that match your search.
              </p>
              <p className="text-xs md:text-sm mt-2">
                Try changing your filters or check back later for new funds.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Marketplace;
