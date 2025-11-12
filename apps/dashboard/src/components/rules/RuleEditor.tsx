import React, { useCallback, useState } from 'react';
import { Rule } from '../../types';
interface RuleEditorProps {
    rule: Rule;
    onUpdate: (rule: Rule) => void;
    onDelete: (ruleId: string) => void;
    onDuplicate: (ruleId: string) => void;
    onValidationChange?: (ruleId: string, hasError: boolean) => void;
}

export const RuleEditor: React.FC<RuleEditorProps> = ({ rule, onUpdate, onDelete, onDuplicate, onValidationChange }) => {
    // All rules are collapsed by default for better organization
    const [expanded, setExpanded] = useState(false);
    const [conditionError, setConditionError] = useState<string | null>(null);
    const [nameError, setNameError] = useState<string | null>(null);
    const [descriptionError, setDescriptionError] = useState<string | null>(null);

    const validateCondition = useCallback((condition: string) => {
        if (!condition.trim()) {
            setConditionError('Condition cannot be empty');
            onValidationChange?.(rule.id, true);
            return false;
        }
        setConditionError(null);
        onValidationChange?.(rule.id, false);
        return true;
    }, [rule.id, onValidationChange]);

    const validateName = useCallback((name: string) => {
        if (!name.trim()) {
            setNameError('Rule name is required');
            onValidationChange?.(rule.id, true);
            return false;
        }
        setNameError(null);
        onValidationChange?.(rule.id, false);
        return true;
    }, [rule.id, onValidationChange]);

    const validateDescription = useCallback((description: string) => {
        if (!description.trim()) {
            setDescriptionError('Description is required');
            onValidationChange?.(rule.id, true);
            return false;
        }
        setDescriptionError(null);
        onValidationChange?.(rule.id, false);
        return true;
    }, [rule.id, onValidationChange]);

    const handleConditionChange = (value: string) => {
        validateCondition(value);
        onUpdate({ ...rule, condition: value });
    };
    return (
        <div className={`border rounded-lg shadow-sm transition-shadow ${rule.isBuiltIn
            ? 'border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20'
            : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:shadow-md'
            }`}>
            <div className="p-4">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <div className="flex items-center space-x-2">
                            {rule.isBuiltIn ? (
                                // Read-only display for builtin rules
                                <div className="flex items-center space-x-2">
                                    <span className="text-lg font-semibold text-gray-700 dark:text-gray-300">{rule.name}</span>
                                    <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                        Built-in
                                    </span>
                                </div>
                            ) : (
                                // Editable input for custom rules
                                <>
                                    <input
                                        type="text"
                                        value={rule.name}
                                        onChange={(e) => {
                                            const newName = e.target.value;
                                            onUpdate({ ...rule, name: newName });
                                            validateName(newName);
                                        }}
                                        placeholder="Rule name"
                                        className={`text-lg font-semibold bg-transparent border-none focus:outline-none focus:ring-2 rounded px-2 py-1 ${nameError ? 'focus:ring-red-500' : 'focus:ring-indigo-500'
                                            }`}
                                    />
                                    {nameError && (
                                        <span className="text-red-500 text-sm" title={nameError}>
                                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                            </svg>
                                        </span>
                                    )}
                                    <span className="text-red-500 text-sm">*</span>
                                </>
                            )}
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${rule.enabled ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'}`}>
                                {rule.enabled ? 'Active' : 'Inactive'}
                            </span>
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${rule.action === 'approve' ? 'bg-blue-100 text-blue-800' : rule.action === 'hold' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                                {rule.action}
                            </span>
                        </div>
                        {!rule.isBuiltIn && !rule.description && !nameError && (
                            <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                                <span className="inline-flex items-center">
                                    <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                    Description is required before saving
                                </span>
                            </p>
                        )}
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{rule.description}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                        <button
                            onClick={() => setExpanded(!expanded)}
                            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                            aria-label={expanded ? "Collapse" : "Expand"}
                        >
                            <svg className={`w-5 h-5 transform transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                        {!rule.isBuiltIn && (
                            <>
                                <button
                                    onClick={() => onDuplicate(rule.id)}
                                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                                    aria-label="Duplicate rule"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                </button>
                                <button
                                    onClick={() => onDelete(rule.id)}
                                    className="p-2 hover:bg-red-100 dark:hover:bg-red-900 rounded transition-colors text-red-600 dark:text-red-400"
                                    aria-label="Delete rule"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                            </>
                        )}
                    </div>
                </div >


                {
                    expanded && (
                        <div className="mt-4 space-y-4 border-t pt-4">
                            {rule.isBuiltIn ? (
                                // Read-only display for builtin rules
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                            Description
                                        </label>
                                        <div className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-600 rounded-md text-gray-600 dark:text-gray-300">
                                            {rule.description || 'No description available'}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                            Condition
                                        </label>
                                        <textarea
                                            value={rule.condition}
                                            readOnly
                                            rows={3}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md font-mono text-sm bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                Action
                                            </label>
                                            <div className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-600 rounded-md text-gray-600 dark:text-gray-300">
                                                {rule.action}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                Priority
                                            </label>
                                            <div className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-600 rounded-md text-gray-600 dark:text-gray-300">
                                                {rule.priority}
                                            </div>
                                        </div>
                                        <div className="flex items-end">
                                            <label className="flex items-center space-x-2">
                                                <input
                                                    type="checkbox"
                                                    checked={rule.enabled}
                                                    readOnly
                                                    className="rounded border-gray-300 text-indigo-600 bg-gray-100 cursor-not-allowed"
                                                />
                                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Enabled</span>
                                            </label>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                // Editable fields for custom rules
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                            Description <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={rule.description || ''}
                                            onChange={(e) => {
                                                const newDescription = e.target.value;
                                                onUpdate({ ...rule, description: newDescription });
                                                validateDescription(newDescription);
                                            }}
                                            placeholder="Describe what this rule does"
                                            className={`w-full px-3 py-2 border rounded-md focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 ${descriptionError
                                                ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                                                : 'focus:border-indigo-500'
                                                }`}
                                        />
                                        {descriptionError && (
                                            <p className="mt-1 text-sm text-red-600">{descriptionError}</p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                            Condition
                                        </label>
                                        <textarea
                                            value={rule.condition}
                                            onChange={(e) => handleConditionChange(e.target.value)}
                                            rows={3}
                                            className={`w-full px-3 py-2 border rounded-md font-mono text-sm dark:bg-gray-700 dark:border-gray-600 ${conditionError
                                                ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                                                : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'
                                                }`}
                                            placeholder="e.g., address.valid == false AND address.country != 'US'"
                                        />
                                        {conditionError && (
                                            <p className="mt-1 text-sm text-red-600">{conditionError}</p>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                Action
                                            </label>
                                            <select
                                                value={rule.action}
                                                onChange={(e) => onUpdate({ ...rule, action: e.target.value as Rule['action'] })}
                                                className="w-full px-3 py-2 border rounded-md focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600"
                                            >
                                                <option value="approve">Approve</option>
                                                <option value="hold">Hold for Review</option>
                                                <option value="block">Block</option>
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                Priority
                                            </label>
                                            <input
                                                type="number"
                                                value={rule.priority}
                                                onChange={(e) => onUpdate({ ...rule, priority: parseInt(e.target.value) || 0 })}
                                                min="0"
                                                max="100"
                                                className="w-full px-3 py-2 border rounded-md focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600"
                                            />
                                        </div>

                                        <div className="flex items-end">
                                            <label className="flex items-center space-x-2">
                                                <input
                                                    type="checkbox"
                                                    checked={rule.enabled}
                                                    onChange={(e) => onUpdate({ ...rule, enabled: e.target.checked })}
                                                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Enabled</span>
                                            </label>
                                        </div>
                                    </div>

                                    {rule.tags && rule.tags.length > 0 && (
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                Tags
                                            </label>
                                            <div className="flex flex-wrap gap-2">
                                                {rule.tags.map((tag, i) => (
                                                    <span key={i} className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded-full">
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )
                }
            </div >
        </div >
    );
};