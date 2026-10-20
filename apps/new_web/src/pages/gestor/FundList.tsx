import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { fundService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandler';
import { useAuth } from '../../contexts/useAuth';
import { Link, Navigate } from 'react-router-dom';
import UsdcAmount from '../../components/UsdcAmount';
import PauseFundUnits from '../../components/PauseFundUnits';
import { PenLoader } from '../../components/ink/PenLoader';

interface Fund {
  id: string;
  name: string;
  symbol: string;
  status: string;
  maxSupply: number;
  totalIssued: number;
  price: number;
  tokenContractId?: string | null;
  paused?: boolean | null;
}

const FundList: React.FC = () => {
    const { user } = useAuth();
    const role = user?.role as string | undefined;
    const [funds, setFunds] = useState<Fund[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedFund, setSelectedFund] = useState<Fund | null>(null);
    const [showIssueModal, setShowIssueModal] = useState(false);

    const loadData = useCallback(async () => {
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
        loadData();
    }, [loadData]);

    if (user?.role === 'CONSULTOR') {
        return <Navigate to="/dashboard" replace />;
    }
    if (user && user.role !== 'GESTOR') {
        return <p className="p-6 text-gray-300">Access restricted.</p>;
    }

    const handleDeactivate = async (id: string) => {
        if (!confirm('Are you sure you want to deactivate this fund?')) return;
        
        toast.loading('Deactivating fund...');
        try {
            await fundService.deactivate(id);
            toast.dismiss();
            toast.success('Fund deactivated successfully!');
            loadData();
        } catch (error) {
            toast.dismiss();
            toast.error(getErrorMessage(error));
        }
    };

    const handleIssueQuotas = (fund: Fund) => {
        setSelectedFund(fund);
        setShowIssueModal(true);
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-8">
                <PenLoader />
                <p className="text-white">Loading funds...</p>
            </div>
        );
    }

    return (
        <>
            {showIssueModal && selectedFund && (
                <IssueQuotasModal 
                    fund={selectedFund} 
                    onClose={() => {
                        setShowIssueModal(false);
                        setSelectedFund(null);
                    }}
                    onSuccess={loadData}
                />
            )}
            
            <div className="bg-cream-deep/70 border border-navy/10 rounded-card p-6 md:p-8 shadow-ink">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-28 font-medium text-white">Manage Funds</h2>
                    {role === 'CONSULTOR' && (
                        <Link
                            to="/fundos/new"
                            className="px-3 py-2 text-sm text-cream bg-primary rounded-full hover:bg-navy transition-colors"
                        >
                            + Create Fund
                        </Link>
                    )}
                </div>
                <div className="space-y-4">
                    {funds.length === 0 ? (
                        <p className="text-center text-gray-400 py-8">No funds found.</p>
                    ) : (
                        funds.map((item) => (
                            <div key={item.id} className="bg-cream-deep/70 border border-navy/10 rounded-card p-6 md:p-8 shadow-ink">
                                <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-4">
                                    <div className="flex-1">
                                        <p className="font-semibold text-lg text-white">{item.name} ({item.symbol})</p>
                                        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                                            <p className="text-gray-300">
                                                <span className="font-medium">Status:</span>{' '}
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                                    item.status === 'APPROVED' ? 'bg-cobalt/10 text-primary-800' :
                                                    item.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' :
                                                    item.status === 'CLOSED' ? 'bg-gray-700 text-gray-200' :
                                                    'bg-red-100 text-red-800'
                                                }`}>
                                                    {item.status}
                                                </span>
                                            </p>
                                            <p className="text-gray-300">
                                                <span className="font-medium">Issued:</span> {item.totalIssued.toLocaleString()} / {item.maxSupply.toLocaleString()}
                                            </p>
                                            <p className="text-gray-300">
                                                <span className="font-medium">Price:</span>{' '}
                                                <UsdcAmount amount={item.price} />
                                            </p>
                                            <p className="text-gray-300">
                                                <span className="font-medium">Available:</span> {(item.maxSupply - item.totalIssued).toLocaleString()}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Link
                                            to={`/fundos/${item.id}`}
                                            className="btn btn-sm btn-secondary"
                                        >
                                            More info
                                        </Link>
                                        {item.status === 'PENDING' && (
                                            <span className="px-3 py-1.5 text-sm rounded-md bg-yellow-100 text-yellow-800 border border-yellow-200">
                                                Pending approval
                                            </span>
                                        )}
                                        {item.status === 'APPROVED' && (
                                            <>
                                                <button 
                                                    onClick={() => handleIssueQuotas(item)} 
                                                    className="btn btn-sm btn-primary"
                                                    disabled={item.totalIssued >= item.maxSupply}
                                                >
                                                    Issue Quotas
                                                </button>
                                                <PauseFundUnits fund={item} onDone={loadData} />
                                                <button 
                                                    onClick={() => handleDeactivate(item.id)} 
                                                    className="btn btn-sm btn-ghost"
                                                >
                                                    Deactivate
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </>
    );
};

const IssueQuotasModal: React.FC<{ 
    fund: Fund; 
    onClose: () => void; 
    onSuccess: () => void;
}> = ({ fund, onClose, onSuccess }) => {
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);

    const maxAvailable = fund.maxSupply - fund.totalIssued;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const amountNum = parseInt(amount);
        
        if (amountNum <= 0 || amountNum > maxAvailable) {
            toast.error(`Amount must be between 1 and ${maxAvailable.toLocaleString()}`);
            return;
        }

        setLoading(true);
        try {
            await fundService.issueQuotas(fund.id, amountNum);
            toast.success(`Successfully issued ${amountNum.toLocaleString()} quotas!`);
            onSuccess();
            onClose();
        } catch (error) {
            toast.error(getErrorMessage(error));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="module-scrim fixed inset-0 z-50 flex items-center justify-center bg-navy/30">
            <div className="bg-cream-deep/70 border border-navy/10 rounded-card w-full max-w-md p-6 md:p-8 shadow-ink">
                <h2 className="text-28 font-medium mb-4 text-white">Issue Quotas - {fund.name}</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <p className="text-sm text-gray-300 mb-2">
                            Current: <span className="font-semibold">{fund.totalIssued.toLocaleString()}</span> / {fund.maxSupply.toLocaleString()}
                        </p>
                        <p className="text-sm text-gray-300 mb-4">
                            Available to issue: <span className="font-semibold text-primary">{maxAvailable.toLocaleString()}</span>
                        </p>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Amount to Issue
                        </label>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="Enter amount"
                            min="1"
                            max={maxAvailable}
                            className="w-full bg-dark-200 px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                            required
                        />
                    </div>
                    <div className="flex justify-end space-x-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-300 bg-dark-200 rounded-md hover:bg-gray-700 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !amount}
                            className="px-4 py-2 text-cream bg-primary rounded-full hover:bg-navy disabled:bg-primary/50 transition-colors"
                        >
                            {loading ? 'Issuing...' : 'Issue Quotas'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default FundList;
