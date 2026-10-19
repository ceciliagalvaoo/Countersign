import React, { useState, useEffect } from 'react';
import {
  dashboardService,
  userService,
  fundService,
  orderService,
} from '../services/api';
import {
  FiUsers,
  FiUserCheck,
  FiBox,
  FiDollarSign,
  FiAlertCircle,
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errorHandler';
import { Link } from 'react-router-dom';

interface Stats {
  totalConsultants: number;
  totalInvestors: number;
  totalFunds: number;
  totalInvestments: number;
  pendingApprovals: {
    consultores: number;
    investidores: number;
    funds: number;
    assignors: number;
    debtors: number;
  };
}

const GestorDashboard: React.FC = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [pendingCounts, consultores, investidores, funds, orders] =
          await Promise.all([
            dashboardService.getPendingCounts(),
            userService.getConsultores(),
            userService.getInvestidores(),
            fundService.list(),
            orderService.list(),
          ]);

        setStats({
          totalConsultants: consultores?.consultores?.length || 0,
          totalInvestors: investidores?.investidores?.length || 0,
          totalFunds: funds?.funds?.length || 0,
          totalInvestments: orders?.orders?.length || 0,
          pendingApprovals: pendingCounts.pendingCounts,
        });
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setLoading(false);
      }
    };

    loadStats();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-10 h-10 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin mb-4" />
        <p className="text-sm text-white/80">Loading dashboard…</p>
      </div>
    );
  }

  const totalPending =
    stats
      ? stats.pendingApprovals.consultores +
        stats.pendingApprovals.investidores +
        stats.pendingApprovals.funds +
        stats.pendingApprovals.assignors +
        stats.pendingApprovals.debtors
      : 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <p className="text-[10px] tracking-[0.2em] uppercase text-emerald-300">
          Platform oversight
        </p>
        <h1 className="text-3xl md:text-4xl font-bold text-white mt-1">
          Management Dashboard
        </h1>
        <p className="text-sm text-white/70 mt-1">
          High-level overview of consultants, investors, funds and investments.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={<FiUsers />}
          title="Consultants"
          value={stats?.totalConsultants || 0}
          pending={stats?.pendingApprovals.consultores || 0}
          accent="emerald"
        />
        <StatCard
          icon={<FiUserCheck />}
          title="Investors"
          value={stats?.totalInvestors || 0}
          pending={stats?.pendingApprovals.investidores || 0}
          accent="sky"
        />
        <StatCard
          icon={<FiBox />}
          title="Funds"
          value={stats?.totalFunds || 0}
          pending={stats?.pendingApprovals.funds || 0}
          accent="indigo"
        />
        <StatCard
          icon={<FiDollarSign />}
          title="Investments"
          value={stats?.totalInvestments || 0}
          pending={0}
          accent="amber"
        />
      </div>

      {/* Pending Approvals Alert */}
      {stats && totalPending > 0 && (
        <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
          <div className="flex items-start gap-3">
            <FiAlertCircle className="text-[#F8FBA2] text-2xl mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-lg text-white">
                Pending approvals
              </h3>
              <p className="text-sm text-white/70 mt-1">
                You have{' '}
                <span className="font-semibold text-[#F8FBA2]">
                  {totalPending}
                </span>{' '}
                items waiting for review.
              </p>
              <ul className="mt-3 space-y-1 text-xs md:text-sm text-white/70">
                {stats.pendingApprovals.consultores > 0 && (
                  <li>
                    • {stats.pendingApprovals.consultores} consultant
                    {stats.pendingApprovals.consultores > 1 ? 's' : ''}
                  </li>
                )}
                {stats.pendingApprovals.investidores > 0 && (
                  <li>
                    • {stats.pendingApprovals.investidores} investor
                    {stats.pendingApprovals.investidores > 1 ? 's' : ''}
                  </li>
                )}
                {stats.pendingApprovals.funds > 0 && (
                  <li>
                    • {stats.pendingApprovals.funds} fund
                    {stats.pendingApprovals.funds > 1 ? 's' : ''}
                  </li>
                )}
                {stats.pendingApprovals.assignors > 0 && (
                  <li>
                    • {stats.pendingApprovals.assignors} assignor
                    {stats.pendingApprovals.assignors > 1 ? 's' : ''}
                  </li>
                )}
                {stats.pendingApprovals.debtors > 0 && (
                  <li>
                    • {stats.pendingApprovals.debtors} debtor
                    {stats.pendingApprovals.debtors > 1 ? 's' : ''}
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
        <h2 className="text-xl font-semibold mb-2 text-white">Quick actions</h2>
        <p className="text-xs md:text-sm text-white/70 mb-4">
          Jump directly into the main review and management flows.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          <QuickActionButton to="/consultores" label="Review consultants" />
          <QuickActionButton to="/investidores" label="Review investors" />
          <QuickActionButton to="/fundos" label="Manage funds" />
          <QuickActionButton to="/investments" label="Review investments" />
          <QuickActionButton to="/assignors" label="Manage assignors" />
          <QuickActionButton to="/debtors" label="Manage debtors" />
        </div>
      </div>
    </div>
  );
};

const StatCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  value: number;
  pending?: number;
  accent?: 'emerald' | 'sky' | 'indigo' | 'amber';
}> = ({ icon, title, value, pending = 0, accent = 'emerald' }) => {
  const accentStyles: Record<
    NonNullable<typeof accent>,
    { icon: string; value: string; pill: string }
  > = {
    emerald: {
      icon: 'bg-emerald-500/15 border border-emerald-400/40 text-emerald-300',
      value: 'text-emerald-100',
      pill: 'bg-emerald-500/20 text-emerald-100 border border-emerald-400/40',
    },
    sky: {
      icon: 'bg-sky-500/15 border border-sky-400/40 text-sky-300',
      value: 'text-sky-100',
      pill: 'bg-sky-500/20 text-sky-100 border border-sky-400/40',
    },
    indigo: {
      icon: 'bg-indigo-500/15 border border-indigo-400/40 text-indigo-300',
      value: 'text-indigo-100',
      pill: 'bg-indigo-500/20 text-indigo-100 border border-indigo-400/40',
    },
    amber: {
      icon: 'bg-amber-500/15 border border-amber-400/40 text-amber-300',
      value: 'text-amber-100',
      pill: 'bg-amber-500/20 text-amber-100 border border-amber-400/40',
    },
  };

  const cls = accentStyles[accent];

  return (
    <div className="bg-white/[0.03] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-5 md:p-6 shadow-[0_14px_45px_rgba(0,0,0,0.4)]">
      <div className="flex items-start justify-between mb-4">
        <div
          className={`p-3 rounded-full text-xl flex items-center justify-center ${cls.icon}`}
        >
          {icon}
        </div>
        {pending > 0 && (
          <span
            className={`px-2 py-1 rounded-full text-[11px] font-medium flex items-center gap-1 ${cls.pill}`}
          >
            {pending} pending
          </span>
        )}
      </div>
      <h3 className="text-xs font-medium text-white/60 uppercase tracking-wide">
        {title}
      </h3>
      <p className={`text-3xl font-bold mt-2 ${cls.value}`}>{value}</p>
    </div>
  );
};

const QuickActionButton: React.FC<{ to: string; label: string }> = ({
  to,
  label,
}) => (
  <Link
    to={to}
    className="block px-4 py-3 text-xs md:text-sm font-medium text-white/80 bg-white/5 border border-white/12 rounded-2xl shadow-[0_14px_45px_rgba(0,0,0,0.4)] hover:bg-white/10 hover:text-white transition"
  >
    {label}
  </Link>
);

export default GestorDashboard;
