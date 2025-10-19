import React, { useState } from 'react';
import { API_BASE, API_ENDPOINTS, UI_STRINGS } from '../constants';

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

      const token = localStorage.getItem('auth_token');
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
    // For now, just show success
    alert(UI_STRINGS.RULE_SAVED);
  };

  return (
    <div className="rules-editor">
      <header className="page-header">
        <h2>{UI_STRINGS.RULES_EDITOR}</h2>
      </header>

      <div className="editor-section">
        <h3>{UI_STRINGS.RULE_EDITOR}</h3>
        <div className="rules-list">
          {rules.map((rule, index) => (
            <div key={rule.id} className="rule-item">
              <div className="rule-condition">
                <label>{UI_STRINGS.RULE_CONDITION}</label>
                <input
                  type="text"
                  value={rule.condition}
                  onChange={(e) => {
                    const newRules = [...rules];
                    newRules[index].condition = e.target.value;
                    setRules(newRules);
                  }}
                />
              </div>
              <div className="rule-action">
                <label>{UI_STRINGS.RULE_ACTION}</label>
                <select
                  value={rule.action}
                  onChange={(e) => {
                    const newRules = [...rules];
                    newRules[index].action = e.target.value as 'approve' | 'hold' | 'block';
                    setRules(newRules);
                  }}
                >
                  <option value="approve">Approve</option>
                  <option value="hold">Hold</option>
                  <option value="block">Block</option>
                </select>
              </div>
              <div className="rule-enabled">
                <label>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => {
                      const newRules = [...rules];
                      newRules[index].enabled = e.target.checked;
                      setRules(newRules);
                    }}
                  />
                  Enabled
                </label>
              </div>
            </div>
          ))}
        </div>
        <button onClick={handleSaveRules} className="btn btn-primary">
          {UI_STRINGS.SAVE_RULES}
        </button>
      </div>

      <div className="test-harness">
        <h3>{UI_STRINGS.TEST_HARNESS}</h3>
        <div className="test-form">
          <div className="form-group">
            <label htmlFor="test-payload">{UI_STRINGS.TEST_PAYLOAD} (JSON)</label>
            <textarea
              id="test-payload"
              value={testPayload}
              onChange={(e) => setTestPayload(e.target.value)}
              rows={10}
            />
          </div>
          <button onClick={handleTestRule} className="btn btn-primary" disabled={loading}>
            {loading ? 'Testing...' : UI_STRINGS.TEST_RULE}
          </button>
        </div>

        {error && (
          <div className="alert alert-danger">
            <strong>Error:</strong> {error}
          </div>
        )}

        {ruleTestResults.length > 0 && (
          <div className="test-results">
            <h4>{UI_STRINGS.RULE_TEST_RESULT}</h4>
            <div className="results-list">
              {ruleTestResults.map((result, index) => (
                <div key={index} className={`result-item ${result.triggered ? 'triggered' : 'not-triggered'}`}>
                  <strong>{result.ruleId}:</strong> {result.details}
                  {result.triggered && <span className="action"> → {result.action}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {testResult && (
          <div className="validation-results">
            <h4>Validation Results</h4>
            <pre>{JSON.stringify(testResult.results, null, 2)}</pre>
          </div>
        )}
      </div>

      <style>{`
        .rules-editor {
          max-width: 1200px;
          margin: 0 auto;
          padding: var(--spacing-md);
        }
        .page-header {
          margin-bottom: var(--spacing-xl);
        }
        .editor-section, .test-harness {
          background: var(--bg-secondary);
          border-radius: var(--border-radius-lg);
          padding: var(--spacing-lg);
          margin-bottom: var(--spacing-xl);
          border: 1px solid var(--border-color);
        }
        .rules-list {
          margin-bottom: var(--spacing-lg);
        }
        .rule-item {
          display: grid;
          grid-template-columns: 1fr 150px 100px;
          gap: var(--spacing-md);
          align-items: end;
          padding: var(--spacing-md);
          border: 1px solid var(--border-color);
          border-radius: var(--border-radius);
          margin-bottom: var(--spacing-md);
          background: var(--bg-primary);
        }
        .rule-condition, .rule-action, .rule-enabled {
          display: flex;
          flex-direction: column;
        }
        .rule-condition input {
          flex: 1;
        }
        .form-group {
          margin-bottom: var(--spacing-md);
        }
        .form-group label {
          display: block;
          margin-bottom: var(--spacing-xs);
          font-weight: 500;
        }
        .form-group textarea {
          width: 100%;
          padding: var(--spacing-sm);
          border: 1px solid var(--border-color);
          border-radius: var(--border-radius);
          font-family: monospace;
          min-height: 200px;
        }
        .btn {
          padding: var(--spacing-sm) var(--spacing-md);
          border: none;
          border-radius: var(--border-radius);
          cursor: pointer;
          font-weight: 500;
        }
        .btn-primary {
          background: #007bff;
          color: white;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .alert {
          padding: var(--spacing-md);
          border-radius: var(--border-radius);
          margin-top: var(--spacing-md);
        }
        .alert-danger {
          background: #f8d7da;
          border: 1px solid #f5c6cb;
          color: #721c24;
        }
        .test-results {
          margin-top: var(--spacing-lg);
          padding: var(--spacing-md);
          background: var(--bg-primary);
          border-radius: var(--border-radius);
          border: 1px solid var(--border-color);
        }
        .results-list {
          margin-top: var(--spacing-md);
        }
        .result-item {
          padding: var(--spacing-sm);
          margin-bottom: var(--spacing-xs);
          border-radius: var(--border-radius);
        }
        .result-item.triggered {
          background: #d4edda;
          border: 1px solid #c3e6cb;
          color: #155724;
        }
        .result-item.not-triggered {
          background: #f8f9fa;
          border: 1px solid var(--border-color);
        }
        .action {
          font-weight: bold;
          margin-left: var(--spacing-sm);
        }
        .validation-results {
          margin-top: var(--spacing-lg);
          padding: var(--spacing-md);
          background: var(--bg-primary);
          border-radius: var(--border-radius);
          border: 1px solid var(--border-color);
        }
        .validation-results pre {
          background: var(--bg-tertiary);
          padding: var(--spacing-md);
          border-radius: var(--border-radius);
          overflow-x: auto;
        }
      `}</style>
    </div>
  );
};

export default Rules;