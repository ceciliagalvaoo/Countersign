import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { sacadoService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandler';
import { useAuth } from '../../contexts/useAuth';
import { Link, Navigate } from 'react-router-dom';

interface Debtor {
  id: string;
  name: string;
  document: string;
  personType?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  sector?: string;
  size?: string;
  rating?: string;
  paymentHistory?: string;
  exposure?: number | null;
  creditLimitFund?: number | null;
  concentrationPercent?: number | null;
  defaultRate30d?: number | null;
  defaultRate60d?: number | null;
  defaultRate90d?: number | null;
  status: string;
  fund?: {
    id: string;
    name: string;
  };
}

const DebtorList: React.FC = () => {
    const [debtors, setDebtors] = useState<Debtor[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<Debtor | null>(null);
    const { user } = useAuth();
    const role = user?.role as string | undefined;

    if (role === 'CONSULTOR') {
        return <Navigate to="/dashboard" replace />;
    }
    if (role && role !== 'GESTOR') {
        return <p className="p-6 text-gray-300">Access restricted.</p>;
    }

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const response = await sacadoService.list();
            setDebtors(response?.sacados || []);
        } catch (error) {
            toast.error(getErrorMessage(error));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleApprove = async (id: string, action: 'approve' | 'reject') => {
        toast.loading('Processing...');
        try {
            const status = action === 'approve' ? 'APPROVED' : 'REJECTED';
            await sacadoService.updateStatus(id, status);
            toast.dismiss();
            toast.success(`Debtor ${action}d successfully!`);
            loadData();
            setSelected(null);
        } catch {
            toast.dismiss();
            toast.error('Error processing approval.');
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-8">
                <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-primary mb-4"></div>
                <p className="text-white">Loading debtors...</p>
            </div>
        );
    }

    return (
        <>
            <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-white">Manage Debtors</h2>
                    {user?.role === 'CONSULTOR' && (
                        <Link
                            to="/debtors/new"
                            className="px-3 py-2 text-sm text-white bg-primary rounded-md hover:bg-primary/90 transition-colors"
                        >
                            + Create Debtor
                        </Link>
                    )}
                </div>
                <div className="space-y-4">
                    {debtors.length === 0 ? (
                        <p className="text-center text-gray-400 py-8">No debtors found.</p>
                    ) : (
                        debtors.map((item) => (
                            <div key={item.id} className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
                                <div>
                                    <p className="font-semibold text-lg text-white">{item.name}</p>
                                    <p className="text-sm text-gray-300">Fund: {item.fund?.name || 'N/A'}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                        item.status === 'APPROVED' ? 'bg-[#A0E4B0] text-primary-800' :
                                        item.status === 'PENDING' ? 'bg-[#F8FBA2] text-yellow-800' :
                                        'bg-[#fa7f7f]-100 text-red-800'
                                    }`}>
                                        {item.status}
                                    </span>
                                    <button
                                        onClick={() => setSelected(item)}
                                        className="px-3 py-1.5 text-sm text-primary border border-primary rounded-md hover:bg-primary/10 transition-colors"
                                    >
                                        More info
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {selected && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
                    <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl w-full max-w-3xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-xl font-semibold text-white">{selected.name}</h3>
                                <p className="text-sm text-gray-300">Document: {selected.document}</p>
                                <p className="text-sm text-gray-300">Fund: {selected.fund?.name || 'N/A'}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                    selected.status === 'APPROVED' ? 'bg-[#A0E4B0] text-primary-800' :
                                    selected.status === 'PENDING' ? 'bg-[#F8FBA2] text-yellow-800' :
                                    'bg-[#fa7f7f]-100 text-red-800'
                                }`}>
                                    {selected.status}
                                </span>
                                <button
                                    onClick={() => setSelected(null)}
                                    className="text-sm text-gray-300 hover:underline"
                                >
                                    Close
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-sm text-gray-200">
                            <Info label="Type" value={selected.personType} />
                            <Info label="Email" value={selected.email} />
                            <Info label="Phone" value={selected.phone} />
                            <Info label="Address" value={selected.address} />
                            <Info label="City" value={selected.city} />
                            <Info label="State" value={selected.state} />
                            <Info label="Country" value={selected.country} />
                            <Info label="Postal code" value={selected.postalCode} />
                            <Info label="Sector" value={selected.sector} />
                            <Info label="Size" value={selected.size} />
                            <Info label="Rating" value={selected.rating} />
                            <Info label="Payment history" value={selected.paymentHistory} />
                            <Info label="Exposure" value={selected.exposure ? `$${selected.exposure.toLocaleString()}` : undefined} />
                            <Info label="Credit limit (fund)" value={selected.creditLimitFund ? `$${selected.creditLimitFund.toLocaleString()}` : undefined} />
                            <Info label="Concentration (%)" value={selected.concentrationPercent ?? undefined} />
                            <Info label="Default 30d (%)" value={selected.defaultRate30d ?? undefined} />
                            <Info label="Default 60d (%)" value={selected.defaultRate60d ?? undefined} />
                            <Info label="Default 90d (%)" value={selected.defaultRate90d ?? undefined} />
                        </div>

                        {selected.status === 'PENDING' && (
                            <div className="flex gap-2 justify-end mt-4">
                                <button
                                    onClick={() => selected && handleApprove(selected.id, 'approve')}
                                    className="px-4 py-2 text-sm text-white bg-primary rounded-md hover:bg-primary/90 transition-colors"
                                >
                                    Approve
                                </button>
                                <button
                                    onClick={() => selected && handleApprove(selected.id, 'reject')}
                                    className="px-4 py-2 text-sm text-white bg-[#fa7f7f]-500 rounded-md hover:bg-[#fa7f7f]-600 transition-colors"
                                >
                                    Reject
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

const Info: React.FC<{ label: string; value?: string | number }> = ({ label, value }) => (
    <div>
        <p className="text-xs uppercase text-gray-400 font-semibold">{label}</p>
        <p className="text-sm text-white">{value ?? 'N/A'}</p>
    </div>
);

export default DebtorList;
