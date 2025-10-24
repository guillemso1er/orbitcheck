import React from 'react';

export interface FiltersState {
  reason_code: string;
  endpoint: string;
  status: string;
  type: string;
  date_from: string;
  date_to: string;
}

interface FiltersSectionProps {
  filters: FiltersState;
  onFilterChange: (key: keyof FiltersState, value: string) => void;
  onApplyFilters: (filters: FiltersState) => void;
  onClearFilters: () => void;
}

export const FiltersSection: React.FC<FiltersSectionProps> = ({
  filters,
  onFilterChange,
  onApplyFilters,
  onClearFilters,
}) => (
  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
    <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Filters</h3>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
      <div>
        <label htmlFor="reason-code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason Code</label>
        <input
          id="reason-code"
          type="text"
          placeholder="Enter reason code"
          value={filters.reason_code}
          onChange={(e) => onFilterChange('reason_code', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
      </div>
      <div>
        <label htmlFor="endpoint" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Endpoint</label>
        <input
          id="endpoint"
          type="text"
          placeholder="Enter endpoint"
          value={filters.endpoint}
          onChange={(e) => onFilterChange('endpoint', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
      </div>
      <div>
        <label htmlFor="status" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
        <input
          id="status"
          type="number"
          placeholder="Enter status code"
          value={filters.status}
          onChange={(e) => onFilterChange('status', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
      </div>
      <div>
        <label htmlFor="type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
        <select
          id="type"
          value={filters.type}
          onChange={(e) => onFilterChange('type', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        >
          <option value="">All Types</option>
          <option value="validation">Validation</option>
          <option value="order">Order</option>
        </select>
      </div>
      <div>
        <label htmlFor="date-from" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date From</label>
        <input
          id="date-from"
          type="date"
          value={filters.date_from}
          onChange={(e) => onFilterChange('date_from', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
      </div>
      <div>
        <label htmlFor="date-to" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date To</label>
        <input
          id="date-to"
          type="date"
          value={filters.date_to}
          onChange={(e) => onFilterChange('date_to', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
      </div>
    </div>
    <div className="flex gap-2">
      <button
        onClick={() => onApplyFilters(filters)}
        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
      >
        Apply Filters
      </button>
      <button
        onClick={onClearFilters}
        className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
      >
        Clear Filters
      </button>
    </div>
  </div>
);