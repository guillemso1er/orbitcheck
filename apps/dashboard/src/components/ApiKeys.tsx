import { createApiClient } from '@orbitcheck/contracts';
import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE, UI_STRINGS } from '../constants';

interface ApiKey {
  id?: string;
  prefix?: string;
  name?: string;
  status?: 'active' | 'revoked' | string;
  created_at?: string | null;
  last_used_at?: string | null;
}

interface ApiKeysProps {
  token?: string;
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md m-4 border border-gray-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">Create New API Key</h3>
          <button className="text-gray-500 hover:text-gray-800 text-2xl font-bold" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="p-4">
            <div className="mb-4">
              <label htmlFor="key-name" className="block text-sm font-medium text-gray-700 mb-1">Name (optional)</label>
              <input
                id="key-name"
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Production API"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 p-4 bg-gray-50 border-t border-gray-200 rounded-b-lg">
            <button type="button" className="py-2 px-4 bg-white text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500" onClick={onClose}>
              Cancel
            </button>
            <button id="modal-submit-btn" type="submit" className="py-2 px-4 bg-indigo-600 text-white rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500" disabled={creating}>
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const NewKeyAlert: React.FC<{
  newKey: { prefix?: string; full_key?: string } | null;
  onClose: () => void;
}> = ({ newKey, onClose }) => {
  if (!newKey) return null;

  return (
    <div id="alert-success" className="p-4 mb-4 bg-green-100 border-l-4 border-green-500 text-green-700 rounded-r-lg" role="alert">
      <h4 className="font-bold text-lg mb-2">{UI_STRINGS.NEW_KEY_CREATED}</h4>
      <div className="my-2 space-y-2">
        <p><strong>Prefix:</strong> <code className="bg-green-200 text-green-900 px-2 py-1 rounded font-mono">{newKey.prefix || ''}</code></p>
        <p><strong>Full Key:</strong> <code className="bg-green-200 text-green-900 px-2 py-1 rounded font-mono break-all">{newKey.full_key || ''}</code></p>
        <p className="text-sm italic mt-2">{UI_STRINGS.SAVE_SECURELY}</p>
      </div>
      <button onClick={onClose} className="mt-2 py-1 px-3 bg-green-200 text-green-800 rounded-md hover:bg-green-300 text-sm font-medium">Close</button>
    </div>
  );
};

const ApiKeysTable: React.FC<{
  keys: ApiKey[];
  onRevoke: (id: string) => void;
  onRotate: (key: ApiKey) => void;
  creating: boolean;
}> = ({ keys, onRevoke, onRotate, creating }) => (
  <div className="overflow-x-auto rounded-lg shadow-md border border-gray-200">
    <table className="w-full min-w-max text-sm text-left text-gray-600">
      <thead className="text-xs text-gray-700 uppercase bg-gray-50">
        <tr>
          <th scope="col" className="px-6 py-3">Name</th>
          <th scope="col" className="px-6 py-3">Prefix</th>
          <th scope="col" className="px-6 py-3">Status</th>
          <th scope="col" className="px-6 py-3">Created</th>
          <th scope="col" className="px-6 py-3">Last Used</th>
          <th scope="col" className="px-6 py-3">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {keys.map((key) => (
          <tr key={key.id} className="bg-white hover:bg-gray-50">
            <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">{key.name || 'Unnamed'}</td>
            <td className="px-6 py-4"><code className="font-mono text-gray-800">{key.prefix}</code></td>
            <td className="px-6 py-4">
              <span className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${key.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {key.status?.toUpperCase() || 'UNKNOWN'}
              </span>
            </td>
            <td className="px-6 py-4">{key.created_at ? new Date(key.created_at).toLocaleDateString() : 'Never'}</td>
            <td className="px-6 py-4">{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}</td>
            <td className="px-6 py-4">
              {key.status === 'active' && (
                <div className="flex flex-col md:flex-row gap-2">
                  <button
                    onClick={() => onRotate(key)}
                    className="py-1 px-2 text-xs font-medium text-yellow-800 bg-yellow-100 rounded-md hover:bg-yellow-200 disabled:opacity-50"
                    title="Rotate Key"
                    disabled={creating}
                    aria-disabled={creating}
                    data-testid={`rotate-btn-${key.id}`}
                  >
                    {(UI_STRINGS.ROTATE || 'Rotate').toUpperCase()}
                  </button>
                  <button
                    onClick={() => onRevoke(key.id || '')}
                    className="py-1 px-2 text-xs font-medium text-red-800 bg-red-100 rounded-md hover:bg-red-200"
                    title="Revoke Key"
                  >
                    {(UI_STRINGS.REVOKE || 'Revoke').toUpperCase()}
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


const ApiKeys: React.FC<ApiKeysProps> = () => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<{ prefix: string; full_key: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      const apiClient = createApiClient({ baseURL: API_BASE });
      const data = await apiClient.listApiKeys();
      setKeys((data.data || []).map((key: ApiKey) => ({
        ...key,
        status: key.status as 'active' | 'revoked' | undefined,
        created_at: key.created_at,
        last_used_at: key.last_used_at
      })));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async (name: string) => {
    try {
      setCreating(true);
      const apiClient = createApiClient({ baseURL: API_BASE });
      const data = await apiClient.createApiKey(name);
      setNewKey({ prefix: data.prefix || '', full_key: data.full_key || '' });
      setShowCreate(false);
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) return;
    try {
      const apiClient = createApiClient({ baseURL: API_BASE });
      await apiClient.revokeApiKey(id);
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleRotate = async (key: ApiKey) => {
    const name = key.name || '';
    const message = name
      ? `Rotate this key? This will create a new key with the name "${name}" and revoke the old one.`
      : 'Rotate this key? This will create a new key and revoke the old one.';
    if (!confirm(message)) return;

    try {
      setCreating(true);
      const apiClient = createApiClient({ baseURL: API_BASE });

      const newData = await apiClient.createApiKey(name);
      setNewKey({ prefix: newData.prefix || '', full_key: newData.full_key || '' });

      await apiClient.revokeApiKey(key.id || '');
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <h2 className="text-3xl font-extrabold text-gray-900">{UI_STRINGS.API_KEYS_MANAGEMENT}</h2>
        <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 py-2 px-4 bg-indigo-600 text-white rounded-md shadow-sm hover:bg-indigo-700">
          <span className="font-bold text-lg">+</span> {UI_STRINGS.CREATE_NEW_API_KEY}
        </button>
      </header>

      {error && <div className="p-4 mb-4 bg-red-100 border-l-4 border-red-500 text-red-700 rounded-r-lg" role="alert">Error: {error}</div>}

      <CreateApiKeyModal
        show={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
        creating={creating}
      />

      <NewKeyAlert newKey={newKey} onClose={() => setNewKey(null)} />

      <div className="mb-12">
        <h3 className="text-xl font-semibold text-gray-800 mb-4">{UI_STRINGS.YOUR_API_KEYS}</h3>
        {loading ? (
          <div className="text-center p-10 text-gray-500">Loading API keys...</div>
        ) : keys.length === 0 ? (
          <div className="text-center p-10 text-gray-500 border-2 border-dashed border-gray-300 rounded-lg">
            <p>No API keys found.</p>
          </div>
        ) : (
          <ApiKeysTable keys={keys} onRevoke={handleRevoke} onRotate={handleRotate} creating={creating} />
        )}
      </div>

      <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
        <h3 className="text-xl font-semibold text-gray-800 mb-2">Test in Postman</h3>
        <p className="text-gray-600 mb-4">Use our Postman collection to quickly test the API endpoints with pre-configured requests and examples.</p>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <a href="https://www.postman.com/run-collection/your-collection-id-here"
            className="inline-flex items-center gap-2 py-2 px-4 bg-orange-500 text-white rounded-md hover:bg-orange-600"
            target="_blank"
            rel="noopener noreferrer">
            <span className="text-lg">🚀</span> Run in Postman
          </a>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <a href="/docs/postman/postman_collection.json" className="text-indigo-600 hover:underline">Download collection</a>
            <span className="text-gray-400">|</span>
            <a href="/docs/postman/postman_sandbox_environment.json" className="text-indigo-600 hover:underline">Sandbox env</a>
            <span className="text-gray-400">|</span>
            <a href="/docs/postman/postman_production_environment.json" className="text-indigo-600 hover:underline">Production env</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiKeys;