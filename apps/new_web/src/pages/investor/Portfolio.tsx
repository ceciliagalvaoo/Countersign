import React, { useState, useEffect, useCallback } from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { orderService } from '../../services/api';
import toast from 'react-hot-toast';
import { FiBriefcase, FiExternalLink, FiCheckCircle } from 'react-icons/fi';
import { getErrorMessage } from '../../utils/errorHandler';
import UsdcAmount from '../../components/UsdcAmount';

interface Order {
    id: string;
    quantity: number;
    total: number;
    price: number;
    status: string;
    approvalStatus: string;
    txHash?: string;
    refundTxHash?: string;
    createdAt: string;
    fund: {
        name: string;
        symbol: string;
    };
}

const Portfolio: React.FC = () => {
    const { publicKey, isConnected, connect } = useWallet();
    const [orders, setOrders] = useState<Order[]>([]);
    // On-chain share balance per fund symbol (FundToken contract), with the contract ID for the explorer link
    const [onChain, setOnChain] = useState<Record<string, { shares: number | null; tokenContractId: string }>>({});
    const [loading, setLoading] = useState(false);

    const loadOrders = useCallback(async () => {
        setLoading(true);
        try {
            const response = await orderService.list();
            const approvedOrders = (response.orders || []).filter((o: Order) => 
                o.status === 'COMPLETED' && o.approvalStatus === 'APPROVED'
            );
            setOrders(approvedOrders);
            try {
                const { holdings } = await orderService.holdings();
                setOnChain(Object.fromEntries(holdings.map((h) => [h.symbol, { shares: h.shares, tokenContractId: h.tokenContractId }])));
            } catch {
                setOnChain({});
            }
        } catch (error) {
            toast.error(getErrorMessage(error));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadOrders();
    }, [loadOrders]);

    const totalInvested = orders.reduce((sum, order) => sum + order.total, 0);
    const totalQuotas = orders.reduce((sum, order) => sum + order.quantity, 0);

    const groupedOrders = orders.reduce((acc, order) => {
        const symbol = order.fund.symbol;
        if (!acc[symbol]) {
            acc[symbol] = {
                symbol,
                name: order.fund.name,
                totalQuantity: 0,
                totalValue: 0,
                orders: []
            };
        }
        acc[symbol].totalQuantity += order.quantity;
        acc[symbol].totalValue += order.total;
        acc[symbol].orders.push(order);
        return acc;
    }, {} as Record<string, any>);

    if (!isConnected) {
        return (
            <div className="bg-cream-deep/70 border border-navy/10 rounded-card p-6 md:p-8 shadow-ink text-center">
                <FiBriefcase className="mx-auto text-6xl text-gray-300 mb-4" />
                <h2 className="text-28 font-medium mb-2">Connect Your Wallet</h2>
                <p className="text-gray-600 mb-6">Please connect your Stellar wallet to view your portfolio.</p>
                <button
                    onClick={connect}
                    className="px-6 py-3 text-cream bg-primary rounded-full hover:bg-navy transition-colors"
                >
                    Connect Wallet
                </button>
            </div>
        );
    }

    return (
  <div className="max-w-6xl mx-auto px-4 py-10 space-y-6">
    {/* Card principal */}
    <div className="bg-cream-deep/70 border border-navy/10 rounded-card p-6 md:p-8 shadow-ink">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-emerald-300">
            Investor
          </p>
          <h2 className="text-28 md:text-28 font-medium text-white flex items-center gap-2">
            <FiBriefcase className="text-emerald-300" />
            My Portfolio
          </h2>
        </div>

        {publicKey && (
          <a
            href={`https://stellar.expert/explorer/testnet/account/${publicKey}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs md:text-sm px-3 py-2 rounded-full bg-white/5 border border-white/15 text-white/80 hover:bg-white/10 transition"
          >
            <span>View on Stellar Expert</span>
            <FiExternalLink className="text-emerald-300" />
          </a>
        )}
      </div>

      {/* Loading, empty or content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-10 h-10 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center text-white/60 py-12">
          <FiBriefcase className="mx-auto text-5xl text-white/20 mb-4" />
          <p className="text-lg text-white/80">No completed investments yet.</p>
          <p className="text-sm mt-2">
            Start by exploring opportunities in the{' '}
            <span className="text-emerald-300 font-medium">Marketplace</span>.
          </p>
        </div>
      ) : (
        <>
          {/* Resumo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-cream-deep/70 border border-navy/10 rounded-card p-4 md:p-5">
              <p className="text-xs font-semibold text-emerald-200 uppercase tracking-wide mb-1">
                Total invested
              </p>
              <p className="text-2xl font-bold text-emerald-200">
                <UsdcAmount amount={totalInvested} />
              </p>
            </div>
            <div className="bg-cream-deep/70 border border-navy/10 rounded-card p-4 md:p-5">
              <p className="text-xs font-semibold text-sky-200 uppercase tracking-wide mb-1">
                Total quotas
              </p>
              <p className="text-2xl font-bold text-sky-200">
                {totalQuotas.toLocaleString()}
              </p>
            </div>
            <div className="bg-cream-deep/70 border border-navy/10 rounded-card p-4 md:p-5">
              <p className="text-xs font-semibold text-indigo-200 uppercase tracking-wide mb-1">
                Funds invested
              </p>
              <p className="text-2xl font-bold text-indigo-200">
                {Object.keys(groupedOrders).length}
              </p>
            </div>
          </div>

          {/* Holdings */}
          <div className="space-y-3 mb-3">
            <h3 className="text-emerald-300 eyebrow font-sans">
              Your holdings
            </h3>
            <p className="text-xs text-white/60">
              Aggregated by fund, with links to on-chain transactions.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.values(groupedOrders).map((group: any) => (
              <div
                key={group.symbol}
                className="bg-cream-deep/70 border border-navy/10 rounded-card p-5 md:p-6 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold text-white text-base md:text-lg">
                      {group.name}
                    </h4>
                    <p className="text-xs text-white/60">{group.symbol}</p>
                  </div>
                  <FiCheckCircle className="text-emerald-400 text-xl" />
                </div>

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-white/60">Total quotas</span>
                    <span className="font-semibold text-white">
                      {group.totalQuantity.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">On-chain shares</span>
                    <span className="font-semibold text-white">
                      {onChain[group.symbol] ? (
                        <a
                          href={`https://stellar.expert/explorer/testnet/contract/${onChain[group.symbol].tokenContractId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-300 hover:underline"
                        >
                          {onChain[group.symbol].shares?.toLocaleString() ?? 'unavailable'}
                        </a>
                      ) : (
                        '-'
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Total value</span>
                    <span className="font-semibold text-white">
                      <UsdcAmount amount={group.totalValue} />
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Orders</span>
                    <span className="font-semibold text-white">
                      {group.orders.length}
                    </span>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5">
                  {group.orders.map((order: Order) => (
                    <div
                      key={order.id}
                      className="flex items-center justify-between text-11 text-white/55"
                    >
                      <span>{new Date(order.createdAt).toLocaleDateString()}</span>
                      {order.txHash && (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${order.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-200 hover:text-emerald-100 flex items-center gap-1"
                        >
                          <span>View TX</span>
                          <FiExternalLink className="text-[12px]" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  </div>
);
};

export default Portfolio;
