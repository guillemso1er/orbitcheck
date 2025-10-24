import React from 'react';

export interface LogEntry {
  id: string;
  type: string;
  endpoint: string;
  reason_codes: string[];
  status: number;
  meta: Record<string, unknown>;
  created_at: string;
}

interface LogsTableProps {
  logs: LogEntry[];
  sortBy: 'created_at' | 'status' | 'endpoint';
  sortDir: 'asc' | 'desc';
  onSort: (column: 'created_at' | 'status' | 'endpoint') => void;
}

export const LogsTable: React.FC<LogsTableProps> = ({
  logs,
  sortBy,
  sortDir,
  onSort,
}) => (
  <div className="overflow-x-auto">
    <table className="min-w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
      <thead className="bg-gray-50 dark:bg-gray-700">
        <tr>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">ID</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Type</th>
          <th
            onClick={() => onSort('endpoint')}
            className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
          >
            Endpoint {sortBy === 'endpoint' && (sortDir === 'asc' ? '↑' : '↓')}
          </th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Reason Codes</th>
          <th
            onClick={() => onSort('status')}
            className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
          >
            Status {sortBy === 'status' && (sortDir === 'asc' ? '↑' : '↓')}
          </th>
          <th
            onClick={() => onSort('created_at')}
            className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
          >
            Created At {sortBy === 'created_at' && (sortDir === 'asc' ? '↑' : '↓')}
          </th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Meta</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
        {logs.length === 0 ? (
          <tr>
            <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">No logs found.</td>
          </tr>
        ) : (
          logs.map((log) => (
            <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
              <td className="px-4 py-4"><code className="text-sm text-gray-900 dark:text-white">{log.id}</code></td>
              <td className="px-4 py-4">
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                  log.type === 'validation'
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                    : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                }`}>
                  {log.type}
                </span>
              </td>
              <td className="px-4 py-4 text-gray-900 dark:text-white">{log.endpoint}</td>
              <td className="px-4 py-4 text-gray-900 dark:text-white">
                {log.reason_codes.length > 0 ? log.reason_codes.join(', ') : 'None'}
              </td>
              <td className="px-4 py-4">
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                  log.status >= 200 && log.status < 300
                    ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                    : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                }`}>
                  {log.status}
                </span>
              </td>
              <td className="px-4 py-4 text-gray-900 dark:text-white">{new Date(log.created_at).toLocaleString()}</td>
              <td className="px-4 py-4 text-gray-900 dark:text-white">
                <details className="cursor-pointer">
                  <summary className="text-sm hover:text-blue-600 dark:hover:text-blue-400">View Meta</summary>
                  <pre className="mt-2 text-xs bg-gray-100 dark:bg-gray-600 p-2 rounded overflow-auto">{JSON.stringify(log.meta, null, 2)}</pre>
                </details>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);