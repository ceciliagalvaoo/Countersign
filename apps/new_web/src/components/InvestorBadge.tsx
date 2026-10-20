import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errorHandler';
import { API_BASE_URL, badgeService } from '../services/api';
import { useWallet } from '../contexts/WalletContext';
import { proveTier } from '../utils/zkBadge';
import { PenLoader } from '../components/ink/PenLoader';

interface BadgeInfo {
  badge: string;
  name: string;
  minAmount: number;
  color: string;
  icon: string;
  benefits: string[];
  hasProof: boolean;
  onChain: { tier: string | null; txHash: string } | null;
}

interface BadgeProgress {
  currentBadge: string;
  nextBadge: string | null;
  progressPercentage: number;
  amountToNext: number;
}

interface UserBadgeData {
  user: {
    id: string;
    email: string;
    totalInvested: number;
    lastBadgeUpdate: string | null;
  };
  badge: BadgeInfo;
  progress: BadgeProgress;
}


const InvestorBadge: React.FC<{ userId: string }> = React.memo(({ userId }) => {
  const [badgeData, setBadgeData] = useState<UserBadgeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proving, setProving] = useState(false);
  const { publicKey, isConnected, connect, signAndSubmitTransaction } = useWallet();

  const fetchBadgeData = useCallback(async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await axios.get(`${API_BASE_URL}/badges/${userId}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      setBadgeData(response.data);
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      fetchBadgeData();
    } else {
      setLoading(false);
    }
  }, [userId, fetchBadgeData]);

  // Zero-knowledge tier proof: generated in the browser, verified on-chain by the BadgeVerifier contract
  const proveOnChain = async () => {
    if (!isConnected || !publicKey) {
      toast.error('Connect your wallet first');
      await connect();
      return;
    }
    setProving(true);
    const toastId = toast.loading('Generating zero-knowledge proof in your browser...');
    try {
      const witness = await badgeService.zkWitness(userId);
      if (witness.investor !== publicKey) {
        toast.error('Connect the wallet registered on your account', { id: toastId });
        return;
      }
      const proof = await proveTier(witness);
      toast.loading('Verifying the proof on Stellar...', { id: toastId });
      const { transactionXdr } = await badgeService.buildClaim(userId, witness.threshold, proof);
      const txHash = await signAndSubmitTransaction(transactionXdr);
      const result = await badgeService.confirmClaim(userId, txHash);
      toast.success(`${result.tier} badge verified on-chain without revealing your amount`, { id: toastId });
      await fetchBadgeData();
    } catch (err) {
      toast.error(getErrorMessage(err), { id: toastId });
    } finally {
      setProving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-cream-deep/70 border border-navy/10 rounded-card p-6 md:p-8 shadow-ink">
        <div className="flex items-center justify-center py-8">
          <PenLoader />
        </div>
      </div>
    );
  }

  if (error || !badgeData) {
    return null;
  }

  const { badge, progress } = badgeData;

  return (
    <div className="bg-cream-deep/70 border border-navy/10 rounded-card p-6 md:p-8 shadow-ink">
      <h4 className="text-lg font-semibold text-white mb-3">
        Investor Badge
      </h4>
      
      <div className="mb-4">
        <p className="text-xs text-gray-300 mb-2">Current Level</p>
        <div 
          className="inline-block px-4 py-2 rounded-lg"
          style={{ 
            backgroundColor: `${badge.color}15`,
            borderLeft: `3px solid ${badge.color}`
          }}
        >
          <span className="text-lg font-semibold" style={{ color: badge.color }}>
            {badge.name}
          </span>
        </div>
      </div>

      {progress.nextBadge && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-300">
              Progress to {progress.nextBadge}
            </span>
            <span className="text-xs font-medium text-gray-200">
              {Math.round(progress.progressPercentage)}%
            </span>
          </div>
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full rounded-full transition-all duration-300"
              style={{ 
                width: `${Math.max(2, progress.progressPercentage)}%`,
                backgroundColor: badge.color
              }}
            />
          </div>
          <p className="text-xs text-gray-300 mt-2">
            ${progress.amountToNext.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC to next level
          </p>
        </div>
      )}

      <div className="mb-4 text-xs">
        {badge.onChain ? (
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${badge.onChain.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-300 hover:underline"
          >
            ✓ {badge.onChain.tier} tier proven on Stellar (zero-knowledge, amount private)
          </a>
        ) : (
          <span className="text-gray-300">Tier not yet proven on-chain.</span>
        )}
        {badge.hasProof && badge.onChain?.tier !== badge.badge && (
          <button
            onClick={proveOnChain}
            disabled={proving}
            className="block mt-2 px-3 py-1.5 text-xs font-medium text-cream bg-primary rounded-full hover:bg-navy disabled:opacity-50"
          >
            {proving ? 'Proving...' : 'Prove tier on Stellar (ZK)'}
          </button>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-300 mb-2">Benefits:</p>
        <ul className="space-y-1">
          {badge.benefits && badge.benefits.length > 0 ? (
            badge.benefits.map((benefit, index) => (
              <li key={index} className="flex items-start gap-2 text-xs text-gray-300">
                <svg 
                  width="12" 
                  height="12" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  className="flex-shrink-0 mt-0.5"
                  style={{ color: badge.color }}
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span>{benefit}</span>
              </li>
            ))
          ) : (
            <li className="text-xs text-gray-300">No benefits available</li>
          )}
        </ul>
      </div>
    </div>
  );
});

InvestorBadge.displayName = 'InvestorBadge';

export default InvestorBadge;
