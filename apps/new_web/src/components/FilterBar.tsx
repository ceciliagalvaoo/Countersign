import React from 'react';
import { FiFilter } from 'react-icons/fi';

interface FilterBarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  filterStatus: string;
  onStatusChange: (value: string) => void;
  filterApproval: string;
  onApprovalChange: (value: string) => void;
  onClearFilters: () => void;
  searchPlaceholder?: string;
}

const FilterBar: React.FC<FilterBarProps> = ({
  searchTerm,
  onSearchChange,
  filterStatus,
  onStatusChange,
  filterApproval,
  onApprovalChange,
  onClearFilters,
  searchPlaceholder = 'Search...',
}) => {
  return (
    <div className="mb-6 space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-300 mb-3">
        <FiFilter className="text-primary" />
        <span className="font-medium">Filters</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <input
          type="text"
          placeholder={searchPlaceholder}
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="px-4 py-2 bg-dark-200 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent text-white"
        />
        <select
          value={filterStatus}
          onChange={(e) => onStatusChange(e.target.value)}
          className="px-4 py-2 bg-dark-200 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent text-white"
        >
          <option value="all">All Payment Status</option>
          <option value="PENDING">Pending</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
        </select>
        <select
          value={filterApproval}
          onChange={(e) => onApprovalChange(e.target.value)}
          className="px-4 py-2 bg-dark-200 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent text-white"
        >
          <option value="all">All Approval Status</option>
          <option value="PENDING_APPROVAL">Awaiting Approval</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <button
          onClick={onClearFilters}
          className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 transition-colors"
        >
          Clear Filters
        </button>
      </div>
    </div>
  );
};

export default FilterBar;
