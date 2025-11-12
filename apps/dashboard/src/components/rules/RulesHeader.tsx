import React from 'react';
interface RulesHeaderProps {
    onExport: () => void;
    onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onSave: () => void;
    saveStatus: 'idle' | 'saving' | 'saved' | 'error';
    backendError?: string | null;
    hasValidationErrors?: boolean;
}
export const RulesHeader: React.FC<RulesHeaderProps> = ({ onExport, onImport, onSave, saveStatus, backendError, hasValidationErrors }) => {
    return (
        <header className="mb-8">
            <div className="flex justify-between items-start">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Rules Engine</h2>
                    <p className="mt-2 text-gray-600 dark:text-gray-400 text-sm">
                        Configure automated decision rules for order evaluation. Rules are evaluated in priority order.
                    </p>
                    {backendError && (
                        <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                            <div className="flex">
                                <svg className="w-5 h-5 text-red-400 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                                <div>
                                    <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error saving rules</h3>
                                    <p className="text-sm text-red-700 dark:text-red-300 mt-1">{backendError}</p>
                                </div>
                            </div>
                        </div>
                    )}
                    {hasValidationErrors && !backendError && (
                        <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
                            <div className="flex">
                                <svg className="w-5 h-5 text-amber-400 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                <div>
                                    <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">Please fix validation errors</h3>
                                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">All rules must have a description before saving. Check the rules below for missing descriptions.</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex space-x-2">
                    <button onClick={onExport} className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md transition-colors" title="Export custom rules only">
                        Export Custom
                    </button>
                    <label className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md transition-colors cursor-pointer" title="Import custom rules">
                        Import Custom
                        <input type="file" accept=".json" onChange={onImport} className="hidden" />
                    </label>
                    <button
                        onClick={onSave}
                        className={`px-4 py-2 text-sm font-medium rounded-md text-white transition-colors ${
                            saveStatus === 'saving' ? 'bg-gray-400' :
                            saveStatus === 'saved' ? 'bg-green-600' :
                            saveStatus === 'error' ? 'bg-red-600' :
                            hasValidationErrors ? 'bg-gray-400' : 'bg-indigo-600 hover:bg-indigo-700'
                        }`}
                        disabled={saveStatus === 'saving' || hasValidationErrors}
                        title="Save custom rules to backend"
                    >
                        {saveStatus === 'saving' ? 'Saving...' :
                            saveStatus === 'saved' ? '✓ Saved' :
                                saveStatus === 'error' ? '✗ Error' :
                                    hasValidationErrors ? 'Fix Errors' : 'Save Rules'}
                    </button>
                </div>
            </div>
        </header >
    );
};