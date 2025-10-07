import { DASHBOARD_ROUTES } from "@orbicheck/contracts";

export const API_BASE = import.meta.env.VITE_API_BASE ?? '/_api';

export const API_ENDPOINTS = {
  API_KEYS: DASHBOARD_ROUTES.LIST_API_KEYS,
  USAGE: DASHBOARD_ROUTES.GET_USAGE_STATISTICS,
  LOGS: DASHBOARD_ROUTES.GET_EVENT_LOGS,
  WEBHOOKS_TEST: DASHBOARD_ROUTES.TEST_WEBHOOK,
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
  LOGIN: 'Login',
  LOGOUT: 'Logout',
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



export const ERROR_MESSAGES = {
  FETCH_API_KEYS: `${UI_STRINGS.ERROR_FETCH} API keys`,
  CREATE_API_KEY: `${UI_STRINGS.ERROR_CREATE} API key`,
  REVOKE_API_KEY: `${UI_STRINGS.ERROR_REVOKE} API key`,
  FETCH_USAGE: `${UI_STRINGS.ERROR_FETCH} usage data`,
  FETCH_LOGS: `${UI_STRINGS.ERROR_FETCH} logs`,
  SEND_WEBHOOK: `${UI_STRINGS.ERROR_SEND} test payload`,
  UNKNOWN: 'Unknown error',
} as const;