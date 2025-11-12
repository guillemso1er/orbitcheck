import React, { useState } from 'react';

interface RulesHelpProps {
  className?: string;
}

export const RulesHelp: React.FC<RulesHelpProps> = ({ className = '' }) => {
  const [activeTab, setActiveTab] = useState<'syntax' | 'fields' | 'operators' | 'examples' | 'actions'>('syntax');

  const tabs = [
    { id: 'syntax' as const, label: 'Syntax Guide', icon: '📝' },
    { id: 'fields' as const, label: 'Available Fields', icon: '🔍' },
    { id: 'operators' as const, label: 'Operators', icon: '⚡' },
    { id: 'examples' as const, label: 'Examples', icon: '💡' },
    { id: 'actions' as const, label: 'Actions', icon: '🎯' },
  ];

  return (
    <div className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm ${className}`}>
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-2">
          <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Rules Help & Documentation</h3>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Learn how to create powerful rules using conditions and available data fields
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8 px-4" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap flex items-center space-x-1 ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="p-4">
        {activeTab === 'syntax' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Condition Syntax</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Rules use boolean expressions to evaluate data. Write conditions that return true or false.
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <h5 className="font-medium text-gray-900 dark:text-white mb-2">Basic Structure</h5>
              <code className="text-sm text-gray-800 dark:text-gray-200 block">
                email.valid === false<br/>
                address.country !== "US"<br/>
                phone.risk_score {'>'} 0.8
              </code>
            </div>

            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Boolean Logic</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                  <h6 className="font-medium text-blue-900 dark:text-blue-200 mb-2">AND (&&)</h6>
                  <code className="text-sm text-blue-800 dark:text-blue-200 block">
                    email.valid === false AND address.po_box === true
                  </code>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">Both conditions must be true</p>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                  <h6 className="font-medium text-green-900 dark:text-green-200 mb-2">OR (||)</h6>
                  <code className="text-sm text-green-800 dark:text-green-200 block">
                    email.disposable === true OR phone.risk_score {'>'} 0.9
                  </code>
                  <p className="text-xs text-green-700 dark:text-green-300 mt-1">Either condition can be true</p>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Best Practices</h4>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-disc list-inside">
                <li>Always test your conditions with the Test Harness</li>
                <li>Use parentheses for complex logic: <code>(A AND B) OR C</code></li>
                <li>Check for field existence before accessing nested properties</li>
                <li>Use exact equality operators (=== and !==) instead of == and !=</li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'fields' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Available Data Fields</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                These are the main data objects you can reference in your conditions:
              </p>
            </div>

            <div className="space-y-4">
              <div className="border border-gray-200 dark:border-gray-600 rounded-lg">
                <div className="bg-gray-50 dark:bg-gray-700 px-4 py-2 border-b border-gray-200 dark:border-gray-600">
                  <h5 className="font-medium text-gray-900 dark:text-white">email</h5>
                  <p className="text-xs text-gray-600 dark:text-gray-400">Email validation and risk assessment data</p>
                </div>
                <div className="p-4 space-y-2">
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">email.valid</code> - Boolean indicating if email format is valid</div>
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">email.disposable</code> - Boolean indicating if email is from a disposable service</div>
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">email.risk_score</code> - Float between 0-1 indicating risk level</div>
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">email.mx_valid</code> - Boolean indicating if MX record exists</div>
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">email.domain</code> - String with the email domain</div>
                </div>
              </div>

              <div className="border border-gray-200 dark:border-gray-600 rounded-lg">
                <div className="bg-gray-50 dark:bg-gray-700 px-4 py-2 border-b border-gray-200 dark:border-gray-600">
                  <h5 className="font-medium text-gray-900 dark:text-white">address</h5>
                  <p className="text-xs text-gray-600 dark:text-gray-400">Address validation and geocoding data</p>
                </div>
                <div className="p-4 space-y-2">
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">address.valid</code> - Boolean indicating if address is valid</div>
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">address.po_box</code> - Boolean indicating if address is a PO Box</div>
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">address.country</code> - String with the country code</div>
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">address.normalized.country</code> - Normalized country code</div>
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">address.postal_mismatch</code> - Boolean indicating postal code mismatch</div>
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">address.geocoded</code> - Boolean indicating if address was successfully geocoded</div>
                </div>
              </div>

              <div className="border border-gray-200 dark:border-gray-600 rounded-lg">
                <div className="bg-gray-50 dark:bg-gray-700 px-4 py-2 border-b border-gray-200 dark:border-gray-600">
                  <h5 className="font-medium text-gray-900 dark:text-white">phone</h5>
                  <p className="text-xs text-gray-600 dark:text-gray-400">Phone number validation data</p>
                </div>
                <div className="p-4 space-y-2">
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">phone.valid</code> - Boolean indicating if phone format is valid</div>
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">phone.risk_score</code> - Float between 0-1 indicating risk level</div>
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">phone.country</code> - String with the phone country code</div>
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">phone.carrier</code> - String with the phone carrier</div>
                </div>
              </div>

              <div className="border border-gray-200 dark:border-gray-600 rounded-lg">
                <div className="bg-gray-50 dark:bg-gray-700 px-4 py-2 border-b border-gray-200 dark:border-gray-600">
                  <h5 className="font-medium text-gray-900 dark:text-white">name</h5>
                  <p className="text-xs text-gray-600 dark:text-gray-400">Name validation data</p>
                </div>
                <div className="p-4 space-y-2">
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">name.valid</code> - Boolean indicating if name format is valid</div>
                  <div><code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">name.suspicious</code> - Boolean indicating if name appears suspicious</div>
                </div>
              </div>
            </div>

            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <h5 className="font-medium text-yellow-800 dark:text-yellow-200 mb-2">Helper Functions</h5>
              <div className="space-y-2">
                <div><code className="text-sm bg-yellow-100 dark:bg-yellow-800 px-2 py-1 rounded">exists(value)</code> - Returns true if value is not null or undefined</div>
                <div><code className="text-sm bg-yellow-100 dark:bg-yellow-800 px-2 py-1 rounded">isEmpty(value)</code> - Returns true if value is null, undefined, or empty object</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'operators' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Comparison Operators</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">===</code>
                    <span className="text-sm text-gray-600 dark:text-gray-400">Equal to</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">!==</code>
                    <span className="text-sm text-gray-600 dark:text-gray-400">Not equal to</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">{'>'}</code>
                    <span className="text-sm text-gray-600 dark:text-gray-400">Greater than</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">{'>= '}</code>
                    <span className="text-sm text-gray-600 dark:text-gray-400">Greater than or equal</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">{'<'}</code>
                    <span className="text-sm text-gray-600 dark:text-gray-400">Less than</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">{'<='}</code>
                    <span className="text-sm text-gray-600 dark:text-gray-400">Less than or equal</span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Logical Operators</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">AND</code>
                    <span className="text-sm text-gray-600 dark:text-gray-400">Both conditions must be true</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">OR</code>
                    <span className="text-sm text-gray-600 dark:text-gray-400">At least one condition must be true</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <code className="text-sm bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">NOT</code>
                    <span className="text-sm text-gray-600 dark:text-gray-400">Inverts the condition</span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-3">String Operations</h4>
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">For string comparisons, use quotes:</p>
                <code className="text-sm text-gray-800 dark:text-gray-200 block">
                  address.country === "US"<br/>
                  email.domain !== "gmail.com"<br/>
                  phone.carrier === "verizon"
                </code>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Operator Precedence</h4>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                <ol className="text-sm text-blue-800 dark:text-blue-200 space-y-1 list-decimal list-inside">
                  <li>Parentheses <code>()</code></li>
                  <li>NOT</li>
                  <li>Comparison operators ({'>'}, {'<'}, {'==='}, {'!=='}, etc.)</li>
                  <li>AND</li>
                  <li>OR</li>
                </ol>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'examples' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Common Rule Examples</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Here are some practical examples you can use as starting points for your own rules:
              </p>
            </div>

            <div className="space-y-4">
              <div className="border border-red-200 dark:border-red-800 rounded-lg">
                <div className="bg-red-50 dark:bg-red-900/20 px-4 py-2 border-b border-red-200 dark:border-red-800">
                  <h5 className="font-medium text-red-900 dark:text-red-200">🚫 Block High Risk Emails</h5>
                  <p className="text-xs text-red-700 dark:text-red-300">Block orders with high-risk email addresses</p>
                </div>
                <div className="p-4">
                  <code className="text-sm bg-gray-100 dark:bg-gray-600 px-3 py-2 rounded block mb-2">
                    email.risk_score {'>'} 0.8
                  </code>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    This will trigger when the email risk score is greater than 0.8 (high risk)
                  </p>
                </div>
              </div>

              <div className="border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <div className="bg-yellow-50 dark:bg-yellow-900/20 px-4 py-2 border-b border-yellow-200 dark:border-yellow-800">
                  <h5 className="font-medium text-yellow-900 dark:text-yellow-200">⚠️ Hold PO Box Orders</h5>
                  <p className="text-xs text-yellow-700 dark:text-yellow-300">Hold orders with PO Box addresses for review</p>
                </div>
                <div className="p-4">
                  <code className="text-sm bg-gray-100 dark:bg-gray-600 px-3 py-2 rounded block mb-2">
                    address.po_box === true
                  </code>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    This will hold any order with a PO Box address for manual review
                  </p>
                </div>
              </div>

              <div className="border border-blue-200 dark:border-blue-800 rounded-lg">
                <div className="bg-blue-50 dark:bg-blue-900/20 px-4 py-2 border-b border-blue-200 dark:border-blue-800">
                  <h5 className="font-medium text-blue-900 dark:text-blue-200">✅ Approve Valid US Orders</h5>
                  <p className="text-xs text-blue-700 dark:text-blue-300">Automatically approve orders with valid US addresses and emails</p>
                </div>
                <div className="p-4">
                  <code className="text-sm bg-gray-100 dark:bg-gray-600 px-3 py-2 rounded block mb-2">
                    email.valid === true AND address.valid === true AND address.country === "US"
                  </code>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    This approves orders only when both email and address are valid and the country is US
                  </p>
                </div>
              </div>

              <div className="border border-green-200 dark:border-green-800 rounded-lg">
                <div className="bg-green-50 dark:bg-green-900/20 px-4 py-2 border-b border-green-200 dark:border-green-800">
                  <h5 className="font-medium text-green-900 dark:text-green-200">🔍 Check Field Existence</h5>
                  <p className="text-xs text-green-700 dark:text-green-300">Check if fields exist before using them</p>
                </div>
                <div className="p-4">
                  <code className="text-sm bg-gray-100 dark:bg-gray-600 px-3 py-2 rounded block mb-2">
                    exists(email) AND email.valid === false
                  </code>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    This safely checks if email exists and is invalid, preventing errors
                  </p>
                </div>
              </div>

              <div className="border border-purple-200 dark:border-purple-800 rounded-lg">
                <div className="bg-purple-50 dark:bg-purple-900/20 px-4 py-2 border-b border-purple-200 dark:border-purple-800">
                  <h5 className="font-medium text-purple-900 dark:text-purple-200">🌍 International Orders</h5>
                  <p className="text-xs text-purple-700 dark:text-purple-300">Handle international orders differently</p>
                </div>
                <div className="p-4">
                  <code className="text-sm bg-gray-100 dark:bg-gray-600 px-3 py-2 rounded block mb-2">
                    address.country !== "US" AND email.disposable === true
                  </code>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Block international orders with disposable email addresses
                  </p>
                </div>
              </div>

              <div className="border border-orange-200 dark:border-orange-800 rounded-lg">
                <div className="bg-orange-50 dark:bg-orange-900/20 px-4 py-2 border-b border-orange-200 dark:border-orange-800">
                  <h5 className="font-medium text-orange-900 dark:text-orange-200">📱 Phone Validation</h5>
                  <p className="text-xs text-orange-700 dark:text-orange-300">Check phone number quality</p>
                </div>
                <div className="p-4">
                  <code className="text-sm bg-gray-100 dark:bg-gray-600 px-3 py-2 rounded block mb-2">
                    exists(phone) AND (phone.valid === false OR phone.risk_score {'>'} 0.7)
                  </code>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Hold orders with invalid phone numbers or high-risk phone numbers
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4">
              <h5 className="font-medium text-indigo-900 dark:text-indigo-200 mb-2">💡 Pro Tips</h5>
              <ul className="text-sm text-indigo-800 dark:text-indigo-200 space-y-1 list-disc list-inside">
                <li>Start simple and gradually add complexity</li>
                <li>Test each condition with the Test Harness before saving</li>
                <li>Use priority numbers to control rule execution order (higher numbers run first)</li>
                <li>Remember that rules stop executing after the first matching condition</li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'actions' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Available Actions</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                When a rule's condition evaluates to true, the specified action is taken:
              </p>
            </div>

            <div className="space-y-4">
              <div className="border border-green-200 dark:border-green-800 rounded-lg">
                <div className="bg-green-50 dark:bg-green-900/20 px-4 py-2 border-b border-green-200 dark:border-green-800">
                  <h5 className="font-medium text-green-900 dark:text-green-200">✅ Approve</h5>
                  <p className="text-xs text-green-700 dark:text-green-300">Automatically approve the order</p>
                </div>
                <div className="p-4">
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                    The order will be automatically approved and proceed to fulfillment.
                  </p>
                  <div className="bg-green-100 dark:bg-green-800 rounded p-3">
                    <p className="text-xs text-green-800 dark:text-green-200 font-medium">Use when:</p>
                    <ul className="text-xs text-green-700 dark:text-green-300 mt-1 space-y-1 list-disc list-inside">
                      <li>All validation checks pass</li>
                      <li>You're confident the order is legitimate</li>
                      <li>You want to automate approval for low-risk orders</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <div className="bg-yellow-50 dark:bg-yellow-900/20 px-4 py-2 border-b border-yellow-200 dark:border-yellow-800">
                  <h5 className="font-medium text-yellow-900 dark:text-yellow-200">⏸️ Hold for Review</h5>
                  <p className="text-xs text-yellow-700 dark:text-yellow-300">Pause the order for manual review</p>
                </div>
                <div className="p-4">
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                    The order will be placed on hold and require manual review before proceeding.
                  </p>
                  <div className="bg-yellow-100 dark:bg-yellow-800 rounded p-3">
                    <p className="text-xs text-yellow-800 dark:text-yellow-200 font-medium">Use when:</p>
                    <ul className="text-xs text-yellow-700 dark:text-yellow-300 mt-1 space-y-1 list-disc list-inside">
                      <li>Orders need additional verification</li>
                      <li>You're uncertain about the legitimacy</li>
                      <li>You want to catch potentially problematic orders</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="border border-red-200 dark:border-red-800 rounded-lg">
                <div className="bg-red-50 dark:bg-red-900/20 px-4 py-2 border-b border-red-200 dark:border-red-800">
                  <h5 className="font-medium text-red-900 dark:text-red-200">🚫 Block</h5>
                  <p className="text-xs text-red-700 dark:text-red-300">Automatically reject the order</p>
                </div>
                <div className="p-4">
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                    The order will be automatically rejected and will not proceed to fulfillment.
                  </p>
                  <div className="bg-red-100 dark:bg-red-800 rounded p-3">
                    <p className="text-xs text-red-800 dark:text-red-200 font-medium">Use when:</p>
                    <ul className="text-xs text-red-700 dark:text-red-300 mt-1 space-y-1 list-disc list-inside">
                      <li>Clear signs of fraudulent activity</li>
                      <li>Violations of business policies</li>
                      <li>High-risk patterns that should be rejected</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <h5 className="font-medium text-blue-900 dark:text-blue-200 mb-2">🎯 Rule Priority</h5>
              <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
                Rules are processed in order of priority (highest number first). Once a rule triggers and takes action, processing stops.
              </p>
              <div className="space-y-1 text-xs text-blue-700 dark:text-blue-300">
                <div>• Priority 100: Highest priority (processed first)</div>
                <div>• Priority 50: Medium priority (processed in middle)</div>
                <div>• Priority 0: Lowest priority (processed last)</div>
              </div>
            </div>

            <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
              <h5 className="font-medium text-purple-900 dark:text-purple-200 mb-2">🔄 Rule Processing Flow</h5>
              <ol className="text-sm text-purple-800 dark:text-purple-200 space-y-1 list-decimal list-inside">
                <li>Rules are sorted by priority (highest first)</li>
                <li>Each rule's condition is evaluated against the order data</li>
                <li>If condition is true, the action is taken and processing stops</li>
                <li>If condition is false, the next rule is evaluated</li>
                <li>If no rules trigger, the order proceeds normally</li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};