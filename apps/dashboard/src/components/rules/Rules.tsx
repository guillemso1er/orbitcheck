// src/Rules.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE, API_ENDPOINTS, LOCAL_STORAGE_KEYS } from '../../constants';
import { useDebounce } from '../../hooks/useDebounce';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { Rule, RuleTestResult, TestResult } from '../../types';
import { apiClient } from '../../utils/api';
import { ConditionEvaluator } from '../../utils/ConditionEvaluator';
import { RulesHeader } from './RulesHeader';
import { RulesList } from './RulesList';
import { TestHarness } from './TestHarness';


const Rules: React.FC = () => {
  const [rules, setRules] = useState<Rule[]>([]);
  const [validationErrors, setValidationErrors] = useState<{ [key: number]: boolean }>({});
  const [backendError, setBackendError] = useState<string | null>(null);

  // Generate a proper UUID for backend identification
  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  useEffect(() => {
    const loadRules = async () => {
      try {
        const response = await apiClient.getAvailableRules();
        const customRules = (response.rules || [])
          .filter(rule => rule.id && rule.name && (rule.category === 'custom' || (rule as any).condition || (rule as any).logic))
          .map(rule => ({
            id: rule.id!,
            name: rule.name!,
            description: rule.description || '',
            condition: (rule as any).condition || (rule as any).logic || '',
            action: (rule as any).action || 'hold' as const,
            priority: (rule as any).priority || 0,
            enabled: rule.enabled || false,
            createdAt: (rule as any).createdAt || new Date().toISOString(),
            updatedAt: (rule as any).updatedAt || new Date().toISOString(),
          }));
        setRules(customRules);
      } catch (err) {
        console.error('Failed to load rules:', err);
      }
    };
    loadRules();
  }, []);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [ruleTestResults, setRuleTestResults] = useState<RuleTestResult[]>([]);
  const [testingRules, setTestingRules] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState<'all' | Rule['action']>('all');
  const [showOnlyEnabled, setShowOnlyEnabled] = useState(false);

  const [testPayload, setTestPayload] = useLocalStorage(LOCAL_STORAGE_KEYS.TEST_PAYLOAD, JSON.stringify({
    email: "test@example.com",
    phone: "+1234567890",
    address: { line1: "123 Main St", city: "Anytown", state: "CA", postal_code: "12345", country: "US" },
    name: "John Doe"
  }, null, 2));
  const debouncedTestPayload = useDebounce(testPayload, 500);

  const filteredRules = useMemo(() => {
    return rules
      .filter(rule => {
        const search = searchTerm.toLowerCase();
        const matchesSearch = searchTerm === '' || rule.name.toLowerCase().includes(search) || rule.condition.toLowerCase().includes(search) || rule.description?.toLowerCase().includes(search);
        const matchesAction = filterAction === 'all' || rule.action === filterAction;
        const matchesEnabled = !showOnlyEnabled || rule.enabled;
        return matchesSearch && matchesAction && matchesEnabled;
      })
      .sort((a, b) => b.priority - a.priority);
  }, [rules, searchTerm, filterAction, showOnlyEnabled]);

  const handleValidationChange = (index: number, hasError: boolean) => {
    setValidationErrors(prev => ({
      ...prev,
      [index]: hasError
    }));
  };

  const hasValidationErrors = Object.values(validationErrors).some(error => error);

  const addRule = (newRuleData?: Partial<Rule>) => {
    const newRule: Rule = {
      id: generateUUID(),
      name: `New Rule ${rules.length + 1}`,
      description: '',
      condition: '',
      action: 'hold',
      priority: 0,
      enabled: false,
      createdAt: new Date().toISOString(),
      ...newRuleData,
    };
    setRules([newRule, ...rules]);
  };

  const updateRule = async (index: number, updatedRule: Rule) => {
    const newRules = [...rules];
    const originalIndex = rules.findIndex(r => r.id === filteredRules[index].id);
    if (originalIndex !== -1) {
      const ruleToUpdate = { ...updatedRule, updatedAt: new Date().toISOString() };
      newRules[originalIndex] = ruleToUpdate;

      // Update local state immediately for better UX
      setRules(newRules);

      try {
        // Persist the change to backend
        await apiClient.registerCustomRules({
          rules: newRules.map(rule => ({
            id: rule.id,
            name: rule.name,
            description: rule.description,
            logic: rule.condition,
            severity: 'high' as const,
            enabled: rule.enabled,
            action: rule.action,
            priority: rule.priority,
          }))
        });
      } catch (err) {
        // Revert local state if backend update fails
        setRules(rules);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setBackendError(`Failed to update rule: ${errorMessage}`);
        console.error('Failed to update rule:', err);
      }
    }
  };

  const deleteRule = async (index: number) => {
    if (window.confirm('Are you sure you want to delete this rule?')) {
      const ruleId = filteredRules[index].id;
      const ruleName = filteredRules[index].name;

      // Update local state immediately for better UX
      setRules(rules.filter(r => r.id !== ruleId));

      try {
        // Call the delete API endpoint
        await apiClient.deleteCustomRule(ruleId);
        console.log(`Rule "${ruleName}" deleted successfully`);
      } catch (err) {
        // Revert local state if backend update fails
        setRules(rules);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setBackendError(`Failed to delete rule: ${errorMessage}`);
        console.error('Failed to delete rule:', err);
      }
    }
  };

  const duplicateRule = (index: number) => {
    const ruleToDuplicate = filteredRules[index];
    const newRule: Rule = {
      ...ruleToDuplicate,
      id: generateUUID(),
      name: `${ruleToDuplicate.name} (Copy)`,
      createdAt: new Date().toISOString(),
    };
    setRules([newRule, ...rules]);
  };

  const handleTestRules = async () => {
    setTestingRules(true);
    setTestError(null);
    try {
      const payload = JSON.parse(debouncedTestPayload);
      const token = localStorage.getItem(LOCAL_STORAGE_KEYS.AUTH_TOKEN);
      const response = await fetch(`${API_BASE}${API_ENDPOINTS.TEST_RULES_AGAINST_PAYLOAD}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const result: TestResult = await response.json();
      setTestResult(result);
      const ruleResults: RuleTestResult[] = rules.filter(rule => rule.enabled).map(rule => {
        const startTime = performance.now();
        const evaluation = ConditionEvaluator.evaluate(rule.condition, result.results);
        const evaluationTime = performance.now() - startTime;
        return {
          ruleId: rule.id, ruleName: rule.name, condition: rule.condition, action: rule.action,
          triggered: evaluation.result,
          details: evaluation.error || (evaluation.result ? `✓ Rule triggered` : '✗ Rule not triggered'),
          evaluationTime: Math.round(evaluationTime * 100) / 100,
          error: evaluation.error,
        };
      });
      setRuleTestResults(ruleResults);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setTestingRules(false);
    }
  };

  const handleSaveRules = async () => {
    setBackendError(null);

    if (hasValidationErrors) {
      setSaveStatus('error');
      setBackendError('Please fix all validation errors before saving');
      setTimeout(() => setSaveStatus('idle'), 2000);
      return;
    }

    setSaveStatus('saving');
    try {
      await apiClient.registerCustomRules({
        rules: rules.map(rule => ({
          id: rule.id,
          name: rule.name,
          description: rule.description,
          logic: rule.condition,
          severity: 'high' as const,
          enabled: rule.enabled,
          action: rule.action,
          priority: rule.priority,
        }))
      });
      setSaveStatus('saved');
    } catch (err) {
      setSaveStatus('error');
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setBackendError(`Failed to save rules: ${errorMessage}`);
    } finally {
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  };

  const exportRules = () => {
    const dataStr = JSON.stringify(rules, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', `rules_${new Date().toISOString().split('T')[0]}.json`);
    linkElement.click();
  };

  const importRules = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedRules: Rule[] = JSON.parse(e.target?.result as string);
        if (Array.isArray(importedRules)) { // Add more validation here as needed
          setRules(importedRules);
          alert('Rules imported successfully!');
        } else {
          alert('Invalid rules format');
        }
      } catch {
        alert('Failed to parse rules file');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      <RulesHeader
        onSave={handleSaveRules}
        saveStatus={saveStatus}
        onExport={exportRules}
        onImport={importRules}
        backendError={backendError}
        hasValidationErrors={hasValidationErrors}
      />
      <RulesList
        filteredRules={filteredRules}
        totalRulesCount={rules.length}
        onUpdate={updateRule}
        onDelete={deleteRule}
        onDuplicate={duplicateRule}
        onAdd={addRule}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        filterAction={filterAction}
        setFilterAction={setFilterAction}
        showOnlyEnabled={showOnlyEnabled}
        setShowOnlyEnabled={setShowOnlyEnabled}
        onValidationChange={handleValidationChange}
      />
      <TestHarness
        testPayload={testPayload}
        setTestPayload={setTestPayload}
        onTest={handleTestRules}
        loading={testingRules}
        error={testError}
        ruleTestResults={ruleTestResults}
        testResult={testResult}
      />
    </div>
  );
};

export default Rules;