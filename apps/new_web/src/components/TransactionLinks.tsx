import React from 'react';
import { FiExternalLink } from 'react-icons/fi';
import { getTransactionUrl } from '../utils/stellar';

interface TransactionLinkProps {
  txHash?: string;
  label: string;
  colorClass?: string;
}

export const TransactionLink: React.FC<TransactionLinkProps> = ({ 
  txHash, 
  label,
  colorClass = 'text-blue-600 hover:text-blue-800'
}) => {
  if (!txHash) return null;

  return (
    <a
      href={getTransactionUrl(txHash)}
      target="_blank"
      rel="noopener noreferrer"
      className={`${colorClass} flex items-center space-x-1 text-sm`}
    >
      <span>{label}</span>
      <FiExternalLink />
    </a>
  );
};

interface TransactionLinksProps {
  txHash?: string;
  refundTxHash?: string;
  tokenMintTxHash?: string;
}

export const TransactionLinks: React.FC<TransactionLinksProps> = ({
  txHash,
  refundTxHash,
  tokenMintTxHash,
}) => {
  return (
    <div className="flex flex-col gap-2">
      <TransactionLink txHash={txHash} label="View Payment TX" />
      <TransactionLink 
        txHash={refundTxHash} 
        label="View Refund TX" 
        colorClass="text-purple-600 hover:text-purple-800"
      />
      <TransactionLink 
        txHash={tokenMintTxHash} 
        label="View Token Mint TX" 
        colorClass="text-green-600 hover:text-green-800"
      />
    </div>
  );
};
