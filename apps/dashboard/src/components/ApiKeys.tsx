import React, { useState, useEffect, useCallback } from 'react';
import { API_ENDPOINTS, UI_STRINGS, ERROR_MESSAGES, HTTP_STATUS } from '../constants';
import { useAuth } from '../AuthContext';

interface ApiKey {
  id: string;
  prefix: string;
  name?: string;
  status: 'active' | 'revoked';
  created_at: string;
  last_used_at?: string;
}

interface ApiKeysProps {
  token: string;
}

const CreateApiKeyModal: React.FC<{
  show: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  creating: boolean;
}> = ({ show, onClose, onCreate, creating }) => {
  const [newKeyName, setNewKeyName] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    await onCreate(newKeyName);
    setNewKeyName('');
  };

  if (!show) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Create New API Key</h3>
          <button className="btn-close" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label htmlFor="key-name">Name (optional)</label>
            <input
              id="key-name"
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g., Production API"
            />
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const NewKeyAlert: React.FC<{
  newKey: { prefix: string; full_key: string } | null;
  onClose: () => void;
}> = ({ newKey, onClose }) => {
  if (!newKey) return null;

  return (
    <div className="alert alert-success">
      <h4>{UI_STRINGS.NEW_KEY_CREATED}</h4>
      <div className="key-details">
        <p><strong>Prefix:</strong> <code>{newKey.prefix}</code></p>
        <p><strong>Full Key:</strong> <code>{newKey.full_key}</code></p>
        <p className="alert-text">{UI_STRINGS.SAVE_SECURELY}</p>
      </div>
      <button onClick={onClose} className="btn btn-secondary">Close</button>
    </div>
  );
};

