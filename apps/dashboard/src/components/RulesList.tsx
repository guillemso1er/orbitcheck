import React, { useState } from 'react';
import { CONDITION_TEMPLATES } from '../constants';
import { Rule } from '../types';
import { RuleEditor } from './RuleEditor';

interface RulesListProps {
    filteredRules: Rule[];
    totalRulesCount: number;
    onUpdate: (index: number, rule: Rule) => void;
    onDelete: (index: number) => void;
    onDuplicate: (index: number) => void;
    onAdd: (rule?: Partial<Rule>) => void;

    searchTerm: string;
    setSearchTerm: (term: string) => void;
    filterAction: 'all' | Rule['action'];
    setFilterAction: (action: 'all' | Rule['action']) => void;
    showOnlyEnabled: boolean;
    setShowOnlyEnabled: (enabled: boolean) => void;
}

export const RulesList: React.FC<RulesListProps> = ({
    filteredRules, totalRulesCount, onUpdate, onDelete, onDuplicate, onAdd,
    searchTerm, setSearchTerm, filterAction, setFilterAction, showOnlyEnabled, setShowOnlyEnabled
}) => {
    const [showTemplates, setShowTemplates] = useState(false);

    return (
        <>
            {/* Filters and Search */}
            <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg p-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="md:col-span-2">
                        <label className="sr-only">Search rules</label>
                        <div className="relative">
                            <input type="text" placeholder="Search rules..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600" />
                            <svg className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        </div>
                    </div>
                    <div>
                        <select value={filterAction} onChange={(e) => setFilterAction(e.target.value as any)} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600">
                            <option value="all">All Actions</option>
                            <option value="approve">Approve Only</option>
                            <option value="hold">Hold Only</option>
                            <option value="block">Block Only</option>
                        </select>
                    </div>
                    <div className="flex items-center space-x-4">
                        <label className="flex items-center space-x-2"><input type="checkbox" checked={showOnlyEnabled} onChange={(e) => setShowOnlyEnabled(e.target.checked)} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" /> <span className="text-sm">Enabled only</span></label>
                        <button onClick={() => setShowTemplates(!showTemplates)} className="text-sm text-indigo-600 hover:text-indigo-800">{showTemplates ? 'Hide' : 'Show'} Templates</button>
                    </div>
                </div>

                {showTemplates && (
                    <div className="mt-4 pt-4 border-t">
                        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Quick Templates</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {CONDITION_TEMPLATES.map((template, idx) => (
                                <div key={idx} className="p-3 border border-gray-200 dark:border-gray-600 rounded-md hover:border-indigo-300 cursor-pointer group"
                                    onClick={() => onAdd({ name: template.label, description: template.description, condition: template.value, action: 'hold', priority: 5 })}>
                                    <h5 className="font-medium text-sm group-hover:text-indigo-600">{template.label}</h5>
                                    <p className="text-xs text-gray-500 mt-1">{template.description}</p>
                                    <code className="text-xs text-gray-600 dark:text-gray-400 mt-2 block">{template.value}</code>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Rules List */}
            <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6 mb-8">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Rules ({filteredRules.length} of {totalRulesCount})</h3>
                    <button onClick={() => onAdd()} className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        Add Rule
                    </button>
                </div>
                <div className="space-y-4">
                    {filteredRules.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            {searchTerm || filterAction !== 'all' || showOnlyEnabled ? 'No rules match your filters' : 'No rules configured. Click "Add Rule" to get started.'}
                        </div>
                    ) : (
                        filteredRules.map((rule, index) => (
                            <RuleEditor key={`${rule.id}-${index}`} rule={rule} index={index} onUpdate={onUpdate} onDelete={onDelete} onDuplicate={onDuplicate} />
                        ))
                    )}
                </div>
            </div>
        </>
    );
};