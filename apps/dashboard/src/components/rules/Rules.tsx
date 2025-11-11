// src/Rules.tsx
import { deleteCustomRule, getAvailableRules, registerCustomRules, testRulesAgainstPayload } from '@orbitcheck/contracts';
import React, { useEffect, useState } from 'react';
import { LOCAL_STORAGE_KEYS } from '../../constants';
import { useDebounce } from '../../hooks/useDebounce';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { Rule, RuleTestResult, TestResult } from '../../types';
import { apiClient } from '../../utils/api';
import { ConditionEvaluator } from '../../utils/ConditionEvaluator';
import { RulesHeader } from './RulesHeader';
import { RulesList } from './RulesList';
import { TestHarness } from './TestHarness';

// List of built-in rule IDs from the API (rules.constants.ts)
// These rules cannot be deleted, even if they have category: 'custom'
const BUILTIN_RULE_IDS = new Set([
  'email_format',
  'email_mx',
  'email_disposable',
  'po_box_detection',
  'address_postal_mismatch',
  'order_dedupe',
  'high_value_order',
  'high_value_customer_priority',
  'critical_block_rule',
  'custom_domain_block',
  'phone_format',
  'phone_otp',
  'address_validation',
  'address_geocode',
  'high_risk_address',
  'high_value_order_review'
]);

// Custom Confirmation Dialog Component
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


const Rules: React.FC = () => {
  const [rules, setRules] = useState<Rule[]>([]);
  const [builtinRules, setBuiltinRules] = useState<Rule[]>([]);
  const [customRules, setCustomRules] = useState<Rule[]>([]);
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
        const { data, error } = await getAvailableRules({ client: apiClient });

        if (error) {
          if ('error' in error && error.error && 'message' in error.error) {
            throw new Error(error.error.message || 'Failed to load rules');
          } else {
            throw new Error('Failed to load rules');
          }
        }

        const allRules = ((data as any)?.rules || []);

        // Separate builtin and custom rules based on rule ID, not just category
        // Some built-in rules have category: 'custom' but are still built-in
        const customRules = allRules
          .filter((rule: any) => !BUILTIN_RULE_IDS.has(rule.id))
          .map((rule: any) => ({
            id: rule.id!,
            name: rule.name!,
            description: rule.description || '',
            condition: rule.logic || rule.condition || '',
            action: rule.action || 'hold' as const,
            priority: rule.priority || 0,
            enabled: rule.enabled || false,
            createdAt: rule.createdAt || rule.created_at || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isBuiltIn: false,
          }));

        // Built-in rules are identified by their ID
        const builtinRules = allRules
          .filter((rule: any) => BUILTIN_RULE_IDS.has(rule.id))
          .map((rule: any) => ({
            id: rule.id!,
            name: rule.name!,
            description: rule.description || '',
            condition: rule.condition || rule.logic || '',
            action: rule.action || 'hold' as const,
            priority: rule.priority || 0,
            enabled: rule.enabled || false,
            createdAt: rule.createdAt || rule.created_at || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isBuiltIn: true,
          }));

        // Store both types separately for display
        setBuiltinRules(builtinRules);
        setCustomRules(customRules);

        // Keep the main rules state for testing and other operations
        setRules([...builtinRules, ...customRules]);
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
  const [deleteConfirm, setDeleteConfirm] = useState<{
    show: boolean;
    ruleId: string;
    ruleName: string;
  } | null>(null);
  const [filterAction, setFilterAction] = useState<'all' | Rule['action']>('all');
  const [showOnlyEnabled, setShowOnlyEnabled] = useState(false);

  const [testPayload, setTestPayload] = useLocalStorage(LOCAL_STORAGE_KEYS.TEST_PAYLOAD, JSON.stringify({
    email: "test@example.com",
    phone: "+1234567890",
    address: { line1: "123 Main St", city: "Anytown", state: "CA", postal_code: "12345", country: "US" },
    name: "John Doe"
  }, null, 2));
  const debouncedTestPayload = useDebounce(testPayload, 500);

  const handleValidationChange = (ruleId: string, hasError: boolean) => {
    // Use the rule ID for validation tracking
    setValidationErrors(prev => ({
      ...prev,
      [ruleId]: hasError
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
    console.log('New rule added. Save to persist changes.');
  };

  const updateRule = (updatedRule: Rule) => {
    const ruleWithTimestamp = { ...updatedRule, updatedAt: new Date().toISOString() };

    // Update the main rules array
    const newRules = rules.map(r => r.id === updatedRule.id ? ruleWithTimestamp : r);

    // Update custom rules array if it's a custom rule
    const newCustomRules = customRules.map(r => r.id === updatedRule.id ? ruleWithTimestamp : r);

    // Update built-in rules array if it's a built-in rule
    const newBuiltinRules = builtinRules.map(r => r.id === updatedRule.id ? ruleWithTimestamp : r);

    // Update all state arrays
    setRules(newRules);
    setCustomRules(newCustomRules);
    setBuiltinRules(newBuiltinRules);
  };

  const deleteRule = (ruleId: string) => {
    // Find the rule by ID
    const ruleToDelete = rules.find(r => r.id === ruleId);
    if (!ruleToDelete) return;

    // Don't allow deletion of built-in rules
    if (ruleToDelete.isBuiltIn) {
      alert('Built-in rules cannot be deleted. You can only disable them.');
      return;
    }

    const ruleName = ruleToDelete.name;
    setDeleteConfirm({ show: true, ruleId, ruleName });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;

    // Double-check that we're only deleting custom rules
    const ruleToDelete = rules.find(r => r.id === deleteConfirm.ruleId);
    if (ruleToDelete?.isBuiltIn) {
      alert('Built-in rules cannot be deleted. You can only disable them.');
      setDeleteConfirm(null);
      return;
    }

    try {
      // Call the delete API endpoint
      const { error } = await deleteCustomRule({ client: apiClient, path: { id: deleteConfirm.ruleId } });

      if (error) {
        if (typeof error === 'string') {
          throw new Error(error);
        } else {
          throw new Error('Failed to delete rule');
        }
      }

      // Update all local state arrays after successful backend delete
      const ruleId = deleteConfirm.ruleId;
      setRules(rules.filter(r => r.id !== ruleId));
      setCustomRules(customRules.filter(r => r.id !== ruleId));
      setBuiltinRules(builtinRules.filter(r => r.id !== ruleId));

      console.log(`Rule "${deleteConfirm.ruleName}" deleted successfully`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setBackendError(`Failed to delete rule: ${errorMessage}`);
      console.error('Failed to delete rule:', err);
    } finally {
      setDeleteConfirm(null);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirm(null);
  };

  const duplicateRule = (ruleId: string) => {
    const ruleToDuplicate = rules.find(r => r.id === ruleId);
    if (!ruleToDuplicate) return;

    const newRule: Rule = {
      ...ruleToDuplicate,
      id: generateUUID(),
      name: `${ruleToDuplicate.name} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isBuiltIn: false, // Duplicated rules are always custom
    };

    // Add to both rules and customRules arrays
    setRules([newRule, ...rules]);
    setCustomRules([newRule, ...customRules]);
    console.log('Rule duplicated. Save to persist changes.');
  };

  const handleTestRules = async () => {
    setTestingRules(true);
    setTestError(null);
    try {
      const payload = JSON.parse(debouncedTestPayload);
      const { data, error } = await testRulesAgainstPayload({
        client: apiClient,
        body: {
          payload,
          rule_ids: rules.map(r => r.id),
        }
      });

      if (error) {
        throw new Error('Failed to test rules against payload');
      }

      const result: TestResult = data as TestResult;
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
      // Only save custom rules, not built-in rules
      const customRulesToSave = customRules.map(rule => ({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        logic: rule.condition,
        severity: 'high' as const,
        enabled: rule.enabled,
        action: rule.action,
        priority: rule.priority,
      }));

      const { error } = await registerCustomRules({
        client: apiClient,
        body: {
          rules: customRulesToSave
        }
      });

      if (error) {
        throw new Error('Failed to save rules');
      }

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
        builtinRules={builtinRules}
        customRules={customRules}
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

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        show={deleteConfirm !== null}
        title="Delete Rule"
        message={`Are you sure you want to delete the rule "${deleteConfirm?.ruleName}"? This action cannot be undone.`}
        confirmText="Delete Rule"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
};

export default Rules;