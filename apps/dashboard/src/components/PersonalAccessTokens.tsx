import { createPersonalAccessToken, listPersonalAccessTokens, revokePersonalAccessToken } from '@orbitcheck/contracts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from '../utils/api';

interface PersonalAccessToken {
  id: string;
  token_id: string;
  name: string;
  scopes: string[];
  env: 'test' | 'live';
  last_used_at: string | null;
  last_used_ip: string | null;
  expires_at: string | null;
  disabled: boolean;
  created_at: string;
}

interface PersonalAccessTokensProps {
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
            <h3 id="confirm-dialog-title" className="text-base font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
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

const CreatePATModal: React.FC<{
  show: boolean;
  onClose: () => void;
  onCreate: (data: {
    name: string;
    scopes: string[];
    env: 'test' | 'live';
    expires_at?: string;
    ip_allowlist?: string[];
    project_id?: string;
  }) => Promise<void>;
  creating: boolean;
}> = ({ show, onClose, onCreate, creating }) => {
  const [formData, setFormData] = useState({
    name: '',
  });
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creating) onClose();
    };
    if (show) {
      document.addEventListener('keydown', handleEscape);
      nameInputRef.current?.focus();
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [show, onClose, creating]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      name: formData.name,
      scopes: ['logs:read'], // Default scope
      env: 'live' as 'test' | 'live', // Default environment
      expires_at: undefined, // No expiration by default
      ip_allowlist: [], // No IP restrictions by default
      project_id: undefined, // No project restriction by default
    };
    await onCreate(data);
    setFormData({
      name: '',
    });
  };

  const handleClose = () => {
    if (!creating) {
      setFormData({
        name: '',
      });
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
      aria-labelledby="create-pat-modal-title"
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl m-4 border border-gray-200 dark:border-gray-700 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-600">
          <h3 id="create-pat-modal-title" className="text-lg font-semibold text-gray-800 dark:text-white">Create Personal Access Token</h3>
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
          <div className="p-6 space-y-6">
            {/* Name */}
            <div>
              <label htmlFor="pat-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Name *
              </label>
              <input
                ref={nameInputRef}
                id="pat-name"
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Production API Access"
                disabled={creating}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100 disabled:cursor-not-allowed dark:bg-gray-700 dark:text-white"
              />
              <p className="text-xs text-gray-500 mt-1">
                All other settings will use default values (Live environment, Read access, No expiration)
              </p>
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
              id="pat-modal-submit-btn"
              type="submit"
              className="py-2 px-4 bg-indigo-600 text-white rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              disabled={creating}
            >
              {creating ? 'Creating...' : 'Create Token'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// New PAT Alert with copy functionality
const NewPATAlert: React.FC<{
  newToken: { token: string; token_id: string } | null;
  onClose: () => void;
}> = ({ newToken, onClose }) => {
  const { copy, copied } = useCopyToClipboard();

  if (!newToken) return null;

  return (
    <div
      id="alert-success"
      className="p-4 mb-4 bg-green-100 border-l-4 border-green-500 text-green-700 rounded-r-lg"
      role="alert"
      aria-live="polite"
    >
      <h4 className="font-bold text-base mb-2">Personal Access Token Created</h4>
      <div className="my-2 space-y-3">
        <div>
          <p className="text-sm font-medium mb-1">Token:</p>
          <div className="flex items-start gap-2">
            <code className="bg-green-200 text-green-900 px-2 py-1 rounded font-mono break-all flex-1 text-xs">
              {newToken.token}
            </code>
            <button
              onClick={() => copy(newToken.token)}
              className="py-1 px-3 bg-green-200 text-green-800 rounded-md hover:bg-green-300 text-sm font-medium whitespace-nowrap transition-colors"
              title="Copy token"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => {
              const blob = new Blob([newToken.token], { type: 'text/plain' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `pat-${newToken.token_id}.txt`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
            className="py-1 px-3 bg-green-200 text-green-800 rounded-md hover:bg-green-300 text-sm font-medium transition-colors"
          >
            Download .txt
          </button>
          <button
            onClick={() => {
              if (navigator.share) {
                navigator.share({
                  title: 'Personal Access Token',
                  text: newToken.token,
                });
              }
            }}
            className="py-1 px-3 bg-green-200 text-green-800 rounded-md hover:bg-green-300 text-sm font-medium transition-colors"
          >
            Share
          </button>
        </div>
        <p className="text-sm italic mt-3 p-2 bg-green-50 rounded border border-green-300">
          ⚠️ <strong>This token will never be shown again.</strong> Store it securely and do not share it in client-side code.
        </p>
      </div>
      <button
        onClick={onClose}
        className="mt-3 py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium transition-colors"
      >
        I've stored this safely
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

// PATs Table
const PATsTable: React.FC<{
  tokens: PersonalAccessToken[];
  onRevoke: (tokenId: string) => void;
  onRotate: (token: PersonalAccessToken) => void;
  loadingStates: Record<string, boolean>;
}> = ({ tokens, onRevoke, onRotate, loadingStates }) => (
  <div className="overflow-x-auto rounded-lg shadow-md border border-gray-200 dark:border-gray-600">
    <table className="w-full min-w-max text-sm text-left text-gray-600 dark:text-gray-300">
      <thead className="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-50 dark:bg-gray-700">
        <tr>
          <th scope="col" className="px-6 py-3">Name</th>
          <th scope="col" className="px-6 py-3">Token ID</th>
          <th scope="col" className="px-6 py-3">Scopes</th>
          <th scope="col" className="px-6 py-3">Environment</th>
          <th scope="col" className="px-6 py-3">Last Used</th>
          <th scope="col" className="px-6 py-3">Expires</th>
          <th scope="col" className="px-6 py-3">Status</th>
          <th scope="col" className="px-6 py-3">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
        {tokens.map((token) => {
          const isLoading = loadingStates[token.token_id] || false;
          const isExpired = token.expires_at && new Date(token.expires_at) < new Date();
          const isExpiringSoon = token.expires_at && !isExpired &&
            new Date(token.expires_at).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000; // 7 days

          return (
            <tr key={token.token_id} className="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
                {token.name}
              </td>
              <td className="px-6 py-4">
                <code className="font-mono text-gray-800 bg-gray-100 px-2 py-1 rounded text-xs">
                  ...{token.token_id.slice(-8)}
                </code>
              </td>
              <td className="px-6 py-4">
                <div className="flex flex-wrap gap-1">
                  {token.scopes.slice(0, 2).map((scope) => (
                    <span key={scope} className="inline-block px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                      {scope.split(':')[0]}
                    </span>
                  ))}
                  {token.scopes.length > 2 && (
                    <span className="inline-block px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded">
                      +{token.scopes.length - 2}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-6 py-4">
                <span className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${token.env === 'live'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-yellow-100 text-yellow-800'
                  }`}>
                  {token.env.toUpperCase()}
                </span>
              </td>
              <td className="px-6 py-4">
                {token.last_used_at
                  ? new Date(token.last_used_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })
                  : <span className="text-gray-400">Never</span>
                }
                {token.last_used_ip && (
                  <div className="text-xs text-gray-500">IP: {token.last_used_ip}</div>
                )}
              </td>
              <td className="px-6 py-4">
                {token.expires_at ? (
                  <span className={isExpired ? 'text-red-600' : isExpiringSoon ? 'text-yellow-600' : 'text-gray-600'}>
                    {new Date(token.expires_at).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                    {isExpired && ' (Expired)'}
                    {isExpiringSoon && !isExpired && ' (Soon)'}
                  </span>
                ) : (
                  <span className="text-gray-400">Never</span>
                )}
              </td>
              <td className="px-6 py-4">
                <span
                  className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${token.disabled
                    ? 'bg-red-100 text-red-800'
                    : isExpired
                      ? 'bg-red-100 text-red-800'
                      : 'bg-green-100 text-green-800'
                    }`}
                  role="status"
                  aria-label={`Status: ${token.disabled ? 'disabled' : isExpired ? 'expired' : 'active'}`}
                >
                  {token.disabled ? 'DISABLED' : isExpired ? 'EXPIRED' : 'ACTIVE'}
                </span>
              </td>
              <td className="px-6 py-4">
                {!token.disabled && (
                  <div className="flex flex-col gap-2">
                    {isExpiringSoon && (
                      <button
                        onClick={() => onRotate(token)}
                        className="py-1 px-2 text-xs font-medium text-yellow-800 bg-yellow-100 rounded-md hover:bg-yellow-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Rotate Token"
                        disabled={isLoading}
                      >
                        ROTATE
                      </button>
                    )}
                    <button
                      onClick={() => onRevoke(token.token_id)}
                      className="py-1 px-2 text-xs font-medium text-red-800 bg-red-100 rounded-md hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Revoke Token"
                      disabled={isLoading}
                    >
                      REVOKE
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
const PersonalAccessTokens: React.FC<PersonalAccessTokensProps> = () => {
  const apiClient = useApiClient();
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newToken, setNewToken] = useState<{ token: string; token_id: string } | null>(null);
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

  const fetchTokens = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error } = await listPersonalAccessTokens({ client: apiClient });

      if (error) {
        throw new Error((error?.error || {}).message || 'Failed to load personal access tokens');
      }

      // API returns { pats: [...], data: [...], request_id }, we can use either pats or data
      const tokens = (data as any).pats || (data as any).data || [];
      setTokens(tokens.filter((token: PersonalAccessToken): token is PersonalAccessToken =>
        token.id !== undefined &&
        token.token_id !== undefined &&
        token.name !== undefined &&
        token.scopes !== undefined &&
        token.env !== undefined &&
        token.disabled !== undefined &&
        token.created_at !== undefined
      ));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load personal access tokens';
      setError(errorMessage);
      console.error('Error fetching PATs:', err);
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleCreate = async (formData: {
    name: string;
    scopes: string[];
    env: 'test' | 'live';
    expires_at?: string;
    ip_allowlist?: string[];
    project_id?: string;
  }) => {
    try {
      setCreating(true);
      setError(null);
      const { data, error } = await createPersonalAccessToken({
        client: apiClient,
        body: {
          name: formData.name,
          scopes: formData.scopes as any,
          env: formData.env,
          expires_at: formData.expires_at,
          ip_allowlist: formData.ip_allowlist,
          project_id: formData.project_id
        }
      });

      if (error) {
        throw new Error((error?.error || {}).message || 'Failed to create personal access token');
      }

      setNewToken({
        token: data?.token || '',
        token_id: data?.token_id || ''
      });
      setShowCreate(false);
      await fetchTokens();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create personal access token';
      setError(errorMessage);
      console.error('Error creating PAT:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = (tokenId: string) => {
    setConfirmDialog({
      show: true,
      title: 'Revoke Personal Access Token',
      message: 'Are you sure you want to revoke this personal access token? This action cannot be undone and will immediately invalidate the token.',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmDialog(null);
        setLoadingStates(prev => ({ ...prev, [tokenId]: true }));
        try {
          setError(null);
          const { error } = await revokePersonalAccessToken({ client: apiClient, path: { token_id: tokenId } });

          if (error) {
            throw new Error((error?.error || {}).message || 'Failed to revoke personal access token');
          }

          setSuccessMessage('Personal access token revoked successfully');
          await fetchTokens();
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to revoke personal access token';
          setError(errorMessage);
          console.error('Error revoking PAT:', err);
        } finally {
          setLoadingStates(prev => {
            const newState = { ...prev };
            delete newState[tokenId];
            return newState;
          });
        }
      }
    });
  };

  const handleRotate = (token: PersonalAccessToken) => {
    setConfirmDialog({
      show: true,
      title: 'Rotate Personal Access Token',
      message: `This will create a new token with the same scopes and revoke the old one. Make sure to update your applications with the new token.`,
      variant: 'warning',
      onConfirm: async () => {
        setConfirmDialog(null);
        setLoadingStates(prev => ({ ...prev, [token.token_id]: true }));
        try {
          setError(null);
          // Create new token with same details
          const newTokenData = {
            name: token.name,
            scopes: token.scopes,
            env: token.env,
            ip_allowlist: [], // Not stored in mock
            project_id: undefined, // Not stored in mock
          };
          const { data, error } = await createPersonalAccessToken({
            client: apiClient,
            body: {
              name: newTokenData.name,
              scopes: newTokenData.scopes as any,
              env: newTokenData.env,
              ip_allowlist: newTokenData.ip_allowlist,
              project_id: newTokenData.project_id
            }
          });

          if (error) {
            throw new Error((error?.error || {}).message || 'Failed to create new personal access token');
          }

          setNewToken({
            token: data?.token || '',
            token_id: data?.token_id || ''
          });

          const { error: revokeError } = await revokePersonalAccessToken({ client: apiClient, path: { token_id: token.token_id } });

          if (revokeError) {
            throw new Error((revokeError?.error || {}).message || 'Failed to revoke old personal access token');
          }

          setSuccessMessage('Personal access token rotated successfully');
          await fetchTokens();
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to rotate personal access token';
          setError(errorMessage);
          console.error('Error rotating PAT:', err);
        } finally {
          setLoadingStates(prev => {
            const newState = { ...prev };
            delete newState[token.token_id];
            return newState;
          });
        }
      }
    });
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Personal Access Tokens
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manage your personal access tokens for API authentication
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 py-2 px-4 bg-indigo-600 text-white rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
        >
          <span className="font-bold text-lg">+</span> Create Token
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

      <CreatePATModal
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

      <NewPATAlert newToken={newToken} onClose={() => setNewToken(null)} />

      {successMessage && (
        <SuccessToast
          message={successMessage}
          onClose={() => setSuccessMessage(null)}
        />
      )}

      <div className="mb-12">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">
          Your Personal Access Tokens
        </h3>
        {loading ? (
          <div className="text-center p-10 text-gray-500">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>
            <p>Loading personal access tokens...</p>
          </div>
        ) : tokens.length === 0 ? (
          <div className="text-center p-10 text-gray-500 border-2 border-dashed border-gray-300 rounded-lg">
            <p className="text-lg mb-2">No personal access tokens found</p>
            <p className="text-sm">Create your first token to get started with API authentication</p>
          </div>
        ) : (
          <PATsTable
            tokens={tokens}
            onRevoke={handleRevoke}
            onRotate={handleRotate}
            loadingStates={loadingStates}
          />
        )}
      </div>

      {/* Security Notes */}
      <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-lg border border-blue-200 dark:border-blue-800">
        <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-200 mb-2">Security Best Practices</h3>
        <ul className="text-blue-700 dark:text-blue-300 space-y-2 text-sm">
          <li>• Store tokens securely and never commit them to version control</li>
          <li>• Use the minimum required scopes for each token</li>
          <li>• Set expiration dates for tokens when possible</li>
          <li>• Use IP allowlists to restrict token usage to specific networks</li>
          <li>• Rotate tokens regularly and revoke unused ones</li>
          <li>• Never use tokens in client-side code or share them publicly</li>
        </ul>
      </div>
    </div>
  );
};

export default PersonalAccessTokens;