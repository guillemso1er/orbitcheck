import { createApiClient } from '@orbitcheck/contracts';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE, UI_STRINGS } from '../constants';

interface ApiKey {
  id: string;
  prefix: string;
  name?: string;
  status: 'active' | 'revoked';
  created_at: string | null;
  last_used_at: string | null;
}

interface ApiKeysProps {
  token?: string;
}

// Copy to clipboard hook
const useCopyToClipboard = () => {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return true;
    } catch (err) {
      console.error('Failed to copy:', err);
      return false;
    }
  }, []);

  return { copy, copied };
};

// Confirmation Dialog Component
const ConfirmDialog: React.FC<{
  show: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  show,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel
}) => {
    useEffect(() => {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onCancel();
      };
      if (show) {
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
      }
    }, [show, onCancel]);

    if (!show) return null;

    const buttonClass = variant === 'danger'
      ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
      : 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500';

    return (
      <div
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        onClick={onCancel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <div
          className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md m-4 border border-gray-200 dark:border-gray-700"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6">
            <h3 id="confirm-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
            <p className="text-gray-600 dark:text-gray-300 mb-6">{message}</p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="py-2 px-4 bg-white dark:bg-gray-600 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-500 rounded-md hover:bg-gray-50 dark:hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={`py-2 px-4 text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 ${buttonClass}`}
              >
                {confirmText}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

// Create API Key Modal
const CreateApiKeyModal: React.FC<{
  show: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  creating: boolean;
}> = ({ show, onClose, onCreate, creating }) => {
  const [newKeyName, setNewKeyName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creating) onClose();
    };
    if (show) {
      document.addEventListener('keydown', handleEscape);
      inputRef.current?.focus();
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [show, onClose, creating]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCreate(newKeyName.trim());
    setNewKeyName('');
  };

  const handleClose = () => {
    if (!creating) {
      setNewKeyName('');
      onClose();
    }
  };

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-modal-title"
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md m-4 border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-600">
          <h3 id="create-modal-title" className="text-lg font-semibold text-gray-800 dark:text-white">Create New API Key</h3>
          <button
            className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white text-2xl font-bold leading-none disabled:opacity-50"
            onClick={handleClose}
            disabled={creating}
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="p-4">
            <div className="mb-4">
              <label htmlFor="key-name" className="block text-sm font-medium text-gray-700 mb-1">
                Name (optional)
              </label>
              <input
                ref={inputRef}
                id="key-name"
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Production API"
                disabled={creating}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 p-4 bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600 rounded-b-lg">
            <button
              type="button"
              className="py-2 px-4 bg-white dark:bg-gray-600 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-500 rounded-md hover:bg-gray-50 dark:hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleClose}
              disabled={creating}
            >
              Cancel
            </button>
            <button
              id="modal-submit-btn"
              type="submit"
              className="py-2 px-4 bg-indigo-600 text-white rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              disabled={creating}
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// New Key Alert with copy functionality
const NewKeyAlert: React.FC<{
  newKey: { prefix: string; full_key: string } | null;
  onClose: () => void;
}> = ({ newKey, onClose }) => {
  const { copy, copied } = useCopyToClipboard();

  if (!newKey) return null;

  return (
    <div
      id="alert-success"
      className="p-4 mb-4 bg-green-100 border-l-4 border-green-500 text-green-700 rounded-r-lg"
      role="alert"
      aria-live="polite"
    >
      <h4 className="font-bold text-lg mb-2">{UI_STRINGS.NEW_KEY_CREATED}</h4>
      <div className="my-2 space-y-3">
        <div>
          <p className="text-sm font-medium mb-1">Prefix:</p>
          <div className="flex items-center gap-2">
            <code className="bg-green-200 text-green-900 px-2 py-1 rounded font-mono flex-1">
              {newKey.prefix}
            </code>
            <button
              onClick={() => copy(newKey.prefix)}
              className="py-1 px-3 bg-green-200 text-green-800 rounded-md hover:bg-green-300 text-sm font-medium transition-colors"
              title="Copy prefix"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <div>
          <p className="text-sm font-medium mb-1">Full Key:</p>
          <div className="flex items-start gap-2">
            <code className="bg-green-200 text-green-900 px-2 py-1 rounded font-mono break-all flex-1">
              {newKey.full_key}
            </code>
            <button
              onClick={() => copy(newKey.full_key)}
              className="py-1 px-3 bg-green-200 text-green-800 rounded-md hover:bg-green-300 text-sm font-medium whitespace-nowrap transition-colors"
              title="Copy full key"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <p className="text-sm italic mt-3 p-2 bg-green-50 rounded border border-green-300">
          ⚠️ {UI_STRINGS.SAVE_SECURELY}
        </p>
      </div>
      <button
        onClick={onClose}
        className="mt-3 py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium transition-colors"
      >
        I've saved it securely
      </button>
    </div>
  );
};

// Success Toast
const SuccessToast: React.FC<{ message: string; onClose: () => void }> = ({ message, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed top-4 right-4 z-50 animate-slide-in">
      <div className="bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3">
        <span className="text-xl">✓</span>
        <span>{message}</span>
        <button onClick={onClose} className="ml-2 text-white hover:text-green-100">
          &times;
        </button>
      </div>
    </div>
  );
};

// API Keys Table
const ApiKeysTable: React.FC<{
  keys: ApiKey[];
  onRevoke: (id: string) => void;
  onRotate: (key: ApiKey) => void;
  loadingStates: Record<string, boolean>;
}> = ({ keys, onRevoke, onRotate, loadingStates }) => (
  <div className="overflow-x-auto rounded-lg shadow-md border border-gray-200 dark:border-gray-600">
    <table className="w-full min-w-max text-sm text-left text-gray-600 dark:text-gray-300">
      <thead className="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-50 dark:bg-gray-700">
        <tr>
          <th scope="col" className="px-6 py-3">Name</th>
          <th scope="col" className="px-6 py-3">Prefix</th>
          <th scope="col" className="px-6 py-3">Status</th>
          <th scope="col" className="px-6 py-3">Created</th>
          <th scope="col" className="px-6 py-3">Last Used</th>
          <th scope="col" className="px-6 py-3">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
        {keys.map((key) => {
          const isLoading = loadingStates[key.id] || false;
          return (
            <tr key={key.id} className="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
                {key.name || <span className="text-gray-400 italic">Unnamed</span>}
              </td>
              <td className="px-6 py-4">
                <code className="font-mono text-gray-800 bg-gray-100 px-2 py-1 rounded">
                  {key.prefix}
                </code>
              </td>
              <td className="px-6 py-4">
                <span
                  className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${key.status === 'active'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                    }`}
                  role="status"
                  aria-label={`Status: ${key.status}`}
                >
                  {key.status.toUpperCase()}
                </span>
              </td>
              <td className="px-6 py-4">
                {key.created_at
                  ? new Date(key.created_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })
                  : <span className="text-gray-400">—</span>
                }
              </td>
              <td className="px-6 py-4">
                {key.last_used_at
                  ? new Date(key.last_used_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })
                  : <span className="text-gray-400">Never</span>
                }
              </td>
              <td className="px-6 py-4">
                {key.status === 'active' && (
                  <div className="flex flex-col md:flex-row gap-2">
                    <button
                      onClick={() => onRotate(key)}
                      className="py-1 px-2 text-xs font-medium text-yellow-800 bg-yellow-100 rounded-md hover:bg-yellow-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Rotate Key"
                      disabled={isLoading}
                      aria-disabled={isLoading}
                      data-testid={`rotate-btn-${key.id}`}
                    >
                      {isLoading ? 'ROTATING...' : UI_STRINGS.ROTATE?.toUpperCase() || 'ROTATE'}
                    </button>
                    <button
                      onClick={() => onRevoke(key.id)}
                      className="py-1 px-2 text-xs font-medium text-red-800 bg-red-100 rounded-md hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Revoke Key"
                      disabled={isLoading}
                    >
                      {UI_STRINGS.REVOKE?.toUpperCase() || 'REVOKE'}
                    </button>
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

// Main Component
const ApiKeys: React.FC<ApiKeysProps> = () => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<{ prefix: string; full_key: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});
  const [confirmDialog, setConfirmDialog] = useState<{
    show: boolean;
    title: string;
    message: string;
    variant?: 'danger' | 'warning';
    onConfirm: () => void;
  } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Memoize API client
  const apiClient = useMemo(() => createApiClient({ baseURL: API_BASE }), []);

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.listApiKeys();
      const transformedKeys: ApiKey[] = (data.data || []).map((apiKey) => ({
        id: apiKey.id!,
        prefix: apiKey.prefix || '',
        name: undefined, // API doesn't provide name
        status: (apiKey.status === 'active' || apiKey.status === 'revoked') ? apiKey.status : 'active',
        created_at: apiKey.created_at || null,
        last_used_at: apiKey.last_used_at || null,
      })).filter((key) => key.id); // Filter out keys without id
      setKeys(transformedKeys);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load API keys';
      setError(errorMessage);
      console.error('Error fetching API keys:', err);
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async (name: string) => {
    try {
      setCreating(true);
      setError(null);
      const data = await apiClient.createApiKey(name || undefined);
      setNewKey({ prefix: data.prefix || '', full_key: data.full_key || '' });
      setShowCreate(false);
      await fetchKeys();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create API key';
      setError(errorMessage);
      console.error('Error creating API key:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = (id: string) => {
    setConfirmDialog({
      show: true,
      title: 'Revoke API Key',
      message: 'Are you sure you want to revoke this API key? This action cannot be undone and will immediately invalidate the key.',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmDialog(null);
        setLoadingStates(prev => ({ ...prev, [id]: true }));
        try {
          setError(null);
          await apiClient.revokeApiKey(id);
          setSuccessMessage('API key revoked successfully');
          await fetchKeys();
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to revoke API key';
          setError(errorMessage);
          console.error('Error revoking API key:', err);
        } finally {
          setLoadingStates(prev => {
            const newState = { ...prev };
            delete newState[id];
            return newState;
          });
        }
      }
    });
  };

  const handleRotate = (key: ApiKey) => {
    const name = key.name || 'this key';
    setConfirmDialog({
      show: true,
      title: 'Rotate API Key',
      message: `This will create a new key${key.name ? ` named "${key.name}"` : ''} and revoke the old one. Make sure to update your applications with the new key.`,
      variant: 'warning',
      onConfirm: async () => {
        setConfirmDialog(null);
        setLoadingStates(prev => ({ ...prev, [key.id]: true }));
        try {
          setError(null);
          const newData = await apiClient.createApiKey(key.name || undefined);
          setNewKey({ prefix: newData.prefix || '', full_key: newData.full_key || '' });
          await apiClient.revokeApiKey(key.id);
          setSuccessMessage('API key rotated successfully');
          await fetchKeys();
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to rotate API key';
          setError(errorMessage);
          console.error('Error rotating API key:', err);
        } finally {
          setLoadingStates(prev => {
            const newState = { ...prev };
            delete newState[key.id];
            return newState;
          });
        }
      }
    });
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <h2 className="text-3xl font-extrabold text-gray-900">
          {UI_STRINGS.API_KEYS_MANAGEMENT}
        </h2>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 py-2 px-4 bg-indigo-600 text-white rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
        >
          <span className="font-bold text-lg">+</span> {UI_STRINGS.CREATE_NEW_API_KEY}
        </button>
      </header>

      {error && (
        <div
          className="p-4 mb-4 bg-red-100 border-l-4 border-red-500 text-red-700 rounded-r-lg flex justify-between items-start"
          role="alert"
        >
          <div>
            <p className="font-bold">Error</p>
            <p>{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-700 hover:text-red-900 font-bold text-xl"
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      <CreateApiKeyModal
        show={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
        creating={creating}
      />

      {confirmDialog && (
        <ConfirmDialog
          show={confirmDialog.show}
          title={confirmDialog.title}
          message={confirmDialog.message}
          variant={confirmDialog.variant}
          confirmText={confirmDialog.variant === 'danger' ? 'Revoke' : 'Rotate'}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      <NewKeyAlert newKey={newKey} onClose={() => setNewKey(null)} />

      {successMessage && (
        <SuccessToast
          message={successMessage}
          onClose={() => setSuccessMessage(null)}
        />
      )}

      <div className="mb-12">
        <h3 className="text-xl font-semibold text-gray-800 mb-4">
          {UI_STRINGS.YOUR_API_KEYS}
        </h3>
        {loading ? (
          <div className="text-center p-10 text-gray-500">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>
            <p>Loading API keys...</p>
          </div>
        ) : keys.length === 0 ? (
          <div className="text-center p-10 text-gray-500 border-2 border-dashed border-gray-300 rounded-lg">
            <p className="text-lg mb-2">No API keys found</p>
            <p className="text-sm">Create your first API key to get started</p>
          </div>
        ) : (
          <ApiKeysTable
            keys={keys}
            onRevoke={handleRevoke}
            onRotate={handleRotate}
            loadingStates={loadingStates}
          />
        )}
      </div>

      <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
        <h3 className="text-xl font-semibold text-gray-800 mb-2">Test in Postman</h3>
        <p className="text-gray-600 mb-4">
          Use our Postman collection to quickly test the API endpoints with pre-configured requests and examples.
        </p>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <a
            href="https://www.postman.com/run-collection/your-collection-id-here"
            className="inline-flex items-center gap-2 py-2 px-4 bg-orange-500 text-white rounded-md hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="text-lg">🚀</span> Run in Postman
          </a>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <a
              href="/docs/postman/postman_collection.json"
              className="text-indigo-600 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
            >
              Download collection
            </a>
            <span className="text-gray-400" aria-hidden="true">|</span>
            <a
              href="/docs/postman/postman_sandbox_environment.json"
              className="text-indigo-600 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
            >
              Sandbox env
            </a>
            <span className="text-gray-400" aria-hidden="true">|</span>
            <a
              href="/docs/postman/postman_production_environment.json"
              className="text-indigo-600 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
            >
              Production env
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiKeys;