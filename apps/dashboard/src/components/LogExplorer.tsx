import React, { useState, useEffect, useCallback } from 'react';
import { UI_STRINGS } from '../constants';
import { useAuth } from '../AuthContext';
import { createApiClient } from '@orbicheck/contracts';
import { FiltersSection, type FiltersState } from './FiltersSection';
import { PaginationControls } from './PaginationControls';
import { LogsTable, type LogEntry } from './LogsTable';
import './LogExplorer.css';


const LogExplorer: React.FC = () => {
  const { token } = useAuth();
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
      const apiClient = createApiClient({
        baseURL: '', // Use relative path since we're proxying
        token: token || ''
      });
      
      const params = {
        limit,
        offset,
        reason_code: appliedFilters.reason_code,
        endpoint: appliedFilters.endpoint,
        status: appliedFilters.status ? parseInt(appliedFilters.status) : undefined,
      };
      
      const data = await apiClient.getLogs(params);
      setLogs((data.data || []).map(log => ({
        ...log,
        id: log.id || '',
        type: log.type || '',
        endpoint: log.endpoint || '',
        reason_codes: log.reason_codes || [],
        status: log.status || 200,
        created_at: log.created_at || '',
        meta: log.meta || {}
      })));
      setTotalCount(data.total_count || 0);
      setNextCursor(data.next_cursor || null);
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

  if (loading) return <div className="loading">{UI_STRINGS.LOADING} logs...</div>;
  if (error) return <div className="alert alert-danger">Error: {error}</div>;

  return (
    <div className="log-explorer">
      <header className="page-header">
        <h2>{UI_STRINGS.LOG_EXPLORER}</h2>
        <div className="header-actions">
          <button onClick={exportToCSV} className="btn btn-success">
            <span className="btn-icon">📊</span> {UI_STRINGS.EXPORT_CSV}
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
            <p>{UI_STRINGS.TOTAL_LOGS}: <strong>{totalCount.toLocaleString()}</strong></p>
            <p>{UI_STRINGS.SHOWING_LOGS.replace('{logsLength}', logs.length.toString()).replace('{totalCount}', totalCount.toString())}</p>
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