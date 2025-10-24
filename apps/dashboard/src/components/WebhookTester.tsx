import { createApiClient } from '@orbitcheck/contracts';
import React, { useState } from 'react';
import { API_BASE, UI_STRINGS } from '../constants';

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
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div>
        <label htmlFor="webhook-url" className="block text-sm font-medium text-gray-700">Webhook URL</label>
        <input
          id="webhook-url"
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://your-webhook-url.com/endpoint"
          required
          className="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        />
      </div>

      <div>
        <label htmlFor="payload-type" className="block text-sm font-medium text-gray-700">Payload Type</label>
        <select
          id="payload-type"
          value={payloadType}
          onChange={(e) => onPayloadTypeChange(e.target.value as 'validation' | 'order' | 'custom')}
          className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
        >
          <option value="validation">Validation Result</option>
          <option value="order">Order Evaluation</option>
          <option value="custom">Custom Payload</option>
        </select>
      </div>

      {payloadType === 'custom' && (
        <div>
          <label htmlFor="custom-payload" className="block text-sm font-medium text-gray-700">Custom Payload (JSON)</label>
          <textarea
            id="custom-payload"
            value={customPayload}
            onChange={(e) => onCustomPayloadChange(e.target.value)}
            placeholder='{"event": "custom", "data": "your data"}'
            rows={6}
            className="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm font-mono"
          />
        </div>
      )}

      <div>
        <button type="submit" className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50" disabled={loading}>
          {loading ? (
            <>
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {UI_STRINGS.SENDING}
            </>
          ) : (
            UI_STRINGS.SEND_TEST_PAYLOAD
          )}
        </button>
      </div>
    </form>
  );

const RequestTab: React.FC<{ result: WebhookTestResult }> = ({ result }) => (
  <div className="p-6 space-y-6">
    <div>
      <h4 className="text-lg font-medium text-gray-900">{UI_STRINGS.SENT_TO}</h4>
      <p className="mt-1 text-sm text-gray-600 break-all"><code>{result.sent_to}</code></p>
    </div>
    <div>
      <h4 className="text-lg font-medium text-gray-900">{UI_STRINGS.PAYLOAD}</h4>
      <pre className="mt-1 p-3 bg-gray-50 rounded-md text-sm text-gray-800 overflow-x-auto">{JSON.stringify(result.payload, null, 2)}</pre>
    </div>
  </div>
);

const ResponseTab: React.FC<{ result: WebhookTestResult }> = ({ result }) => (
  <div className="p-6 space-y-6">
    <div>
      <h4 className="text-lg font-medium text-gray-900">{UI_STRINGS.STATUS}</h4>
      <div className={`mt-1 inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${result.response.status >= 200 && result.response.status < 300 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
        {result.response.status} {result.response.status_text}
      </div>
    </div>
    <div>
      <h4 className="text-lg font-medium text-gray-900">{UI_STRINGS.HEADERS}</h4>
      <pre className="mt-1 p-3 bg-gray-50 rounded-md text-sm text-gray-800 overflow-x-auto">{JSON.stringify(result.response.headers, null, 2)}</pre>
    </div>
    <div>
      <h4 className="text-lg font-medium text-gray-900">{UI_STRINGS.BODY}</h4>
      <pre className="mt-1 p-3 bg-gray-50 rounded-md text-sm text-gray-800 overflow-x-auto">{result.response.body}</pre>
    </div>
    <div>
      <h4 className="text-lg font-medium text-gray-900">{UI_STRINGS.REQUEST_ID}</h4>
      <p className="mt-1 text-sm text-gray-600 break-all"><code>{result.request_id}</code></p>
    </div>
  </div>
);

const ResultTabs: React.FC<{
  result: WebhookTestResult;
  activeTab: 'request' | 'response';
  onTabChange: (tab: 'request' | 'response') => void;
  onClear: () => void;
}> = ({ result, activeTab, onTabChange, onClear }) => (
  <div id="result-section" className="mt-8 bg-white dark:bg-gray-800 shadow-lg rounded-lg overflow-hidden">
    <div className="px-4 py-5 sm:px-6 flex justify-between items-center border-b border-gray-200 dark:border-gray-600">
      <h3 className="text-lg leading-6 font-medium text-gray-900">{UI_STRINGS.TEST_RESULT}</h3>
      <button onClick={onClear} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">{UI_STRINGS.CLEAR}</button>
    </div>

    <div>
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          <button
            className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'request' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            onClick={() => onTabChange('request')}
          >
            {UI_STRINGS.REQUEST}
          </button>
          <button
            className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'response' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            onClick={() => onTabChange('response')}
          >
            {UI_STRINGS.RESPONSE}
          </button>
        </nav>
      </div>
    </div>

    <div id="tab-content">
      {activeTab === 'request' ? (
        <RequestTab result={result} />
      ) : (
        <ResponseTab result={result} />
      )}
    </div>
  </div>
);

const WebhookTester: React.FC = () => {
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
        baseURL: API_BASE
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
    <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8">
      <header className="mb-8">
        <h2 className="text-3xl font-extrabold text-gray-900">{UI_STRINGS.WEBHOOK_TESTER}</h2>
      </header>

      <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg p-6">
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
        <div className="mt-6 bg-red-50 border-l-4 border-red-400 p-4" role="alert">
          <div className="flex">
            <div className="py-1">
              <svg className="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-700">
                <strong>Error:</strong> {error}
              </p>
            </div>
          </div>
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
    </div>
  );
};

export default WebhookTester;