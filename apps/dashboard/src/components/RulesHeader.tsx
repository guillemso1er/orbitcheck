import React from 'react';
interface RulesHeaderProps {
    onExport: () => void;
    onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onSave: () => void;
    saveStatus: 'idle' | 'saving' | 'saved' | 'error';
}
export const RulesHeader: React.FC<RulesHeaderProps> = ({ onExport, onImport, onSave, saveStatus }) => {
    return (
        <header className="mb-8">
            <div className="flex justify-between items-start">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Rules Engine</h2>
                    <p className="mt-2 text-gray-600 dark:text-gray-400 text-sm">
                        Configure automated decision rules for order evaluation. Rules are evaluated in priority order.
                    </p>
                </div>
                <div className="flex space-x-2">
                    <button onClick={onExport} className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md transition-colors">
                        Export
                    </button>
                    <label className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md transition-colors cursor-pointer">
                        Import
                        <input type="file" accept=".json" onChange={onImport} className="hidden" />
                    </label>
                    <button
                        onClick={onSave}
                        className={`px-4 py-2 text-sm font-medium rounded-md text-white transition-colors ${saveStatus === 'saving' ? 'bg-gray-400' : saveStatus === 'saved' ? 'bg-green-600' : saveStatus === 'error' ? 'bg-red-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                        disabled={saveStatus === 'saving'}
                    >
                        {saveStatus === 'saving' ? 'Saving...' :
                            saveStatus === 'saved' ? '✓ Saved' :
                                saveStatus === 'error' ? '✗ Error' :
                                    'Save Rules'}
                    </button>
                </div>
            </div>
        </header >
    );
};