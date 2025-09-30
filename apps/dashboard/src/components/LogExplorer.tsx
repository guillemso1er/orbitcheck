import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';

interface LogEntry {
  id: string;
  type: string;
  endpoint: string;
  reason_codes: string[];
  status: number;
  meta: Record<string, unknown>;
  created_at: string;
}

interface LogsResponse {
  data: LogEntry[];
  next_cursor: string | null;
  total_count: number;
}

interface LogExplorerProps {
  token: string;
}

interface FiltersState {
  reason_code: string;
  endpoint: string;
  status: string;
  type: string;
  date_from: string;
  date_to: string;
}

const FiltersSection: React.FC<{
  filters: FiltersState;
  onFilterChange: (key: keyof FiltersState, value: string) => void;
  onApplyFilters: (filters: FiltersState) => void;
  onClearFilters: () => void;
}> = ({ filters, onFilterChange, onApplyFilters, onClearFilters }) => (
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
        <button onClick={() => onApplyFilters(filters)} className="btn btn-primary">Apply Filters</button>
        <button onClick={onClearFilters} className="btn btn-secondary">Clear Filters</button>
      </div>
    </div>
  </div>
);

const PaginationControls: React.FC<{
  currentPage: number;
  totalPages: number;
  nextCursor: string | null;
  onPrevPage: () => void;
  onNextPage: () => void;
  onGoToPage: (page: number) => void;
  limit: number;
}> = ({ currentPage, totalPages, nextCursor, onPrevPage, onNextPage, onGoToPage, limit }) => (
  <div className="pagination-controls">
    <button onClick={onPrevPage} disabled={currentPage === 1} className="btn btn-secondary">
      Previous
    </button>
    <div className="page-numbers">
      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
        const pageNum = currentPage <= 3 ? i + 1 : totalPages - 4 + i + 1;
        return (
          <button
            key={pageNum}
            onClick={() => onGoToPage(pageNum)}
            className={`btn ${pageNum === currentPage ? 'btn-primary' : 'btn-outline-primary'}`}
          >
            {pageNum}
          </button>
        );
      })}
      {totalPages > 5 && (
        <>
          <span>...</span>
          <button onClick={() => onGoToPage(totalPages)} className="btn btn-outline-primary">
            {totalPages}
          </button>
        </>
      )}
    </div>
    <button onClick={onNextPage} disabled={currentPage === totalPages || !nextCursor} className="btn btn-secondary">
      Next
    </button>
  </div>
);

