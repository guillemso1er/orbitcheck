import React from 'react';
import { RuleTestResult, TestResult } from '../types';
import { TestPayloadEditor } from './TestPayloadEditor';

interface TestHarnessProps {
    testPayload: string;
    setTestPayload: (payload: string) => void;
    onTest: () => void;
    loading: boolean;
    error: string | null;
    ruleTestResults: RuleTestResult[];
    testResult: TestResult | null;
}

export const TestHarness: React.FC<TestHarnessProps> = ({ testPayload, setTestPayload, onTest, loading, error, ruleTestResults, testResult }) => {
    const finalDecision =
        ruleTestResults.find(r => r.triggered && r.action === 'block')?.action ||
        ruleTestResults.find(r => r.triggered && r.action === 'hold')?.action ||
        ruleTestResults.find(r => r.triggered && r.action === 'approve')?.action ||
        'No action (pass through)';

    const totalEvaluationTime = ruleTestResults.reduce((sum, r) => sum + r.evaluationTime, 0).toFixed(2);

    return (
        <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-6">Test Harness</h3>
            <TestPayloadEditor payload={testPayload} onChange={setTestPayload} />
            <div className="mt-6">
                <button
                    onClick={onTest}
                    className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={loading || !testPayload.trim()}
                >
                    {loading ? (
                        <><svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>Testing...</>
                    ) : (
                        <><svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Test Rules</>
                    )}
                </button>
            </div>
            {error && (
                <div className="mt-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md" role="alert">
                    <p><strong className="font-medium">Error:</strong> {error}</p>
                </div>
            )}
            {ruleTestResults.length > 0 && (
                <div className="mt-6">
                    <h4 className="text-base font-medium text-gray-900 dark:text-white mb-4">Rule Evaluation Results</h4>
                    <div className="space-y-2">
                        {ruleTestResults.map((result, index) => (
                            <div key={index} className={`p-4 rounded-md border ${result.error ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800' : result.triggered ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-gray-50 border-gray-200 dark:bg-gray-900/20 dark:border-gray-700'}`}>
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="flex items-center space-x-2">
                                            <span className="font-medium">{result.ruleName}</span>
                                            {result.triggered && <span className={`px-2 py-1 text-xs font-medium rounded-full ${result.action === 'approve' ? 'bg-blue-100 text-blue-800' : result.action === 'hold' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>→ {result.action}</span>}
                                        </div>
                                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{result.details}</p>
                                        <code className="text-xs text-gray-500 mt-1 block">{result.condition}</code>
                                    </div>
                                    <span className="text-xs text-gray-500">{result.evaluationTime}ms</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-4 p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md">
                        <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100">Summary: {ruleTestResults.filter(r => r.triggered).length} of {ruleTestResults.length} rules triggered. Final decision: {finalDecision}</p>
                        <p className="text-xs text-gray-500 mt-1">Total evaluation time: {totalEvaluationTime}ms</p>
                    </div>
                </div>
            )}
            {testResult && (
                <div className="mt-6">
                    <h4 className="text-base font-medium text-gray-900 dark:text-white mb-4">API Validation Results</h4>
                    <pre className="bg-gray-900 text-gray-100 p-4 rounded-md overflow-x-auto text-sm max-h-96 overflow-y-auto">{JSON.stringify(testResult.results, null, 2)}</pre>
                    <p className="text-xs text-gray-500 mt-2">Request ID: {testResult.request_id}</p>
                </div>
            )}
        </div>
    );
};