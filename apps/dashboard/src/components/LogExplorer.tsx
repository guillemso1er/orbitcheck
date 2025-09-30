import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { FiltersSection, type FiltersState } from './FiltersSection';
import { PaginationControls } from './PaginationControls';
import { LogsTable, type LogEntry } from './LogsTable';
import './LogExplorer.css';

interface LogsResponse {
  data: LogEntry[];
  next_cursor: string | null;
  total_count: number;
}

interface LogExplorerProps {
  token: string;
}

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
    </div>
  );
};

export default LogExplorer;