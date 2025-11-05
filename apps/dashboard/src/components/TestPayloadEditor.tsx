import React, { useCallback, useEffect, useState } from 'react';

interface TestPayloadEditorProps {
    payload: string;
    onChange: (value: string) => void;
}

export const TestPayloadEditor: React.FC<TestPayloadEditorProps> = ({ payload, onChange }) => {
    const [error, setError] = useState<string | null>(null);

    const formatJSON = () => {
        try {
            const parsed = JSON.parse(payload);
            onChange(JSON.stringify(parsed, null, 2));
            setError(null);
        } catch (e) {
            setError('Invalid JSON format');
        }
    };

    const validateJSON = useCallback((value: string) => {
        try {
            JSON.parse(value);
            setError(null);
        } catch {
            setError('Invalid JSON format');
        }
    }, []);

    useEffect(() => {
        validateJSON(payload);
    }, [payload, validateJSON]);

    const insertTemplate = (template: string) => {
        const templates: { [key: string]: any } = {
            basic: {
                email: "test@example.com",
                phone: "+1234567890",
                address: { line1: "123 Main St", city: "Anytown", state: "CA", postal_code: "12345", country: "US" },
                name: "John Doe"
            },
            international: {
                email: "intl@example.co.uk",
                phone: "+442012345678",
                address: { line1: "10 Downing Street", city: "London", postal_code: "SW1A 2AA", country: "GB" },
                name: "Jane Smith"
            },
            risky: {
                email: "suspicious@temporary-email.com",
                phone: "+1000000000",
                address: { line1: "Invalid Address", city: "Unknown", state: "XX", postal_code: "00000", country: "US" },
                name: "Test User"
            }
        };
        if (templates[template]) {
            onChange(JSON.stringify(templates[template], null, 2));
            setError(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Test Payload (JSON)
                </label>
                <div className="flex space-x-2">
                    <button onClick={() => insertTemplate('basic')} className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded transition-colors">Basic</button>
                    <button onClick={() => insertTemplate('international')} className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded transition-colors">International</button>
                    <button onClick={() => insertTemplate('risky')} className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded transition-colors">Risky</button>
                    <button onClick={formatJSON} className="text-xs px-2 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded transition-colors">Format JSON</button>
                </div>
            </div>
            <div className="relative">
                <textarea
                    value={payload}
                    onChange={(e) => onChange(e.target.value)}
                    rows={12}
                    className={`w-full px-3 py-2 border rounded-md font-mono text-sm dark:bg-gray-700 dark:border-gray-600 ${error
                        ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'
                        }`}
                    spellCheck={false}
                />
                {error && (
                    <p className="absolute -bottom-6 left-0 text-sm text-red-600">{error}</p>
                )}
            </div>
        </div>
    );
};