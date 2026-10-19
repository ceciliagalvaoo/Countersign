import React from 'react';
import { FiCheckCircle, FiClock, FiXCircle } from 'react-icons/fi';

interface StatusBadgeProps {
  status: string;
  type: 'payment' | 'approval';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, type }) => {
  if (type === 'payment') {
    switch (status.toUpperCase()) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center space-x-1 px-3 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
            <FiCheckCircle />
            <span>Completed</span>
          </span>
        );
      case 'PENDING':
        return (
          <span className="inline-flex items-center space-x-1 px-3 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
            <FiClock />
            <span>Pending</span>
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center space-x-1 px-3 py-1 text-xs font-semibold rounded-full bg-[#fa7f7f]-100 text-red-800">
            <FiXCircle />
            <span>Failed</span>
          </span>
        );
      default:
        return (
          <span className="px-3 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
            {status}
          </span>
        );
    }
  }

  // Approval status
  switch (status.toUpperCase()) {
    case 'APPROVED':
      return (
        <span className="inline-flex items-center space-x-1 px-3 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
          <FiCheckCircle />
          <span>Approved</span>
        </span>
      );
    case 'PENDING_APPROVAL':
      return (
        <span className="inline-flex items-center space-x-1 px-3 py-1 text-xs font-semibold rounded-full bg-orange-100 text-orange-800">
          <FiClock />
          <span>Awaiting Approval</span>
        </span>
      );
    case 'REJECTED':
      return (
        <span className="inline-flex items-center space-x-1 px-3 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
          <FiXCircle />
          <span>Rejected</span>
        </span>
      );
    default:
      return null;
  }
};
