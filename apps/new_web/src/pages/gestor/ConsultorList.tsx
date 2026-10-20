import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { userService } from '../../services/api';
import type { User } from '../../contexts/AuthContext';
import { getErrorMessage } from '../../utils/errorHandler';
import { PenLoader } from '../../components/ink/PenLoader';

const ConsultorList: React.FC = () => {
    const [consultores, setConsultores] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const response = await userService.getConsultores();
            setConsultores(response?.consultores || []);
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
            toast.success(`Consultant ${action}d successfully!`);
            loadData();
        } catch {
            toast.dismiss();
            toast.error('Error processing approval.');
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-8">
                <PenLoader />
                <p className="text-white">Loading consultants...</p>
            </div>
        );
    }

    return (
        <div className="bg-cream-deep/70 border border-navy/10 rounded-card p-6 md:p-8 shadow-ink">
            <h2 className="text-28 font-medium mb-4 text-white">Manage Consultants</h2>
            <div className="space-y-4">
                {consultores.length === 0 ? (
                    <p className="text-center text-gray-400 py-8">No consultants found.</p>
                ) : (
                    consultores.map((item) => (
                        <div key={item.id} className="bg-cream-deep/70 border border-navy/10 rounded-card p-6 md:p-8 shadow-ink">
                            <div>
                                <p className="font-semibold text-white">{item.email}</p>
                                <p className="text-sm text-gray-300">Status: {item.status}</p>
                            </div>
                            <div className="flex space-x-2 mt-2 sm:mt-0">
                                {item.status === 'PENDING' && (
                                    <>
                                        <button onClick={() => handleApprove(item.id, 'approve')} className="px-3 py-1 text-sm text-cream bg-primary rounded-full hover:bg-navy">Approve</button>
                                        <button onClick={() => handleApprove(item.id, 'reject')} className="px-3 py-1 text-sm text-cream bg-vermilion-500 rounded-full hover:bg-vermilion-600">Reject</button>
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

export default ConsultorList;
