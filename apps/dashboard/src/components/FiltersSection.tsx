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
  <div className="filters-section">
    <div className="filters-card">
      <h3>Filters</h3>
      <div className="filter-row">
        <div className="form-group">
          <label htmlFor="reason-code">Reason Code</label>
          <input
            id="reason-code"
            type="text"
            placeholder="Enter reason code"
            value={filters.reason_code}
            onChange={(e) => onFilterChange('reason_code', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="endpoint">Endpoint</label>
          <input
            id="endpoint"
            type="text"
            placeholder="Enter endpoint"
            value={filters.endpoint}
            onChange={(e) => onFilterChange('endpoint', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="status">Status</label>
          <input
            id="status"
            type="number"
            placeholder="Enter status code"
            value={filters.status}
            onChange={(e) => onFilterChange('status', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="type">Type</label>
          <select
            id="type"
            value={filters.type}
            onChange={(e) => onFilterChange('type', e.target.value)}
          >
            <option value="">All Types</option>
            <option value="validation">Validation</option>
            <option value="order">Order</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="date-from">Date From</label>
          <input
            id="date-from"
            type="date"
            value={filters.date_from}
            onChange={(e) => onFilterChange('date_from', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="date-to">Date To</label>
          <input
            id="date-to"
            type="date"
            value={filters.date_to}
            onChange={(e) => onFilterChange('date_to', e.target.value)}
          />
        </div>
      </div>
      <div className="filter-actions">
        <button onClick={() => onApplyFilters(filters)} className="btn btn-primary">
          Apply Filters
        </button>
        <button onClick={onClearFilters} className="btn btn-secondary">
          Clear Filters
        </button>
      </div>
    </div>
  </div>
);