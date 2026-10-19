import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { orderService, fundService } from '../services/api';
import {
  FiDollarSign,
  FiList,
  FiClock,
  FiCheckCircle,
  FiBox,
  FiTrendingUp,
} from 'react-icons/fi';
import { useAuth } from '../contexts/useAuth';
import { getErrorMessage } from '../utils/errorHandler';
import InvestorBadge from '../components/InvestorBadge';
import RecommendedFunds from '../components/RecommendedFunds';

interface Order {
  id: string;
  total: number;
  quantity: number;
  status: string;
  fund?: {
    name: string;
    quotaPrice: number;
  };
}

interface Fund {
  id: string;
  name: string;
  status: string;
}

const InvestidorDashboard: React.FC = () => {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [ordersResponse, fundsResponse] = await Promise.all([
        orderService.list(),
        fundService.list(),
      ]);
      setOrders(ordersResponse.orders || []);
      setFunds(fundsResponse.funds || []);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const pendingOrders = orders.filter((order) => order.status === 'PENDING');
  const completedOrders = orders.filter((order) => order.status === 'COMPLETED');
  const totalInvested = completedOrders.reduce((sum, order) => sum + order.total, 0);
  const totalPendingValue = pendingOrders.reduce((sum, order) => sum + order.total, 0);
  const totalQuotas = completedOrders.reduce((sum, order) => sum + order.quantity, 0);
  const availableFunds = funds.filter((fund) => fund.status === 'APPROVED').length;

  if (user?.status !== 'APPROVED') {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)] text-center">
          <p className="text-[10px] tracking-[0.2em] uppercase text-emerald-300 mb-2">
            Investor onboarding
          </p>
          <h2 className="text-2xl md:text-3xl font-bold mb-2 text-white">
            Awaiting approval
          </h2>
          <p className="text-sm text-white/70 max-w-md mx-auto">
            Your account is currently <span className="font-semibold">{user?.status}</span>.  
            You&apos;ll get access to the investment dashboard as soon as your profile
            is approved.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
        <p className="text-[10px] tracking-[0.2em] uppercase text-emerald-300">
          Investor dashboard
        </p>
        <h1 className="text-2xl md:text-3xl font-bold text-white mt-2">
          Welcome, Investor
        </h1>
        <p className="mt-2 text-sm text-white/70">
          Track your allocations, pending orders and new opportunities in one place.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-10 h-10 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              icon={<FiDollarSign />}
              title="Total invested"
              value={`$${totalInvested.toLocaleString()}`}
              accent="emerald"
            />
            <StatCard
              icon={<FiCheckCircle />}
              title="Completed orders"
              value={completedOrders.length}
              accent="emerald"
            />
            <StatCard
              icon={<FiClock />}
              title="Pending orders"
              value={pendingOrders.length}
              subtitle={
                totalPendingValue > 0
                  ? `$${totalPendingValue.toLocaleString()} pending`
                  : undefined
              }
              accent="amber"
            />
            <StatCard
              icon={<FiTrendingUp />}
              title="Total quotas"
              value={totalQuotas.toLocaleString()}
              accent="sky"
            />
            <StatCard
              icon={<FiBox />}
              title="Available funds"
              value={availableFunds}
              accent="indigo"
            />
            <StatCard
              icon={<FiList />}
              title="Total orders"
              value={orders.length}
              accent="slate"
            />
          </div>

          {/* Investor Badge */}
          {user?.id && (
            <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
              <InvestorBadge userId={user.id} />
            </div>
          )}

          {/* Recommended Funds */}
          {user?.id && (
            <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
              <RecommendedFunds />
            </div>
          )}

          {/* Pending orders detail */}
          {pendingOrders.length > 0 && (
            <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
              <div className="flex items-start gap-3">
                <div className="mt-1">
                  <FiClock className="text-amber-300 text-xl" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-white mb-1">
                    Pending orders
                  </h3>
                  <p className="text-sm text-white/70 mb-4">
                    You have{' '}
                    <span className="font-semibold">
                      {pendingOrders.length} pending order
                      {pendingOrders.length > 1 ? 's' : ''}
                    </span>{' '}
                    with a total value of{' '}
                    <span className="font-semibold">
                      ${totalPendingValue.toLocaleString()}
                    </span>
                    .
                  </p>

                  <div className="space-y-2">
                    {pendingOrders.map((order) => (
                      <div
                        key={order.id}
                        className="bg-white/[0.03] border border-white/[0.12] rounded-xl px-4 py-3 flex flex-col gap-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm text-white">
                            {order.fund?.name || 'Fund'}
                          </span>
                          <span className="text-xs text-white/60">
                            {order.quantity} quotas × $
                            {order.fund?.quotaPrice || 0} ={' '}
                            <span className="font-semibold text-white">
                              ${order.total.toLocaleString()}
                            </span>
                          </span>
                        </div>
                        <p className="text-[11px] text-white/50">
                          Status: awaiting approval from fund manager.
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const StatCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  value: number | string;
  accent?: 'emerald' | 'sky' | 'indigo' | 'amber' | 'slate';
  subtitle?: string;
}> = ({ icon, title, value, accent = 'emerald', subtitle }) => {
  const accentClasses: Record<typeof accent, { icon: string; title: string }> = {
    emerald: {
      icon: 'bg-emerald-500/10 border border-emerald-400/40 text-emerald-300',
      title: 'text-emerald-100',
    },
    sky: {
      icon: 'bg-sky-500/10 border border-sky-400/40 text-sky-300',
      title: 'text-sky-100',
    },
    indigo: {
      icon: 'bg-indigo-500/10 border border-indigo-400/40 text-indigo-300',
      title: 'text-indigo-100',
    },
    amber: {
      icon: 'bg-amber-500/10 border border-amber-400/40 text-amber-300',
      title: 'text-amber-100',
    },
    slate: {
      icon: 'bg-slate-500/10 border border-slate-400/40 text-slate-200',
      title: 'text-slate-100',
    },
  };

  const cls = accentClasses[accent];

  return (
    <div className="bg-white/[0.03] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-5 md:p-6 shadow-[0_12px_40px_rgba(0,0,0,0.35)] flex items-center gap-4">
      <div
        className={`p-3 rounded-full text-xl flex items-center justify-center ${cls.icon}`}
      >
        {icon}
      </div>
      <div>
        <p className="text-xs font-medium text-white/60 uppercase tracking-wide mb-1">
          {title}
        </p>
        <p className={`text-2xl font-bold ${cls.title}`}>{value}</p>
        {subtitle && (
          <p className="text-[11px] text-white/60 mt-1">{subtitle}</p>
        )}
      </div>
    </div>
  );
};

export default InvestidorDashboard;
