import { API_V1_ROUTES, MGMT_V1_ROUTES } from "@orbitcheck/contracts";
import { ConditionTemplate } from "./types";

// API_BASE is defined conditionally to avoid import.meta.env issues during testing
const getApiBase = () => {
  // Vite automatically replaces import.meta.env at build time
  // For session-based auth, use same origin /api path
  return import.meta.env?.VITE_API_BASE ?? '/_api';
};

export const API_BASE = getApiBase();

export const API_ENDPOINTS = {
  API_KEYS: MGMT_V1_ROUTES.API_KEYS.LIST_API_KEYS,
  USAGE: MGMT_V1_ROUTES.DATA.GET_USAGE_STATISTICS,
  LOGS: MGMT_V1_ROUTES.DATA.GET_EVENT_LOGS,
  WEBHOOKS_TEST: MGMT_V1_ROUTES.WEBHOOKS.TEST_WEBHOOK,
  BATCH_VALIDATE: API_V1_ROUTES.BATCH.BATCH_VALIDATE_DATA,
  BATCH_DEDUPE: API_V1_ROUTES.BATCH.BATCH_DEDUPLICATE_DATA,
  GET_JOB_STATUS: API_V1_ROUTES.JOBS.GET_JOB_STATUS,
  ORDER_EVALUATE: API_V1_ROUTES.ORDERS.EVALUATE_ORDER_FOR_RISK_AND_RULES,
  GET_AVAILABLE_RULES: MGMT_V1_ROUTES.RULES.GET_AVAILABLE_RULES,
  TEST_RULES_AGAINST_PAYLOAD: MGMT_V1_ROUTES.RULES.TEST_RULES_AGAINST_PAYLOAD,
  REGISTER_CUSTOM_RULES: MGMT_V1_ROUTES.RULES.REGISTER_CUSTOM_RULES,
} as const;


export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
} as const;

export const UI_STRINGS = {
  LOADING: 'Loading...',
  ERROR_FETCH: 'Failed to fetch',
  ERROR_CREATE: 'Failed to create',
  ERROR_REVOKE: 'Failed to revoke',
  ERROR_SEND: 'Failed to send',
  NO_DATA: 'No data available',
  TOTAL_LOGS: 'Total Logs',
  SHOWING_LOGS: 'Showing {logsLength} of {totalCount} logs',
  EXPORT_CSV: 'Export CSV',
  CREATE_NEW_API_KEY: 'Create New API Key',
  REVOKE: 'Revoke',
  ROTATE: 'Rotate',
  ROTATING: 'Rotating...',
  REVOKE_CONFIRM: 'Are you sure you want to revoke this API key? This action cannot be undone.',
  ROTATE_CONFIRM: 'Rotate this key? This will create a new key and revoke the old one.',
  NEW_KEY_CREATED: 'New API Key Created',
  SAVE_SECURELY: 'Save this securely - it will not be shown again!',
  NO_API_KEYS: 'No API keys found. Create one to get started.',
  YOUR_API_KEYS: 'Your API Keys',
  API_KEYS_MANAGEMENT: 'API Keys Management',
  PERSONAL_ACCESS_TOKENS: 'Personal Access Tokens',
  WEBHOOK_TESTER: 'Webhook Tester',
  SEND_TEST_PAYLOAD: 'Send Test Payload',
  SENDING: 'Sending...',
  URL_REQUIRED: 'URL is required',
  INVALID_JSON: 'Invalid JSON in custom payload',
  TEST_RESULT: 'Test Result',
  CLEAR: 'Clear',
  REQUEST: 'Request',
  RESPONSE: 'Response',
  SENT_TO: 'Sent To',
  PAYLOAD: 'Payload',
  STATUS: 'Status',
  HEADERS: 'Headers',
  BODY: 'Body',
  REQUEST_ID: 'Request ID',
  USAGE_DASHBOARD: 'Usage Dashboard',
  TOTAL_VALIDATIONS: 'Total Validations',
  TOTAL_ORDERS: 'Total Orders',
  CACHE_HIT_RATIO: 'Cache Hit Ratio',
  DAILY_USAGE: 'Daily Usage',
  TOP_REASON_CODES: 'Top Reason Codes',
  LOG_EXPLORER: 'Log Explorer',
  BULK_CSV_TOOL: 'Bulk CSV Tool',
  UPLOAD_CSV_FILE: 'Upload CSV File',
  PROCESS_CSV: 'Process CSV',
  PROCESSING_CSV: 'Processing CSV...',
  DOWNLOAD_RESULTS: 'Download Results',
  CSV_TYPE_CUSTOMERS: 'Customers CSV',
  CSV_TYPE_ORDERS: 'Orders CSV',
  SELECT_CSV_TYPE: 'Select CSV Type',
  API_KEY_LABEL: 'API Key',
  API_KEY_PLACEHOLDER: 'Enter your API key (required for batch processing)',
  API_KEY_REQUIRED: 'API key is required for batch processing',
  API_KEY_HELP: 'Create an API key in the API Keys page to use batch endpoints',
  DRAG_DROP_OR_CLICK: 'Drag and drop a CSV file here, or click to select',
  PROCESSING: 'Processing...',
  JOB_STATUS_PENDING: 'Job queued for processing',
  JOB_STATUS_PROCESSING: 'Processing your data...',
  JOB_STATUS_COMPLETED: 'Processing completed',
  JOB_STATUS_FAILED: 'Processing failed',
  LOGIN: 'Login',
  LOGOUT: 'Logout',
  RULES_EDITOR: 'Rules Editor',
  RULE_EDITOR: 'Rule Editor',
  TEST_HARNESS: 'Test Harness',
  RULE_CONDITION: 'Rule Condition',
  RULE_ACTION: 'Rule Action',
  ADD_RULE: 'Add Rule',
  SAVE_RULES: 'Save Rules',
  TEST_RULE: 'Test Rule',
  TEST_PAYLOAD: 'Test Payload',
  RULE_TEST_RESULT: 'Rule Test Result',
  INVALID_RULE: 'Invalid rule syntax',
  RULE_SAVED: 'Rule saved successfully',
  UNEXPECTED_ERROR: 'An unexpected error occurred. Please try again.',
} as const;

