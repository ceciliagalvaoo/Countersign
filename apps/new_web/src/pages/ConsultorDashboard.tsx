import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { FiBox, FiPlus, FiGrid } from 'react-icons/fi';
import { fundService } from '../services/api';
import { getErrorMessage } from '../utils/errorHandler';
import FundManagement from '../components/FundManagement';
import { useNavigate } from 'react-router-dom';

interface Fund {
  id: string;
  name: string;
  symbol: string;
  description: string;
  status: string;
  totalIssued: number;
  maxSupply: number;
  price: number;
}

const ConsultorDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [funds, setFunds] = useState<Fund[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFund, setSelectedFund] = useState<Fund | null>(null);

  const loadFunds = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fundService.list();
      setFunds(response?.funds || []);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFunds();
  }, [loadFunds]);

  // Management view
  if (selectedFund) {
    return <FundManagement fund={selectedFund} onBack={() => setSelectedFund(null)} />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 space-y-10">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-emerald-300">
            Consultant workspace
          </p>
          <h1 className="text-3xl md:text-4xl font-bold text-white">My Funds</h1>
          <p className="text-white/70 text-sm mt-1">
            Create and manage structured tokenized receivable funds.
          </p>
        </div>

        <button
          onClick={() => navigate('/fundos/new')}
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white text-black font-medium shadow-[0_10px_30px_rgba(0,0,0,0.35)] hover:scale-[1.02] transition"
        >
          <FiPlus className="text-lg" />
          Create Fund
        </button>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard icon={<FiGrid />} title="Total Funds" value={funds.length} />
        <StatCard 
          icon={<FiBox />} 
          title="Pending Approval" 
          value={funds.filter(f => f.status === 'PENDING').length} 
        />
      </div>

      {/* FUNDS LIST */}
      <div className="bg-white/[0.03] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
        <h2 className="text-xl font-semibold text-white mb-4">Fund Details</h2>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-10 h-10 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
          </div>
        ) : funds.length === 0 ? (
          <p className="text-center text-white/60 py-10">No funds created yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {funds.map(fund => (
              <FundCard key={fund.id} fund={fund} onManage={() => setSelectedFund(fund)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* --- SUB COMPONENTS --- */

const StatCard: React.FC<{ icon: React.ReactNode; title: string; value: number | string }> = 
({ icon, title, value }) => (
  <div className="p-6 md:p-8 bg-white/[0.03] border border-white/[0.12] backdrop-blur-xl rounded-2xl shadow-[0_18px_60px_rgba(0,0,0,0.45)] flex items-center gap-4">
    <div className="p-3 rounded-full bg-emerald-300/20 text-emerald-200 text-xl">
      {icon}
    </div>
    <div>
      <p className="text-sm text-white/60">{title}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  </div>
);

const FundCard: React.FC<{ fund: Fund; onManage: () => void }> = ({ fund, onManage }) => {
  const statusColor = {
    PENDING: "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40",
    APPROVED: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
    REJECTED: "bg-red-500/20 text-red-300 border border-red-500/40",
  }[fund.status] || "bg-gray-500/20 text-gray-300";

  return (
    <div className="bg-white/[0.03] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-7 shadow-[0_14px_45px_rgba(0,0,0,0.4)] flex flex-col justify-between">
      <div className="space-y-2">
        <div className="flex justify-between items-start">
          <h3 className="text-lg font-bold text-white">
            {fund.name} ({fund.symbol})
          </h3>
          <span className={`px-2 py-1 rounded-full text-[11px] font-medium ${statusColor}`}>
            {fund.status}
          </span>
        </div>
        <p className="text-sm text-white/70 line-clamp-3">{fund.description}</p>
      </div>

      <div className="mt-4 space-y-1 text-sm text-white/70">
        <p><strong className="text-white">Price:</strong> ${fund.price.toLocaleString()}</p>
        <p><strong className="text-white">Max Supply:</strong> {fund.maxSupply.toLocaleString()}</p>
        <p><strong className="text-white">Issued:</strong> {fund.totalIssued.toLocaleString()}</p>
      </div>

      <button
        onClick={onManage}
        className="w-full mt-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition text-sm text-white font-medium"
      >
        Manage Fund
      </button>
    </div>
  );
};

export default ConsultorDashboard;
