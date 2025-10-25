import React, { useState } from 'react';
import { API_BASE, API_ENDPOINTS, LOCAL_STORAGE_KEYS, UI_STRINGS } from '../constants';

interface Rule {
  id: string;
  condition: string;
  action: 'approve' | 'hold' | 'block';
  enabled: boolean;
}

interface TestResult {
  results: {
    email?: any;
    phone?: any;
    address?: any;
    name?: any;
  };
  request_id: string;
}

interface RuleTestResult {
  ruleId: string;
  condition: string;
  action: string;
  triggered: boolean;
  details: string;
}

const Rules: React.FC = () => {
  const [rules, setRules] = useState<Rule[]>([
    {
      id: 'invalid_address_non_us',
      condition: 'invalid_address AND country != "US"',
      action: 'hold',
      enabled: true,
    },
  ]);
  const [testPayload, setTestPayload] = useState(`{
  "email": "test@example.com",
  "phone": "+1234567890",
  "address": {
    "line1": "123 Main St",
    "city": "Anytown",
    "state": "CA",
    "postal_code": "12345",
    "country": "US"
  },
  "name": "John Doe"
}`);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [ruleTestResults, setRuleTestResults] = useState<RuleTestResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const evaluateCondition = (condition: string, payload: TestResult['results']): boolean => {
    // Simple condition evaluator for demo
    // In production, this should be more robust

    const conditions = condition.split(' AND ').map(c => c.trim());

    for (const cond of conditions) {
      if (cond.includes('invalid_address')) {
        const addressValid = payload.address?.valid ?? true;
        if (addressValid) return false;
      }
      if (cond.includes('country != "US"')) {
        const country = payload.address?.normalized?.country || payload.address?.country;
        if (country === 'US') return false;
      }
      // Add more conditions as needed
    }

    return true;
  };

  const handleTestRule = async () => {
    setLoading(true);
    setError(null);
    try {
      let payload;
      try {
        payload = JSON.parse(testPayload);
      } catch {
        throw new Error(UI_STRINGS.INVALID_JSON);
      }

      const token = localStorage.getItem(LOCAL_STORAGE_KEYS.AUTH_TOKEN);
      const response = await fetch(`${API_BASE}${API_ENDPOINTS.TEST_RULES_AGAINST_PAYLOAD}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result: TestResult = await response.json();
      setTestResult(result);

      // Evaluate rules against the results
      const ruleResults: RuleTestResult[] = rules
        .filter(rule => rule.enabled)
        .map(rule => {
          const triggered = evaluateCondition(rule.condition, result.results);
          return {
            ruleId: rule.id,
            condition: rule.condition,
            action: rule.action,
            triggered,
            details: triggered ? `Rule triggered: ${rule.condition}` : `Rule not triggered: ${rule.condition}`,
          };
        });

      setRuleTestResults(ruleResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : UI_STRINGS.UNEXPECTED_ERROR);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRules = async () => {
    try {
      const token = localStorage.getItem(LOCAL_STORAGE_KEYS.AUTH_TOKEN);
      const response = await fetch(`${API_BASE}/rules`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ rules }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      alert(UI_STRINGS.RULE_SAVED);
    } catch (err) {
      alert(`Failed to save rules: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      <header className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{UI_STRINGS.RULES_EDITOR}</h2>
        <p className="mt-2 text-gray-600 dark:text-gray-400 text-sm">
          Configure automated decision rules for order evaluation. Define conditions and actions to approve, hold, or block orders based on validation results.
        </p>
      </header>

      <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6 mb-8">
        <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-6">{UI_STRINGS.RULE_EDITOR}</h3>
        <div className="space-y-6 mb-6">
          {rules.map((rule, index) => (
            <div key={rule.id} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-4 items-end p-4 border border-gray-200 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700">
              <div className="flex flex-col">
                <label className="text-sm font-medium text-gray-700 mb-1">{UI_STRINGS.RULE_CONDITION}</label>
                <input
                  id={`rule-condition-${index}`}
                  type="text"
                  value={rule.condition}
                  onChange={(e) => {
                    const newRules = [...rules];
                    newRules[index].condition = e.target.value;
                    setRules(newRules);
                  }}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                />
              </div>
              <div className="flex flex-col">
                <label className="text-sm font-medium text-gray-700 mb-1">{UI_STRINGS.RULE_ACTION}</label>
                <select
                  value={rule.action}
                  onChange={(e) => {
                    const newRules = [...rules];
                    newRules[index].action = e.target.value as 'approve' | 'hold' | 'block';
                    setRules(newRules);
                  }}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                >
                  <option value="approve">Approve</option>
                  <option value="hold">Hold</option>
                  <option value="block">Block</option>
                </select>
              </div>
              <div className="flex items-center h-10">
                <label className="flex items-center space-x-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => {
                      const newRules = [...rules];
                      newRules[index].enabled = e.target.checked;
                      setRules(newRules);
                    }}
                    className="rounded border-gray-300 text-indigo-600 shadow-sm focus:border-indigo-300 focus:ring focus:ring-offset-0 focus:ring-indigo-200 focus:ring-opacity-50"
                  />
                  <span>Enabled</span>
                </label>
              </div>
            </div>
          ))}
        </div>
        <button onClick={handleSaveRules} className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
          {UI_STRINGS.SAVE_RULES}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6">
        <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-6">{UI_STRINGS.TEST_HARNESS}</h3>
        <div className="space-y-6">
          <div>
            <label htmlFor="test-payload" className="block text-sm font-medium text-gray-700">{UI_STRINGS.TEST_PAYLOAD} (JSON)</label>
            <textarea
              id="test-payload"
              value={testPayload}
              onChange={(e) => setTestPayload(e.target.value)}
              rows={10}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm font-mono"
            />
          </div>
          <button onClick={handleTestRule} className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed" disabled={loading}>
            {loading ? 'Testing...' : UI_STRINGS.TEST_RULE}
          </button>
        </div>

        {error && (
          <div className="mt-6 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-md" role="alert">
            <strong>Error:</strong> {error}
          </div>
        )}

        {ruleTestResults.length > 0 && (
          <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h4 className="text-base font-medium text-gray-900 mb-4">{UI_STRINGS.RULE_TEST_RESULT}</h4>
            <div className="space-y-2">
              {ruleTestResults.map((result, index) => (
                <div key={index} className={`p-3 rounded-md text-sm ${result.triggered ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                  <strong>{result.ruleId}:</strong> {result.details}
                  {result.triggered && <span className="font-bold ml-2">→ {result.action}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {testResult && (
          <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h4 className="text-base font-medium text-gray-900 mb-4">Validation Results</h4>
            <pre className="bg-gray-800 text-white p-4 rounded-md overflow-x-auto text-sm">{JSON.stringify(testResult.results, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default Rules;