import { createApiClient } from '@orbitcheck/contracts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, UI_STRINGS } from '../constants';
import { FiltersSection, type FiltersState } from './FiltersSection';
import './LogExplorer.css';
import { LogsTable, type LogEntry } from './LogsTable';
import { PaginationControls } from './PaginationControls';

const EMPTY_FILTERS: FiltersState = {
  reason_code: '',
  endpoint: '',
  status: '',
  type: '',
  date_from: '',
  date_to: ''
};

const LogExplorer: React.FC = () => {

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<FiltersState>({ ...EMPTY_FILTERS });
  const [appliedFilters, setAppliedFilters] = useState<FiltersState>({ ...EMPTY_FILTERS });

  const [currentPage, setCurrentPage] = useState(1);
  const [limit] = useState(50);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<'created_at' | 'status' | 'endpoint'>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Avoid state updates after unmount
  const isMounted = useRef(true);
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Single source of fetching; accept an override filters object to avoid stale closure issues
  const fetchLogs = useCallback(
    async (offset: number = 0, page: number = 1, overrideFilters?: FiltersState) => {
      setLoading(true);
      setError(null);

      try {
        const apiClient = createApiClient({
          baseURL: API_BASE
        });

        const f = overrideFilters ?? appliedFilters;

        const params: Record<string, unknown> = { limit, offset };
        if (f.reason_code) params.reason_code = f.reason_code;
        if (f.endpoint) params.endpoint = f.endpoint;
        if (f.status) params.status = parseInt(f.status, 10);
        if (f.type) params.type = f.type;
        if (f.date_from) params.date_from = f.date_from;
        if (f.date_to) params.date_to = f.date_to;

        const data = await apiClient.getLogs(params);

        if (!isMounted.current) return;

        setLogs((data.data || []).map((log: any) => ({
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
        if (!isMounted.current) return;
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!isMounted.current) return;
        setLoading(false);
      }
    },
    // only depend on limit so the function stays stable; we always pass overrides when needed
    [limit]
  );

  // Initial load only
  useEffect(() => {
    fetchLogs(0, 1, appliedFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilterChange = (key: keyof FiltersState, value: string) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    setAppliedFilters(next);
    // Immediately fetch with the latest values so tests see the filter in the last call
    fetchLogs(0, 1, next);
  };

  const handleApplyFilters = () => {
    setAppliedFilters(filters);
    fetchLogs(0, 1, filters);
  };

  const handleClearFilters = () => {
    setFilters({ ...EMPTY_FILTERS });
    setAppliedFilters({ ...EMPTY_FILTERS });
    fetchLogs(0, 1, EMPTY_FILTERS);
  };

  const handleSort = (column: 'created_at' | 'status' | 'endpoint') => {
    if (sortBy === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDir('desc');
    }
    // Re-fetch with current filters, reset to first page
    fetchLogs(0, 1, appliedFilters);
  };

  // Real pages based on totalCount
  const computedTotalPages = Math.max(1, Math.ceil(totalCount / limit));
  // If the server gives us a nextCursor, expose at least one extra page so "Next" isn't disabled
  const effectiveTotalPages = nextCursor ? Math.max(computedTotalPages, currentPage + 1) : computedTotalPages;

  const handleNextPage = () => {
    const offset = currentPage * limit; // 1 -> 50
    fetchLogs(offset, currentPage + 1, appliedFilters);
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      const offset = Math.max(0, (currentPage - 2) * limit);
      fetchLogs(offset, currentPage - 1, appliedFilters);
    }
  };

  const goToPage = (page: number) => {
    if (page >= 1) {
      const offset = (page - 1) * limit;
      fetchLogs(offset, page, appliedFilters);
    }
  };

  const handleRefresh = () => {
    fetchLogs(0, 1, appliedFilters);
  };

  const exportToCSV = () => {
    const headers = ['ID', 'Type', 'Endpoint', 'Reason Codes', 'Status', 'Created At', 'Meta'];
    const csvContent = [
      headers.join(','),
      ...logs.map(log =>
        [
          log.id,
          log.type,
          log.endpoint,
          JSON.stringify(log.reason_codes),
          log.status,
          log.created_at,
          JSON.stringify(log.meta)
        ].join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orbitcheck-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const pageStart = totalCount === 0 ? 0 : (currentPage - 1) * limit + 1;
  const pageEnd = totalCount === 0 ? 0 : (currentPage - 1) * limit + logs.length;

  return (
    <div className="log-explorer">
      <header className="page-header">
        <h2>{UI_STRINGS.LOG_EXPLORER}</h2>
        <div className="header-actions">
          <button onClick={handleRefresh} className="btn btn-secondary" aria-label="Refresh">
            <span role="img" aria-label="refresh">🔄</span> Refresh
          </button>
          <button onClick={exportToCSV} className="btn btn-success">
            <span className="btn-icon">📊</span> {UI_STRINGS.EXPORT_CSV}
          </button>
        </div>
      </header>

      {loading && (
        <div role="status" className="loading">
          {UI_STRINGS.LOADING} logs...
        </div>
      )}

      {error && (
        <div role="alert" className="alert alert-danger">Error: {error}</div>
      )}

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
            <p>{pageStart}-{pageEnd} of {totalCount}</p>
          </div>
          <PaginationControls
            currentPage={currentPage}
            totalPages={effectiveTotalPages}
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