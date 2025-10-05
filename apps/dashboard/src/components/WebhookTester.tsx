import { createApiClient } from '@orbicheck/contracts';
import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import { UI_STRINGS } from '../constants';

interface WebhookTestResult {
  sent_to: string;
  payload: Record<string, unknown>;
  response: {
    status: number;
    status_text: string;
    headers: Record<string, string>;
    body: string;
  };
  request_id: string;
}


const TestForm: React.FC<{
  url: string;
  payloadType: 'validation' | 'order' | 'custom';
  customPayload: string;
  onUrlChange: (url: string) => void;
  onPayloadTypeChange: (type: 'validation' | 'order' | 'custom') => void;
  onCustomPayloadChange: (payload: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  loading: boolean;
}> = ({
  url,
  payloadType,
  customPayload,
  onUrlChange,
  onPayloadTypeChange,
  onCustomPayloadChange,
  onSubmit,
  loading
}) => (
    // Add noValidate to the form to allow custom validation to handle errors
    <form onSubmit={onSubmit} className="test-form" noValidate>
      <div className="form-group">
        <label htmlFor="webhook-url">Webhook URL</label>
        <input
          id="webhook-url"
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://your-webhook-url.com/endpoint"
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="payload-type">Payload Type</label>
        <select
          id="payload-type"
          value={payloadType}
          onChange={(e) => onPayloadTypeChange(e.target.value as 'validation' | 'order' | 'custom')}
        >
          <option value="validation">Validation Result</option>
          <option value="order">Order Evaluation</option>
          <option value="custom">Custom Payload</option>
        </select>
      </div>

      {payloadType === 'custom' && (
        <div className="form-group">
          <label htmlFor="custom-payload">Custom Payload (JSON)</label>
          <textarea
            id="custom-payload"
            value={customPayload}
            onChange={(e) => onCustomPayloadChange(e.target.value)}
            placeholder='{"event": "custom", "data": "your data"}'
            rows={6}
          />
        </div>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? (
            <>
              <span className="spinner"></span> {UI_STRINGS.SENDING}
            </>
          ) : (
            UI_STRINGS.SEND_TEST_PAYLOAD
          )}
        </button>
      </div>
    </form>
  );

const RequestTab: React.FC<{ result: WebhookTestResult }> = ({ result }) => (
  <div className="tab-content">
    <div className="content-section">
      <h4>{UI_STRINGS.SENT_TO}</h4>
      <p><code>{result.sent_to}</code></p>
    </div>
    <div className="content-section">
      <h4>{UI_STRINGS.PAYLOAD}</h4>
      <pre>{JSON.stringify(result.payload, null, 2)}</pre>
    </div>
  </div>
);

const ResponseTab: React.FC<{ result: WebhookTestResult }> = ({ result }) => (
  <div className="tab-content">
    <div className="content-section">
      <h4>{UI_STRINGS.STATUS}</h4>
      <div className={`status-badge status-${result.response.status >= 200 && result.response.status < 300 ? 'success' : 'error'}`}>
        {result.response.status} {result.response.status_text}
      </div>
    </div>
    <div className="content-section">
      <h4>{UI_STRINGS.HEADERS}</h4>
      <pre>{JSON.stringify(result.response.headers, null, 2)}</pre>
    </div>
    <div className="content-section">
      <h4>{UI_STRINGS.BODY}</h4>
      <pre>{result.response.body}</pre>
    </div>
    <div className="content-section">
      <h4>{UI_STRINGS.REQUEST_ID}</h4>
      <p><code>{result.request_id}</code></p>
    </div>
  </div>
);

const ResultTabs: React.FC<{
  result: WebhookTestResult;
  activeTab: 'request' | 'response';
  onTabChange: (tab: 'request' | 'response') => void;
  onClear: () => void;
}> = ({ result, activeTab, onTabChange, onClear }) => (
  <div className="result-section">
    <div className="result-header">
      <h3>{UI_STRINGS.TEST_RESULT}</h3>
      <button onClick={onClear} className="btn btn-secondary">{UI_STRINGS.CLEAR}</button>
    </div>

    <div className="result-tabs">
      <button
        className={`tab-btn ${activeTab === 'request' ? 'active' : ''}`}
        onClick={() => onTabChange('request')}
      >
        {UI_STRINGS.REQUEST}
      </button>
      <button
        className={`tab-btn ${activeTab === 'response' ? 'active' : ''}`}
        onClick={() => onTabChange('response')}
      >
        {UI_STRINGS.RESPONSE}
      </button>
    </div>

    {activeTab === 'request' ? (
      <RequestTab result={result} />
    ) : (
      <ResponseTab result={result} />
    )}
  </div>
);

const WebhookTester: React.FC = () => {
  const { token } = useAuth();
  const [url, setUrl] = useState('');
  const [payloadType, setPayloadType] = useState<'validation' | 'order' | 'custom'>('validation');
  const [customPayload, setCustomPayload] = useState('');
  const [result, setResult] = useState<WebhookTestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'request' | 'response'>('request');

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) {
      setError(UI_STRINGS.URL_REQUIRED);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const apiClient = createApiClient({
        baseURL: '', // Use relative path since we're proxying
        token: token || ''
      });

      const data = await apiClient.testWebhook(url, payloadType, payloadType === 'custom' && customPayload ? JSON.parse(customPayload) : undefined);
      setResult(data as WebhookTestResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleClearResult = () => setResult(null);

  return (
    <div className="webhook-tester">
      <header className="page-header">
        <h2>{UI_STRINGS.WEBHOOK_TESTER}</h2>
      </header>

      <div className="tester-section">
        <TestForm
          url={url}
          payloadType={payloadType}
          customPayload={customPayload}
          onUrlChange={setUrl}
          onPayloadTypeChange={setPayloadType}
          onCustomPayloadChange={setCustomPayload}
          onSubmit={handleTest}
          loading={loading}
        />
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <ResultTabs
          result={result}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onClear={handleClearResult}
        />
      )}


      <style>{`
        .webhook-tester {
          max-width: 1000px;
          margin: 0 auto;
          padding: var(--spacing-md);
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--spacing-xl);
          flex-wrap: wrap;
          gap: var(--spacing-md);
        }
        .page-header h2 {
          margin: 0;
        }
        .tester-section {
          background: var(--bg-secondary);
          border-radius: var(--border-radius-lg);
          padding: var(--spacing-lg);
          border: 1px solid var(--border-color);
          margin-bottom: var(--spacing-xl);
        }
        .test-form {
          display: grid;
          gap: var(--spacing-md);
        }
        .form-group {
          display: flex;
          flex-direction: column;
        }
        .form-group label {
          margin-bottom: var(--spacing-xs);
          font-weight: 500;
          color: var(--text-primary);
        }
        .form-group input,
        .form-group select,
        .form-group textarea {
          padding: var(--spacing-sm);
          border: 1px solid var(--border-color);
          border-radius: var(--border-radius);
          background: var(--bg-primary);
          color: var(--text-primary);
          transition: border-color 0.15s ease-in-out;
        }
        .form-group textarea {
          resize: vertical;
          min-height: 120px;
          font-family: 'Courier New', monospace;
        }
        .form-actions {
          margin-top: var(--spacing-md);
        }
        .btn-primary:disabled {
          opacity: 0.6;
        }
        .spinner {
          display: inline-block;
          width: 1em;
          height: 1em;
          border: 2px solid currentColor;
          border-radius: 50%;
          border-top-color: transparent;
          animation: spin 1s linear infinite;
          margin-right: var(--spacing-xs);
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .alert {
          padding: var(--spacing-md);
          border-radius: var(--border-radius);
          border: 1px solid;
          margin-bottom: var(--spacing-lg);
        }
        .alert-danger {
          background-color: #f8d7da;
          border-color: #f5c6cb;
          color: #721c24;
        }
        .result-section {
          background: var(--bg-primary);
          border-radius: var(--border-radius-lg);
          border: 1px solid var(--border-color);
          box-shadow: var(--shadow-sm);
          overflow: hidden;
        }
        .result-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--spacing-md);
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-color);
        }
        .result-header h3 {
          margin: 0;
        }
        .result-tabs {
          display: flex;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-color);
        }
        .tab-btn {
          padding: var(--spacing-md) var(--spacing-lg);
          border: none;
          background: none;
          cursor: pointer;
          color: var(--text-secondary);
          transition: all 0.2s ease;
          border-bottom: 2px solid transparent;
        }
        .tab-btn:hover {
          color: var(--text-primary);
          background: var(--bg-secondary);
        }
        .tab-btn.active {
          color: #007bff;
          border-bottom-color: #007bff;
          background: var(--bg-primary);
        }
        .tab-content {
          padding: var(--spacing-lg);
        }
        .content-section {
          margin-bottom: var(--spacing-xl);
          padding-bottom: var(--spacing-md);
          border-bottom: 1px solid var(--border-color);
        }
        .content-section:last-child {
          border-bottom: none;
          margin-bottom: 0;
        }
        .content-section h4 {
          margin-bottom: var(--spacing-sm);
          color: var(--text-primary);
          font-size: 1.125rem;
        }
        .content-section p {
          margin: 0;
          word-break: break-all;
        }
        .content-section code {
          background: var(--bg-tertiary);
          padding: var(--spacing-xs) var(--spacing-sm);
          border-radius: var(--border-radius);
          font-family: monospace;
        }
        .content-section pre {
          background: var(--bg-tertiary);
          padding: var(--spacing-md);
          border-radius: var(--border-radius);
          overflow-x: auto;
          white-space: pre-wrap;
          font-size: 0.875em;
          line-height: 1.4;
          border: 1px solid var(--border-color);
        }
        .status-badge {
          padding: var(--spacing-sm) var(--spacing-md);
          border-radius: var(--border-radius);
          font-weight: 600;
          font-size: 1rem;
          display: inline-block;
        }
        .status-success {
          background-color: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }
        .status-error {
          background-color: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }
        @media (max-width: 768px) {
          .page-header {
            flex-direction: column;
            align-items: stretch;
          }
          .result-header {
            flex-direction: column;
            gap: var(--spacing-sm);
            align-items: stretch;
          }
          .result-tabs {
            overflow-x: auto;
          }
          .tab-btn {
            white-space: nowrap;
            flex-shrink: 0;
          }
          .test-form {
            gap: var(--spacing-sm);
          }
        }
      `}</style>
    </div>
  );
};

export default WebhookTester;