export const API_KEY_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
} as const;

export const ORDER_ACTIONS = {
  APPROVE: 'approve',
  HOLD: 'hold',
  BLOCK: 'block',
} as const;

export const VALIDATION_TYPES = {
  EMAIL: 'email',
  PHONE: 'phone',
  ADDRESS: 'address',
  TAXID: 'taxid',
} as const;

export const PAYLOAD_TYPES = {
  VALIDATION: 'validation',
  ORDER: 'order',
  CUSTOM: 'custom',
} as const;

export const LOG_EXPLORER_DEFAULT_LIMIT = 50 as const;

export const CHART_COLORS = {
  VALIDATIONS: {
    BORDER: 'rgb(75, 192, 192)',
    BACKGROUND: 'rgba(75, 192, 192, 0.2)',
  },
  ORDERS: {
    BORDER: 'rgb(255, 99, 132)',
    BACKGROUND: 'rgba(255, 99, 132, 0.2)',
  },
  REASONS: {
    BACKGROUND: 'rgba(153, 102, 255, 0.6)',
    BORDER: 'rgba(153, 102, 255, 1)',
  },
  CACHE_HIT: {
    BACKGROUND: 'rgba(75, 192, 192, 0.6)',
    BORDER: 'rgba(75, 192, 192, 1)',
  },
  CACHE_MISS: {
    BACKGROUND: 'rgba(255, 99, 132, 0.6)',
    BORDER: 'rgba(255, 99, 132, 1)',
  },
} as const;

export const CSV_HEADERS = {
  LOGS: ['ID', 'Type', 'Endpoint', 'Reason Codes', 'Status', 'Created At', 'Meta'],
} as const;



export const VALIDATION_MESSAGES = {
  INVALID_EMAIL: 'Please enter a valid email address',
  PASSWORD_TOO_SHORT: 'Password must be at least 8 characters long',
  PASSWORD_REQUIRED: 'Password is required',
} as const;

export const ERROR_MESSAGES = {
  FETCH_API_KEYS: `${UI_STRINGS.ERROR_FETCH} API keys`,
  CREATE_API_KEY: `${UI_STRINGS.ERROR_CREATE} API key`,
  REVOKE_API_KEY: `${UI_STRINGS.ERROR_REVOKE} API key`,
  FETCH_USAGE: `${UI_STRINGS.ERROR_FETCH} usage data`,
  FETCH_LOGS: `${UI_STRINGS.ERROR_FETCH} logs`,
  SEND_WEBHOOK: `${UI_STRINGS.ERROR_SEND} test payload`,
  INVALID_SERVER_RESPONSE: 'Invalid response from server',
  UNKNOWN: 'Unknown error',
  UNEXPECTED_ERROR: 'An unexpected error occurred. Please try again.',
  INVALID_JSON: 'Invalid JSON',
} as const;

export const LOCAL_STORAGE_KEYS = {
  USER: 'user',
  THEME: 'theme',
  TEST_PAYLOAD: 'test_payload',
} as const;


export const CONDITION_TEMPLATES: ConditionTemplate[] = [
  { label: 'Invalid US Address', value: 'address.valid == false AND address.country == "US"', description: 'Checks for invalid US addresses' },
  { label: 'High Risk Email', value: 'email.risk_score > 0.7', description: 'Email risk score above threshold' },
  { label: 'Phone Not Reachable', value: 'phone.reachable == false', description: 'Phone number cannot be reached' },
  { label: 'Name Mismatch', value: 'name.confidence < 0.5', description: 'Low confidence in name matching' },
  { label: 'International Order', value: 'address.country != "US"', description: 'Non-US addresses' },
];