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