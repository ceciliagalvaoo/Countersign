import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { orderService } from '../../services/api';
import { FiX } from 'react-icons/fi';
import { getErrorMessage } from '../../utils/errorHandler';
import FilterBar from '../../components/FilterBar';
import { StatusBadge } from '../../components/StatusBadge';
import { TransactionLinks } from '../../components/TransactionLinks';

interface Order {
  id: string;
  fund: { name: string; symbol: string };
  quantity: number;
  total: number;
  status: string;
  approvalStatus: string;
  txHash?: string;
  refundTxHash?: string;
  tokenMintTxHash?: string;
  createdAt: string;
}

const OrderList: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterApproval, setFilterApproval] = useState('all');

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await orderService.list();
      setOrders(response.orders || []);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleCancelOrder = async (orderId: string) => {
    if (!confirm('Are you sure you want to cancel this order?')) {
      return;
    }

    setCancellingId(orderId);
    try {
      await orderService.cancel(orderId);
      toast.success('Order cancelled successfully');
      loadOrders();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setCancellingId(null);
    }
  };

  // Filter logic
  const filteredOrders = orders.filter((order) => {
    const matchesSearch =
      order.fund.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.fund.symbol.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || order.status === filterStatus;
    const matchesApproval =
      filterApproval === 'all' || order.approvalStatus === filterApproval;
    return matchesSearch && matchesStatus && matchesApproval;
  });

  const handleClearFilters = () => {
    setSearchTerm('');
    setFilterStatus('all');
    setFilterApproval('all');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-10 h-10 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase text-emerald-300">
              Investor activity
            </p>
            <h2 className="text-xl md:text-2xl font-bold text-white">
              My investment orders
            </h2>
          </div>
        </div>

        {/* Filters */}
        <FilterBar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          filterStatus={filterStatus}
          onStatusChange={setFilterStatus}
          filterApproval={filterApproval}
          onApprovalChange={setFilterApproval}
          onClearFilters={handleClearFilters}
          searchPlaceholder="Search by fund name or symbol..."
        />

        <div className="text-xs md:text-sm text-white/60 mb-4 mt-2">
          Showing{' '}
          <span className="font-semibold text-white">
            {filteredOrders.length}
          </span>{' '}
          of{' '}
          <span className="font-semibold text-white">{orders.length}</span> orders
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          {filteredOrders.length === 0 ? (
            <EmptyState ordersLength={orders.length} />
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-3 px-4 text-left text-[11px] font-semibold text-white/60 uppercase tracking-wide">
                    Fund
                  </th>
                  <th className="py-3 px-4 text-left text-[11px] font-semibold text-white/60 uppercase tracking-wide">
                    Quantity
                  </th>
                  <th className="py-3 px-4 text-left text-[11px] font-semibold text-white/60 uppercase tracking-wide">
                    Total
                  </th>
                  <th className="py-3 px-4 text-left text-[11px] font-semibold text-white/60 uppercase tracking-wide">
                    Date
                  </th>
                  <th className="py-3 px-4 text-left text-[11px] font-semibold text-white/60 uppercase tracking-wide">
                    Payment
                  </th>
                  <th className="py-3 px-4 text-left text-[11px] font-semibold text-white/60 uppercase tracking-wide">
                    Approval
                  </th>
                  <th className="py-3 px-4 text-left text-[11px] font-semibold text-white/60 uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-b border-white/8 hover:bg-white/[0.04] transition-colors"
                  >
                    <td className="py-4 px-4">
                      <div>
                        <p className="font-medium text-white">
                          {order.fund.name}
                        </p>
                        <p className="text-xs text-white/60">
                          {order.fund.symbol}
                        </p>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-white">
                      {order.quantity.toLocaleString()}
                    </td>
                    <td className="py-4 px-4 font-semibold text-emerald-200">
                      ${order.total.toLocaleString()}
                    </td>
                    <td className="py-4 px-4 text-xs text-white/60">
                      {new Date(order.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-4 px-4">
                      <StatusBadge status={order.status} type="payment" />
                    </td>
                    <td className="py-4 px-4">
                      <StatusBadge status={order.approvalStatus} type="approval" />
                    </td>
                    <td className="py-4 px-4 space-y-1">
                      <TransactionLinks
                        txHash={order.txHash}
                        refundTxHash={order.refundTxHash}
                        tokenMintTxHash={order.tokenMintTxHash}
                      />
                      {order.status === 'PENDING' && (
                        <button
                          onClick={() => handleCancelOrder(order.id)}
                          disabled={cancellingId === order.id}
                          className="mt-1 inline-flex items-center gap-1 text-xs text-red-300 hover:text-red-200 disabled:opacity-50"
                        >
                          <FiX />
                          <span>
                            {cancellingId === order.id ? 'Cancelling…' : 'Cancel order'}
                          </span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden space-y-4">
          {filteredOrders.length === 0 ? (
            <EmptyState ordersLength={orders.length} />
          ) : (
            filteredOrders.map((order) => (
              <div
                key={order.id}
                className="bg-white/[0.03] border border-white/[0.12] rounded-2xl p-4 shadow-[0_12px_40px_rgba(0,0,0,0.35)] space-y-3"
              >
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <p className="font-semibold text-base text-white">
                      {order.fund.name}
                    </p>
                    <p className="text-xs text-white/60">{order.fund.symbol}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-base text-emerald-200">
                      ${order.total.toLocaleString()}
                    </p>
                    <p className="text-xs text-white/60">
                      {order.quantity.toLocaleString()} units
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={order.status} type="payment" />
                  <StatusBadge status={order.approvalStatus} type="approval" />
                </div>

                <div className="text-xs text-white/60">
                  {new Date(order.createdAt).toLocaleDateString()}
                </div>

                <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
                  <TransactionLinks
                    txHash={order.txHash}
                    refundTxHash={order.refundTxHash}
                    tokenMintTxHash={order.tokenMintTxHash}
                  />
                  {order.status === 'PENDING' && (
                    <button
                      onClick={() => handleCancelOrder(order.id)}
                      disabled={cancellingId === order.id}
                      className="inline-flex items-center gap-1 text-xs text-red-300 hover:text-red-200 disabled:opacity-50"
                    >
                      <FiX />
                      <span>
                        {cancellingId === order.id ? 'Cancelling…' : 'Cancel order'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

const EmptyState: React.FC<{ ordersLength: number }> = ({ ordersLength }) => {
  return (
    <div className="text-center text-white/70 py-10">
      {ordersLength === 0 ? (
        <>
          <p className="text-base md:text-lg text-white/80">
            You have no investment orders yet.
          </p>
          <p className="text-xs md:text-sm mt-2">
            Start exploring funds in the Marketplace to create your first order.
          </p>
        </>
      ) : (
        <p className="text-base md:text-lg text-white/80">
          No orders match your current filters.
        </p>
      )}
    </div>
  );
};

export default OrderList;