const ApiKeysTable: React.FC<{
  keys: ApiKey[];
  onRevoke: (id: string) => void;
  onRotate: (key: ApiKey) => void;
  creating: boolean;
}> = ({ keys, onRevoke, onRotate, creating }) => (
  <div className="table-container">
    <table className="table table-striped">
      <thead>
        <tr>
          <th>Name</th>
          <th>Prefix</th>
          <th>Status</th>
          <th>Created</th>
          <th>Last Used</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => (
          <tr key={key.id}>
            <td>{key.name || 'Unnamed'}</td>
            <td><code>{key.prefix}</code></td>
            <td>
              <span className={`badge badge-${key.status === 'active' ? 'success' : 'danger'}`}>
                {key.status.toUpperCase()}
              </span>
            </td>
            <td>{new Date(key.created_at).toLocaleDateString()}</td>
            <td>{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}</td>
            <td>
              {key.status === 'active' && (
                <div className="action-buttons">
                  <button onClick={() => onRotate(key)} className="btn btn-warning btn-sm" title="Rotate Key" disabled={creating}>
                    {creating ? UI_STRINGS.ROTATING : UI_STRINGS.ROTATE}
                  </button>
                  <button onClick={() => onRevoke(key.id)} className="btn btn-danger btn-sm" title="Revoke Key">
                    {UI_STRINGS.REVOKE}
                  </button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const ApiKeys: React.FC<ApiKeysProps> = ({ token }) => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<{ prefix: string; full_key: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      if (!token) {
        setLoading(false);
        return;
      }
      const response = await fetch(API_ENDPOINTS.API_KEYS, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error(ERROR_MESSAGES.FETCH_API_KEYS);
      }
      const data = await response.json();
      setKeys(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async (name: string) => {
    try {
      setCreating(true);
      const response = await fetch(API_ENDPOINTS.API_KEYS, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name })
      });
      if (!response.ok) {
        throw new Error(ERROR_MESSAGES.CREATE_API_KEY);
      }
      const data = await response.json();
      setNewKey({ prefix: data.prefix, full_key: data.full_key });
      setShowCreate(false);
      fetchKeys(); // Refresh list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) return;
    try {
      const response = await fetch(`${API_ENDPOINTS.API_KEYS}/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error(ERROR_MESSAGES.REVOKE_API_KEY);
      }
      fetchKeys(); // Refresh list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleRotate = async (key: ApiKey) => {
    const name = key.name || '';
    const message = name ? `Rotate this key? This will create a new key with the name "${name}" and revoke the old one.` : 'Rotate this key? This will create a new key and revoke the old one.';
    if (!confirm(message)) return;
    try {
      setCreating(true);
      // Create new key with same name
      const createResponse = await fetch(API_ENDPOINTS.API_KEYS, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name })
      });
      if (!createResponse.ok) {
        throw new Error(ERROR_MESSAGES.CREATE_API_KEY);
      }
      const newData = await createResponse.json();
      // Revoke old key
      const revokeResponse = await fetch(`${API_ENDPOINTS.API_KEYS}/${key.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!revokeResponse.ok) {
        throw new Error(ERROR_MESSAGES.REVOKE_API_KEY);
      }
      // Show new key
      setNewKey({ prefix: newData.prefix, full_key: newData.full_key });
      fetchKeys(); // Refresh list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="loading">{UI_STRINGS.LOADING} API keys...</div>;
  if (error) return <div className="alert alert-danger">Error: {error}</div>;

  return (
    <div className="api-keys-page">
      <header className="page-header">
        <h2>{UI_STRINGS.API_KEYS_MANAGEMENT}</h2>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary">
          <span className="btn-icon">+</span> {UI_STRINGS.CREATE_NEW_API_KEY}
        </button>
      </header>

      <CreateApiKeyModal
        show={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
        creating={creating}
      />

      <NewKeyAlert newKey={newKey} onClose={() => setNewKey(null)} />

      <div className="keys-list">
        <h3>{UI_STRINGS.YOUR_API_KEYS}</h3>
        {keys.length === 0 ? (
          <div className="empty-state">
            <p>{UI_STRINGS.NO_API_KEYS}</p>
          </div>
        ) : (
          <ApiKeysTable
            keys={keys}
            onRevoke={handleRevoke}
            onRotate={handleRotate}
            creating={creating}
          />
        )}
      </div>

      <style>{`
        .api-keys-page {
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
        .page-header h2 {
          margin: 0;
        }
        .btn-icon {
          margin-right: var(--spacing-xs);
        }
        .loading {
          text-align: center;
          padding: var(--spacing-lg);
          color: var(--text-secondary);
        }
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .modal {
          background: var(--bg-primary);
          border-radius: var(--border-radius-lg);
          box-shadow: var(--shadow-md);
          width: 90%;
          max-width: 500px;
          max-height: 90vh;
          overflow-y: auto;
          border: 1px solid var(--border-color);
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--spacing-md);
          border-bottom: 1px solid var(--border-color);
        }
        .modal-header h3 {
          margin: 0;
        }
        .btn-close {
          background: none;
          border: none;
          font-size: 1.5rem;
          cursor: pointer;
          color: var(--text-secondary);
          padding: 0;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .btn-close:hover {
          color: var(--text-primary);
        }
        .modal-body {
          padding: var(--spacing-md);
        }
        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: var(--spacing-sm);
          margin-top: var(--spacing-md);
        }
        .alert {
          padding: var(--spacing-md);
          border-radius: var(--border-radius);
          border: 1px solid;
          margin-bottom: var(--spacing-lg);
        }
        .alert-success {
          background-color: #d4edda;
          border-color: #c3e6cb;
          color: #155724;
        }
        .alert-danger {
          background-color: #f8d7da;
          border-color: #f5c6cb;
          color: #721c24;
        }
        .key-details {
          margin: var(--spacing-md) 0;
        }
        .key-details code {
          background: var(--bg-secondary);
          padding: var(--spacing-xs) var(--spacing-sm);
          border-radius: var(--border-radius);
          font-family: monospace;
          word-break: break-all;
        }
        .alert-text {
          font-size: 0.875rem;
          font-style: italic;
          margin-top: var(--spacing-sm);
        }
        .empty-state {
          text-align: center;
          padding: var(--spacing-lg);
          color: var(--text-secondary);
          border: 2px dashed var(--border-color);
          border-radius: var(--border-radius);
        }
        .table-container {
          overflow-x: auto;
          border-radius: var(--border-radius);
          box-shadow: var(--shadow-sm);
        }
        .table {
          margin: 0;
        }
        .table-striped tbody tr:nth-of-type(odd) {
          background-color: rgba(0, 0, 0, 0.02);
        }
        .table code {
          font-size: 0.875em;
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
        .action-buttons {
          display: flex;
          gap: var(--spacing-xs);
        }
        .btn-sm {
          padding: 0.25rem 0.5rem;
          font-size: 0.875rem;
        }
        @media (max-width: 768px) {
          .page-header {
            flex-direction: column;
            align-items: stretch;
          }
          .action-buttons {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
};

export default ApiKeys;