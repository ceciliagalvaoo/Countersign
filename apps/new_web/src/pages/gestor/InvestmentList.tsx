import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { orderService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandler';
import { useOrderApproval } from '../../hooks/useOrderApproval';
import FilterBar from '../../components/FilterBar';
import UsdcAmount from '../../components/UsdcAmount';
import { PenLoader } from '../../components/ink/PenLoader';

interface Investment {
  id: string;
  quantity: number;
  price: number;
  total: number;
  status: string;
  approvalStatus: string;
  txHash?: string;
  refundTxHash?: string;
  tokenMintTxHash?: string;
  payerAddress?: string | null;
  createdAt: string;
  investor: {
    id: string;
    email: string;
    publicKey?: string;
  };
  fund: {
    id: string;
    name: string;
    symbol: string;
  };
}

const InvestmentList: React.FC = () => {
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterApproval, setFilterApproval] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await orderService.list();
      setInvestments(response?.orders || []);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const { processingId, handleApprove, handleReject } = useOrderApproval(loadData);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredInvestments = investments.filter((item) => {
    const matchesStatus =
      filterStatus === 'all' || item.status === filterStatus;
    const matchesApproval =
      filterApproval === 'all' || item.approvalStatus === filterApproval;
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      term === '' ||
      item.investor.email.toLowerCase().includes(term) ||
      item.fund.name.toLowerCase().includes(term) ||
      item.fund.symbol.toLowerCase().includes(term);

    return matchesStatus && matchesApproval && matchesSearch;
  });

  const handleClearFilters = () => {
    setSearchTerm('');
    setFilterStatus('all');
    setFilterApproval('all');
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40';
      case 'PENDING':
        return 'bg-amber-500/20 text-amber-200 border border-amber-400/40';
      default:
        return 'bg-red-500/20 text-red-200 border border-red-400/40';
    }
  };

  const getApprovalBadgeClass = (approvalStatus: string) => {
    switch (approvalStatus) {
      case 'APPROVED':
        return 'bg-sky-500/20 text-sky-200 border border-sky-400/40';
      case 'PENDING_APPROVAL':
        return 'bg-amber-500/20 text-amber-200 border border-amber-400/40';
      case 'REJECTED':
        return 'bg-vermilion text-red-200 border border-vermilion';
      default:
        return 'bg-slate-600/60 text-slate-100 border border-slate-400/40';
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <PenLoader />
        <p className="text-sm text-white/80">Loading investments…</p>
      </div>
    );
  }

  return (
    <div className="max-w-10xl mx-auto px-4 py-8">
      <div className="bg-cream-deep/70 border border-navy/10 rounded-card p-6 md:p-8 shadow-ink">
        {/* Header */}
        <div className="mb-6">
          <p className="text-[10px] tracking-[0.2em] uppercase text-emerald-300">
            Fund manager
          </p>
          <h2 className="text-28 md:text-40 font-medium text-white mt-1">
            Manage investments
          </h2>
          <p className="text-xs md:text-sm text-white/70 mt-1">
            Review, approve and reconcile investor orders across your funds.
          </p>
        </div>

        {/* Filtros */}
        <FilterBar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          filterStatus={filterStatus}
          onStatusChange={setFilterStatus}
          filterApproval={filterApproval}
          onApprovalChange={setFilterApproval}
          onClearFilters={handleClearFilters}
          searchPlaceholder="Search by investor, fund name or symbol..."
        />

        <div className="text-xs md:text-sm text-white/60 mb-4 mt-2">
          Showing{' '}
          <span className="font-semibold text-white">
            {filteredInvestments.length}
          </span>{' '}
          of{' '}
          <span className="font-semibold text-white">
            {investments.length}
          </span>{' '}
          investments
        </div>

        {filteredInvestments.length === 0 ? (
          <div className="text-center py-10 text-white/70">
            {investments.length === 0
              ? 'No investments found.'
              : 'No investments match the selected filters.'}
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="py-3 px-4 text-left text-11 font-semibold text-white/60 uppercase tracking-wide">
                      Investor
                    </th>
                    <th className="py-3 px-4 text-left text-11 font-semibold text-white/60 uppercase tracking-wide">
                      Fund
                    </th>
                    <th className="py-3 px-4 text-left text-11 font-semibold text-white/60 uppercase tracking-wide">
                      Quantity
                    </th>
                    <th className="py-3 px-4 text-left text-11 font-semibold text-white/60 uppercase tracking-wide">
                      Total
                    </th>
                    <th className="py-3 px-4 text-left text-11 font-semibold text-white/60 uppercase tracking-wide">
                      Date
                    </th>
                    <th className="py-3 px-4 text-left text-11 font-semibold text-white/60 uppercase tracking-wide">
                      Status
                    </th>
                    <th className="py-3 px-4 text-left text-11 font-semibold text-white/60 uppercase tracking-wide">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvestments.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-white/8 hover:bg-white/[0.04] transition-colors"
                    >
                      <td className="py-3 px-4">
                        <p className="font-medium text-sm text-white">
                          {item.investor.email}
                        </p>
                        {item.payerAddress && (
                          <p className="text-xs text-white/60" title={item.payerAddress}>
                            mandate wallet <span className="font-mono">{item.payerAddress.slice(0, 4)}...{item.payerAddress.slice(-4)}</span>
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-sm text-white">
                          {item.fund.name}
                        </p>
                        <p className="text-xs text-white/60">
                          {item.fund.symbol}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-sm text-white">
                        {item.quantity.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-sm font-medium font-mono tabular text-white">
                        <UsdcAmount amount={item.total} />
                      </td>
                      <td className="py-3 px-4 text-xs text-white/60">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`px-2 py-1 text-11 font-semibold rounded-full text-center ${getStatusBadgeClass(
                              item.status
                            )}`}
                          >
                            {item.status}
                          </span>
                          {item.approvalStatus && (
                            <span
                              className={`px-2 py-1 text-11 font-semibold rounded-full text-center ${getApprovalBadgeClass(
                                item.approvalStatus
                              )}`}
                            >
                              {item.approvalStatus.replace('_', ' ')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1.5">
                          {item.status === 'COMPLETED' &&
                            item.approvalStatus === 'PENDING_APPROVAL' && (
                              <>
                                <button
                                  onClick={() => handleApprove(item)}
                                  disabled={processingId === item.id}
                                  className="px-3 py-1.5 text-xs rounded-full bg-emerald-500 hover:bg-emerald-400 text-cream font-medium disabled:bg-emerald-500/60 disabled:cursor-not-allowed"
                                >
                                  {processingId === item.id
                                    ? 'Processing…'
                                    : 'Approve'}
                                </button>
                                <button
                                  onClick={() => handleReject(item)}
                                  disabled={processingId === item.id}
                                  className="px-3 py-1.5 text-xs rounded-full bg-vermilion hover:bg-red-400 text-cream font-medium disabled:bg-red-500/60 disabled:cursor-not-allowed"
                                >
                                  {processingId === item.id
                                    ? 'Processing…'
                                    : 'Reject'}
                                </button>
                              </>
                            )}

                          {item.txHash && (
                            <a
                              href={`https://stellar.expert/explorer/testnet/tx/${item.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-11 text-emerald-200 hover:text-emerald-300"
                            >
                              Payment TX
                            </a>
                          )}
                          {item.refundTxHash && (
                            <a
                              href={`https://stellar.expert/explorer/testnet/tx/${item.refundTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-11 text-emerald-200 hover:text-emerald-300"
                            >
                              Refund TX
                            </a>
                          )}
                          {item.tokenMintTxHash && (
                            <a
                              href={`https://stellar.expert/explorer/testnet/tx/${item.tokenMintTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-11 text-emerald-200 hover:text-emerald-300"
                            >
                              Token mint TX
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-4 mt-4">
              {filteredInvestments.map((item) => (
                <div
                  key={item.id}
                  className="bg-cream-deep/70 border border-navy/10 rounded-card p-5 shadow-ink"
                >
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <p className="font-semibold text-sm text-white">
                        {item.investor.email}
                      </p>
                      <p className="text-xs text-white/70 mt-0.5">
                        {item.fund.name} ({item.fund.symbol})
                      </p>
                      {item.payerAddress && (
                        <p className="text-xs text-white/60" title={item.payerAddress}>
                          mandate wallet <span className="font-mono">{item.payerAddress.slice(0, 4)}...{item.payerAddress.slice(-4)}</span>
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                      <span
                        className={`px-2 py-1 text-11 font-semibold rounded-full ${getStatusBadgeClass(
                          item.status
                        )}`}
                      >
                        {item.status}
                      </span>
                      {item.approvalStatus && (
                        <span
                          className={`px-2 py-1 text-11 font-semibold rounded-full ${getApprovalBadgeClass(
                            item.approvalStatus
                          )}`}
                        >
                          {item.approvalStatus.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs mt-4">
                    <div>
                      <span className="text-white/60">Quantity</span>
                      <p className="font-medium text-white">
                        {item.quantity.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <span className="text-white/60">Total</span>
                      <p className="font-medium font-mono tabular text-white">
                        <UsdcAmount amount={item.total} />
                      </p>
                    </div>
                    <div className="col-span-2">
                      <span className="text-white/60">Date</span>
                      <p className="font-medium text-white">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 pt-3 mt-2 border-t border-white/10">
                    {item.status === 'COMPLETED' &&
                      item.approvalStatus === 'PENDING_APPROVAL' && (
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => handleApprove(item)}
                            disabled={processingId === item.id}
                            className="px-3 py-2 text-xs rounded-full bg-emerald-500 hover:bg-emerald-400 text-cream font-medium disabled:bg-emerald-500/60 disabled:cursor-not-allowed"
                          >
                            {processingId === item.id
                              ? 'Processing…'
                              : 'Approve'}
                          </button>
                          <button
                            onClick={() => handleReject(item)}
                            disabled={processingId === item.id}
                            className="px-3 py-2 text-xs rounded-full bg-vermilion hover:bg-red-400 text-cream font-medium disabled:bg-red-500/60 disabled:cursor-not-allowed"
                          >
                            {processingId === item.id
                              ? 'Processing…'
                              : 'Reject'}
                          </button>
                        </div>
                      )}

                    <div className="flex flex-col gap-1">
                      {item.txHash && (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${item.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-11 text-emerald-200 hover:text-emerald-300"
                        >
                          View payment transaction
                        </a>
                      )}
                      {item.refundTxHash && (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${item.refundTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-11 text-emerald-200 hover:text-emerald-300"
                        >
                          View refund transaction
                        </a>
                      )}
                      {item.tokenMintTxHash && (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${item.tokenMintTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-11 text-emerald-200 hover:text-emerald-300"
                        >
                          View token mint transaction
                        </a>
                      )}
                    </div>
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

export default InvestmentList;
