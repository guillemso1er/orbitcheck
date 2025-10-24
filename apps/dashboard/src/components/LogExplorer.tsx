import { createApiClient } from '@orbitcheck/contracts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, UI_STRINGS } from '../constants';
import { FiltersSection, type FiltersState } from './FiltersSection';
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

  const lastRequestIdRef = useRef(0);

  // Avoid state updates after unmount
  const fetchLogs = useCallback(
    async (offset: number = 0, page: number = 1, overrideFilters?: FiltersState) => {
      const requestId = ++lastRequestIdRef.current;

      setLoading(true);
      setError(null);

      try {
        const apiClient = createApiClient({ baseURL: API_BASE });

        const f = overrideFilters ?? appliedFilters;
        const params: Record<string, unknown> = { limit, offset };
        if (f.reason_code) params.reason_code = f.reason_code;
        if (f.endpoint) params.endpoint = f.endpoint;
        if (f.status) params.status = parseInt(f.status, 10);
        if (f.type) params.type = f.type;
        if (f.date_from) params.date_from = f.date_from;
        if (f.date_to) params.date_to = f.date_to;

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), 10000)
        );

        const response = await Promise.race([apiClient.getLogs(params), timeoutPromise]);

        // Only check if this is still the latest request
        if (requestId !== lastRequestIdRef.current) {
          return;
        }

        const data = response.data || response;

        const logsArray = (data as any).data || (Array.isArray(data) ? data : []);
        setLogs(logsArray.map((log: any) => ({
          ...log,
          id: log.id || '',
          type: log.type || '',
          endpoint: log.endpoint || '',
          reason_codes: log.reason_codes || [],
          status: log.status || 200,
          created_at: log.created_at || '',
          meta: log.meta || {}
        })));
        setTotalCount((data as any).total_count || 0);
        setNextCursor((data as any).next_cursor || null);
        setCurrentPage(page);
      } catch (err) {
        // Only update error state if this is still the latest request
        if (requestId !== lastRequestIdRef.current) return;

        if (err instanceof Error && err.message === 'Request timeout') {
          setError('Request timed out. Please try again.');
        } else {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        // Only set loading to false if this is still the latest request
        if (requestId === lastRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [limit, appliedFilters]
  );

  // Initial load only
  useEffect(() => {
    fetchLogs(0, 1, EMPTY_FILTERS);
  }, []);

  const handleFilterChange = useCallback((key: keyof FiltersState, value: string) => {
    setFilters(prev => {
      const next = { ...prev, [key]: value };
      setAppliedFilters(next);
      fetchLogs(0, 1, next);
      return next;
    });
  }, [fetchLogs]);

  const handleApplyFilters = useCallback(() => {
    setAppliedFilters(prev => {
      // Use current `filters` snapshot
      fetchLogs(0, 1, filters);
      return filters;
    });
  }, [filters, fetchLogs]);

  const handleClearFilters = useCallback(() => {
    const cleared = { ...EMPTY_FILTERS };
    setFilters(cleared);
    setAppliedFilters(cleared);
    fetchLogs(0, 1, cleared);
  }, [fetchLogs]);

  const handleSort = useCallback((column: 'created_at' | 'status' | 'endpoint') => {
    setSortBy(prev => {
      if (prev === column) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('desc');
      return column;
    });
    fetchLogs(0, 1, appliedFilters);
  }, [appliedFilters, fetchLogs]);


  const computedTotalPages = Math.max(1, Math.ceil(totalCount / limit));
  const effectiveTotalPages = nextCursor ? Math.max(computedTotalPages, currentPage + 1) : computedTotalPages;

  const handleNextPage = useCallback(() => {
    const offset = currentPage * limit; // 1 -> 50
    fetchLogs(offset, currentPage + 1, appliedFilters);
  }, [currentPage, limit, appliedFilters, fetchLogs]);

  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) {
      const offset = Math.max(0, (currentPage - 2) * limit);
      fetchLogs(offset, currentPage - 1, appliedFilters);
    }
  }, [currentPage, limit, appliedFilters, fetchLogs]);

  const goToPage = useCallback((page: number) => {
    if (page >= 1) {
      const offset = (page - 1) * limit;
      fetchLogs(offset, page, appliedFilters);
    }
  }, [limit, appliedFilters, fetchLogs]);

  const handleRefresh = useCallback(() => {
    fetchLogs(0, 1, appliedFilters);
  }, [appliedFilters, fetchLogs]);

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
    <div id="log-explorer" className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
      <header className="flex justify-between items-center mb-6 flex-wrap gap-4">
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{UI_STRINGS.LOG_EXPLORER}</h2>
          <p className="mt-1 text-gray-600 dark:text-gray-400 text-sm">
            Browse and filter your API request logs. Use filters to find specific requests and export data for analysis.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleRefresh} className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500" aria-label="Refresh">
            <span role="img" aria-label="refresh">🔄</span> Refresh
          </button>
          <button onClick={exportToCSV} className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500">
            <span>📊</span> {UI_STRINGS.EXPORT_CSV}
          </button>
        </div>
      </header>

      {loading && logs.length === 0 && !error && (
        <div role="status" className="text-center py-8 text-gray-600 dark:text-gray-400">
          {UI_STRINGS.LOADING} logs...
        </div>
      )}

      {/* Show no logs message only when not loading and truly no data */}
      {!loading && logs.length === 0 && !error && (
        <div role="status" className="text-center py-8 text-gray-600 dark:text-gray-400">
          No logs found.
        </div>
      )}

      {/* Show error if there's an error */}
      {error && (
        <div role="alert" className="text-center py-8 text-red-600 dark:text-red-400">
          Error: {error}
        </div>
      )}

      {/* Only show the table when we have data or after initial load */}
      {(logs.length > 0 || !loading) && (
        <>
          <FiltersSection
            filters={filters}
            onFilterChange={handleFilterChange}
            onApplyFilters={handleApplyFilters}
            onClearFilters={handleClearFilters}
          />
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm overflow-hidden">
            <div className="flex justify-between items-center p-4 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 flex-wrap gap-4">
              <div className="flex flex-col gap-1 text-gray-600 dark:text-gray-400">
                <p className="text-gray-900 dark:text-white">{UI_STRINGS.TOTAL_LOGS}: <strong className="text-gray-900 dark:text-white">{totalCount.toLocaleString()}</strong></p>
                <p className="text-gray-900 dark:text-white">{pageStart}-{pageEnd} of {totalCount}</p>
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
        </>
      )}
    </div>
  );
};

export default LogExplorer;