import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { cedenteService, sacadoService } from '../services/api';
import { FiArrowLeft, FiPlus } from 'react-icons/fi';
import { getErrorMessage } from '../utils/errorHandler';
import { useNavigate } from 'react-router-dom';

// --- Type Definitions ---
interface Fund {
    id: string;
    name: string;
}
interface Cedente {
    id: string;
    name: string;
    document: string;
    fantasyName?: string;
    cnae?: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    beneficialOwners?: string;
    isPep?: boolean | null;
    revenueLast12m?: number | null;
    totalDebt?: number | null;
    mainBanks?: string;
    riskRating?: string;
    operationDescription?: string;
    creditPolicy?: string;
    guarantees?: string;
    status: string;
    fund?: {
        id: string;
        name: string;
    };
}
interface Sacado {
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
interface FundManagementProps {
    fund: Fund;
    onBack: () => void;
}

type Tab = 'assignors' | 'debtors';

// --- Main Component ---
const FundManagement: React.FC<FundManagementProps> = ({ fund, onBack }) => {
    const [activeTab, setActiveTab] = useState<Tab>('assignors');
    const [cedentes, setCedentes] = useState<Cedente[]>([]);
    const [sacados, setSacados] = useState<Sacado[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<Cedente | Sacado | null>(null);
    const navigate = useNavigate();

    // Data Loading
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const service = activeTab === 'assignors' ? cedenteService : sacadoService;
            const response = await service.listByFund(fund.id);
            if (activeTab === 'assignors') {
                setCedentes(response?.cedentes || []);
            } else {
                setSacados(response?.sacados || []);
            }
        } catch (error) {
            toast.error(getErrorMessage(error));
        } finally {
            setLoading(false);
        }
    }, [activeTab, fund.id]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center space-x-4">
                    <button onClick={onBack} className="p-2 rounded-full hover:bg-gray-700">
                        <FiArrowLeft />
                    </button>
                    <h1 className="text-2xl font-bold text-white">Manage: {fund.name}</h1>
                </div>

                {/* Tabs & Add Button */}
                <div className="flex justify-between items-center border-b border-gray-700">
                    <nav className="flex space-x-4">
                        <TabButton name="Assignors" active={activeTab === 'assignors'} onClick={() => setActiveTab('assignors')} />
                        <TabButton name="Debtors" active={activeTab === 'debtors'} onClick={() => setActiveTab('debtors')} />
                    </nav>
                    <button
                        onClick={() =>
                            activeTab === 'assignors'
                                ? navigate(`/assignors/new?fundId=${fund.id}`)
                                : navigate(`/debtors/new?fundId=${fund.id}`)
                        }
                        className="flex items-center px-4 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary/90"
                    >
                        <FiPlus className="mr-2" />
                        Add {activeTab === 'assignors' ? 'Assignor' : 'Debtor'}
                    </button>
                </div>

                {/* List */}
                {loading ? (
                    <p>Loading...</p>
                ) : (
                    <PartyList
                        items={activeTab === 'assignors' ? cedentes : sacados}
                        onSelect={setSelected}
                    />
                )}
            </div>

            {selected && (
                <DetailModal
                    item={selected}
                    onClose={() => setSelected(null)}
                />
            )}
        </>
    );
};


// --- Sub-components ---

const TabButton: React.FC<{ name: string, active: boolean, onClick: () => void }> = ({ name, active, onClick }) => (
    <button onClick={onClick} className={`py-3 px-1 border-b-2 font-medium text-sm ${active ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
        {name}
    </button>
);

const PartyList: React.FC<{ items: (Cedente | Sacado)[]; onSelect: (item: Cedente | Sacado) => void }> = ({ items, onSelect }) => {
    if (items.length === 0) return <p className="text-center text-gray-400 py-8">No items found.</p>;
    return (
        <div className="space-y-3">
            {items.map((item) => (
                <div key={item.id} className="border border-gray-700 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-dark-200">
                    <div>
                        <p className="font-semibold text-lg text-white">{item.name}</p>
                        <p className="text-sm text-gray-300">Fund: {item.fund?.name || 'N/A'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            item.status === 'APPROVED'
                                ? 'bg-primary-100 text-primary-800'
                                : item.status === 'PENDING'
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-[#fa7f7f]-100 text-red-800'
                        }`}>
                            {item.status}
                        </span>
                        <button
                            onClick={() => onSelect(item)}
                            className="px-3 py-1.5 text-sm text-primary border border-primary rounded-md hover:bg-primary/10 transition-colors"
                        >
                            More info
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
};

