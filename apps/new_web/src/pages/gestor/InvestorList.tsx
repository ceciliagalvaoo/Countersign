import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { userService } from '../../services/api';
import type { User } from '../../contexts/AuthContext';
import { getErrorMessage } from '../../utils/errorHandler';

const InvestorList: React.FC = () => {
    const [investidores, setInvestidores] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const response = await userService.getInvestidores();
            setInvestidores(response?.investidores || []);
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
            await userService.approveUser(id, status);
            toast.dismiss();
            toast.success(`Investor ${action}d successfully!`);
            loadData();
        } catch {
            toast.dismiss();
            toast.error('Error processing approval.');
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-8">
                <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-primary mb-4"></div>
                <p className="text-white">Loading investors...</p>
            </div>
        );
    }

    return (
        <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
            <h2 className="text-xl font-semibold mb-4 text-white">Manage Investors</h2>
            <div className="space-y-4">
                {investidores.length === 0 ? (
                    <p className="text-center text-gray-400 py-8">No investors found.</p>
                ) : (
                    investidores.map((item) => (
                        <div key={item.id} className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
                            <div>
                                <p className="font-semibold text-white">{item.email}</p>
                                <p className="text-sm text-gray-300">Status: {item.status}</p>
                            </div>
                            <div className="flex space-x-2 mt-2 sm:mt-0">
                                {item.status === 'PENDING' && (
                                    <>
                                        <button onClick={() => handleApprove(item.id, 'approve')} className="px-3 py-1 text-sm text-white bg-primary rounded-md hover:bg-primary/90">Approve</button>
                                        <button onClick={() => handleApprove(item.id, 'reject')} className="px-3 py-1 text-sm text-white bg-[#fa7f7f]-500 rounded-md hover:bg-[#fa7f7f]-600">Reject</button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default InvestorList;