const LogsTable: React.FC<{
  logs: LogEntry[];
  sortBy: 'created_at' | 'status' | 'endpoint';
  sortDir: 'asc' | 'desc';
  onSort: (column: 'created_at' | 'status' | 'endpoint') => void;
}> = ({ logs, sortBy, sortDir, onSort }) => (
  <div className="table-container">
    <table className="table table-striped">
      <thead>
        <tr>
          <th>ID</th>
          <th>Type</th>
          <th
            onClick={() => onSort('endpoint')}
            className="sortable"
            style={{ cursor: 'pointer' }}
          >
            Endpoint {sortBy === 'endpoint' && (sortDir === 'asc' ? '↑' : '↓')}
          </th>
          <th>Reason Codes</th>
          <th
            onClick={() => onSort('status')}
            className="sortable"
            style={{ cursor: 'pointer' }}
          >
            Status {sortBy === 'status' && (sortDir === 'asc' ? '↑' : '↓')}
          </th>
          <th
            onClick={() => onSort('created_at')}
            className="sortable"
            style={{ cursor: 'pointer' }}
          >
            Created At {sortBy === 'created_at' && (sortDir === 'asc' ? '↑' : '↓')}
          </th>
          <th>Meta</th>
        </tr>
      </thead>
      <tbody>
        {logs.length === 0 ? (
          <tr>
            <td colSpan={7} className="text-center">No logs found.</td>
          </tr>
        ) : (
          logs.map((log) => (
            <tr key={log.id}>
              <td><code>{log.id}</code></td>
              <td>
                <span className={`badge badge-${log.type === 'validation' ? 'info' : 'warning'}`}>
                  {log.type}
                </span>
              </td>
              <td>{log.endpoint}</td>
              <td>
                {log.reason_codes.length > 0 ? (
                  <span className="reason-codes">{log.reason_codes.join(', ')}</span>
                ) : 'None'}
              </td>
              <td>
                <span className={`badge badge-${log.status >= 200 && log.status < 300 ? 'success' : 'danger'}`}>
                  {log.status}
                </span>
              </td>
              <td>{new Date(log.created_at).toLocaleString()}</td>
              <td>
                <details>
                  <summary>View Meta</summary>
                  <pre>{JSON.stringify(log.meta, null, 2)}</pre>
                </details>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

const LogExplorer: React.FC<LogExplorerProps> = ({ token }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FiltersState>({
    reason_code: '',
    endpoint: '',
    status: '',
    type: '',
    date_from: '',
    date_to: ''
  });
  const [appliedFilters, setAppliedFilters] = useState<FiltersState>({
    reason_code: '',
    endpoint: '',
    status: '',
    type: '',
    date_from: '',
    date_to: ''
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [limit] = useState(50);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'created_at' | 'status' | 'endpoint'>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const fetchLogs = useCallback(async (offset: number = 0, page: number = 1) => {
    try {
      setLoading(true);
      const paramsObj: Record<string, string> = {
        limit: String(limit),
        offset: String(offset),
        sort_by: sortBy,
        sort_dir: sortDir,
      };
      if (appliedFilters.reason_code) paramsObj.reason_code = appliedFilters.reason_code;
      if (appliedFilters.endpoint) paramsObj.endpoint = appliedFilters.endpoint;
      if (appliedFilters.status) paramsObj.status = appliedFilters.status;
      if (appliedFilters.type) paramsObj.type = appliedFilters.type;
      if (appliedFilters.date_from) paramsObj.date_from = appliedFilters.date_from;
      if (appliedFilters.date_to) paramsObj.date_to = appliedFilters.date_to;
      const params = new URLSearchParams(paramsObj);
      const response = await fetch(`/api/logs?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error('Failed to fetch logs');
      }
      const data: LogsResponse = await response.json();
      setLogs(data.data);
      setTotalCount(data.total_count);
      setNextCursor(data.next_cursor);
      setCurrentPage(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [token, appliedFilters, sortBy, sortDir, limit]);

  useEffect(() => {
    fetchLogs(0, 1);
  }, [appliedFilters, sortBy, sortDir, fetchLogs]);

  const handleFilterChange = (key: keyof FiltersState, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleApplyFilters = () => {
    setAppliedFilters(filters);
    fetchLogs(0, 1);
  };

  const handleClearFilters = () => {
    const emptyFilters: FiltersState = {
      reason_code: '',
      endpoint: '',
      status: '',
      type: '',
      date_from: '',
      date_to: ''
    };
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    fetchLogs(0, 1);
  };

  const handleSort = (column: 'created_at' | 'status' | 'endpoint') => {
    if (sortBy === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDir('desc');
    }
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(totalCount / limit);

  const handleNextPage = () => {
    if (nextCursor) {
      const nextOffset = parseInt(nextCursor);
      fetchLogs(nextOffset, currentPage + 1);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      const prevOffset = Math.max(0, (currentPage - 2) * limit);
      fetchLogs(prevOffset, currentPage - 1);
    }
  };

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      const offset = (page - 1) * limit;
      fetchLogs(offset, page);
    }
  };

  const exportToCSV = () => {
    const headers = ['ID', 'Type', 'Endpoint', 'Reason Codes', 'Status', 'Created At', 'Meta'];
    const csvContent = [
      headers.join(','),
      ...logs.map(log => [
        log.id,
        log.type,
        log.endpoint,
        JSON.stringify(log.reason_codes),
        log.status,
        log.created_at,
        JSON.stringify(log.meta)
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orbicheck-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (loading) return <div className="loading">Loading logs...</div>;
  if (error) return <div className="alert alert-danger">Error: {error}</div>;

  return (
    <div className="log-explorer">
      <header className="page-header">
        <h2>Log Explorer</h2>
        <div className="header-actions">
          <button onClick={exportToCSV} className="btn btn-success">
            <span className="btn-icon">📊</span> Export CSV
          </button>
        </div>
      </header>

      <FiltersSection
        filters={filters}
        onFilterChange={handleFilterChange}
        onApplyFilters={handleApplyFilters}
        onClearFilters={handleClearFilters}
      />

      <div className="table-section">
        <div className="table-header">
          <div className="table-info">
            <p>Total Logs: <strong>{totalCount.toLocaleString()}</strong></p>
            <p>Showing {logs.length} of {totalCount} logs</p>
          </div>
          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            nextCursor={nextCursor}
            onPrevPage={handlePrevPage}
            onNextPage={handleNextPage}
            onGoToPage={goToPage}
            limit={limit}
          />
        </div>

        <LogsTable
          logs={logs}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
        />
      </div>

      <style>{`
        .log-explorer {
          max-width: 1200px;
          margin: 0 auto;
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--spacing-lg);
          flex-wrap: wrap;
          gap: var(--spacing-md);
        }
        .header-actions {
          display: flex;
          gap: var(--spacing-sm);
        }
        .filters-section {
          margin-bottom: var(--spacing-xl);
        }
        .filters-card {
          background: var(--bg-secondary);
          padding: var(--spacing-lg);
          border-radius: var(--border-radius-lg);
          border: 1px solid var(--border-color);
        }
        .filters-card h3 {
          margin-top: 0;
          margin-bottom: var(--spacing-md);
        }
        .filter-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: var(--spacing-md);
          margin-bottom: var(--spacing-lg);
        }
        .form-group {
          display: flex;
          flex-direction: column;
        }
        .form-group label {
          margin-bottom: var(--spacing-xs);
          font-weight: 500;
          color: var(--text-primary);
        }
        .filter-actions {
          display: flex;
          gap: var(--spacing-sm);
          justify-content: flex-end;
        }
        .table-section {
          background: var(--bg-primary);
          border-radius: var(--border-radius-lg);
          border: 1px solid var(--border-color);
          overflow: hidden;
          box-shadow: var(--shadow-sm);
        }
        .table-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--spacing-md);
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-color);
          flex-wrap: wrap;
          gap: var(--spacing-sm);
        }
        .table-info {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-xs);
          color: var(--text-secondary);
        }
        .pagination-controls {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
        }
        .page-numbers {
          display: flex;
          gap: var(--spacing-xs);
        }
        .page-numbers .btn {
          min-width: 40px;
          height: 40px;
          padding: 0 var(--spacing-sm);
        }
        .table-container {
          overflow-x: auto;
        }
        .table {
          width: 100%;
          margin: 0;
          border-collapse: collapse;
        }
        .table th,
        .table td {
          padding: var(--spacing-md);
          text-align: left;
          border-bottom: 1px solid var(--border-color);
          vertical-align: top;
        }
        .table th {
          background: var(--bg-secondary);
          font-weight: 600;
          color: var(--text-primary);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .sortable:hover {
          background-color: var(--bg-tertiary);
        }
        .table-striped tbody tr:nth-of-type(odd) {
          background-color: var(--bg-tertiary);
        }
        .table tbody tr:hover {
          background-color: var(--bg-secondary);
        }
        .text-center {
          text-align: center;
        }
        .badge {
          padding: var(--spacing-xs) var(--spacing-sm);
          border-radius: 0.25rem;
          font-size: 0.75em;
          font-weight: 500;
          text-transform: uppercase;
        }
        .badge-success {
          background-color: #28a745;
          color: white;
        }
        .badge-danger {
          background-color: #dc3545;
          color: white;
        }
        .badge-info {
          background-color: #17a2b8;
          color: white;
        }
        .badge-warning {
          background-color: #ffc107;
          color: #212529;
        }
        .reason-codes {
          font-family: monospace;
          font-size: 0.875em;
          background: var(--bg-tertiary);
          padding: var(--spacing-xs) var(--spacing-sm);
          border-radius: var(--border-radius);
          display: inline-block;
        }
        details {
          cursor: pointer;
        }
        summary {
          font-weight: 500;
          color: #007bff;
        }
        pre {
          background: var(--bg-tertiary);
          padding: var(--spacing-sm);
          border-radius: var(--border-radius);
          font-size: 0.875em;
          overflow-x: auto;
          white-space: pre-wrap;
          margin: var(--spacing-sm) 0 0 0;
        }
        .loading {
          text-align: center;
          padding: var(--spacing-xl);
          color: var(--text-secondary);
        }
        .alert {
          padding: var(--spacing-md);
          border-radius: var(--border-radius);
          border: 1px solid;
          margin: var(--spacing-lg) 0;
        }
        .alert-danger {
          background-color: #f8d7da;
          border-color: #f5c6cb;
          color: #721c24;
        }
        @media (max-width: 768px) {
          .filter-row {
            grid-template-columns: 1fr;
          }
          .table-header {
            flex-direction: column;
            align-items: stretch;
          }
          .pagination-controls {
            justify-content: center;
          }
          .table th,
          .table td {
            padding: var(--spacing-sm);
            font-size: 0.875rem;
          }
        }
      `}</style>
    </div>
  );
};

export default LogExplorer;