const Info: React.FC<{ label: string; value?: string | number }> = ({ label, value }) => (
    <div>
        <p className="text-xs uppercase text-gray-400 font-semibold">{label}</p>
        <p className="text-sm text-white">{value ?? 'N/A'}</p>
    </div>
);

const isCedente = (item: Cedente | Sacado): item is Cedente => 'fantasyName' in item;

const DetailModal: React.FC<{
    item: Cedente | Sacado;
    onClose: () => void;
}> = ({ item, onClose }) => {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-dark rounded-lg shadow-xl w-full max-w-3xl p-6 m-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-xl font-semibold text-white">{item.name}</h3>
                        <p className="text-sm text-gray-300">Document: {item.document}</p>
                        <p className="text-sm text-gray-300">Fund: {item.fund?.name || 'N/A'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            item.status === 'APPROVED'
                                ? 'bg-primary-100 text-primary-800'
                                : item.status === 'PENDING'
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-[#fa7f7f]-100 text-red-800'
                        }`}>
                            {item.status}
                        </span>
                        <button
                            onClick={onClose}
                            className="text-sm text-gray-300 hover:underline"
                        >
                            Close
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-sm text-gray-200">
                    {isCedente(item) ? (
                        <>
                            <Info label="Trade name" value={item.fantasyName} />
                            <Info label="CNAE" value={item.cnae} />
                            <Info label="Email" value={item.email} />
                            <Info label="Phone" value={item.phone} />
                            <Info label="Website" value={item.website} />
                            <Info label="Address" value={item.address} />
                            <Info label="City" value={item.city} />
                            <Info label="State" value={item.state} />
                            <Info label="Country" value={item.country} />
                            <Info label="Postal code" value={item.postalCode} />
                            <Info label="Beneficial owners" value={item.beneficialOwners} />
                            <Info label="PEP" value={item.isPep !== null && item.isPep !== undefined ? (item.isPep ? 'Yes' : 'No') : undefined} />
                            <Info label="Revenue last 12m" value={item.revenueLast12m ? `$${item.revenueLast12m.toLocaleString()}` : undefined} />
                            <Info label="Total debt" value={item.totalDebt ? `$${item.totalDebt.toLocaleString()}` : undefined} />
                            <Info label="Main banks" value={item.mainBanks} />
                            <Info label="Risk rating" value={item.riskRating} />
                            <Info label="Operation description" value={item.operationDescription} />
                            <Info label="Credit policy" value={item.creditPolicy} />
                            <Info label="Guarantees" value={item.guarantees} />
                        </>
                    ) : (
                        <>
                            <Info label="Type" value={item.personType} />
                            <Info label="Email" value={item.email} />
                            <Info label="Phone" value={item.phone} />
                            <Info label="Address" value={item.address} />
                            <Info label="City" value={item.city} />
                            <Info label="State" value={item.state} />
                            <Info label="Country" value={item.country} />
                            <Info label="Postal code" value={item.postalCode} />
                            <Info label="Sector" value={item.sector} />
                            <Info label="Size" value={item.size} />
                            <Info label="Rating" value={item.rating} />
                            <Info label="Payment history" value={item.paymentHistory} />
                            <Info label="Exposure" value={item.exposure ? `$${item.exposure.toLocaleString()}` : undefined} />
                            <Info label="Credit limit (fund)" value={item.creditLimitFund ? `$${item.creditLimitFund.toLocaleString()}` : undefined} />
                            <Info label="Concentration (%)" value={item.concentrationPercent ?? undefined} />
                            <Info label="Default 30d (%)" value={item.defaultRate30d ?? undefined} />
                            <Info label="Default 60d (%)" value={item.defaultRate60d ?? undefined} />
                            <Info label="Default 90d (%)" value={item.defaultRate90d ?? undefined} />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FundManagement;
