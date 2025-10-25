export const STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
} as const;

export const PLAN_TYPES = {
  DEV: 'dev',
} as const;

export const PROJECT_NAMES = {
  DEFAULT: 'Default Project',
} as const;

export const API_KEY_NAMES = {
  DEFAULT: 'Default API Key',
} as const;

export const API_KEY_PREFIX = 'ok_' as const;

export const API_KEY_PREFIX_LENGTH = 6 as const;

export const RANDOM_BYTES_FOR_API_KEY = 18 as const;

export const JWT_EXPIRES_IN = '7d' as const;

export const PAT_DEFAULT_EXPIRY_DAYS = 90 as const;

export const PAT_SCOPES = {
  KEYS_READ: 'keys:read',
  KEYS_WRITE: 'keys:write',
  LOGS_READ: 'logs:read',
  USAGE_READ: 'usage:read',
  WEBHOOKS_MANAGE: 'webhooks:manage',
  CONNECTORS_MANAGE: 'connectors:manage',
  PATS_MANAGE: 'pats:manage',
  PROJECTS_MANAGE: 'projects:manage',
  RULES_MANAGE: 'rules:manage',
} as const;

export const PAT_ENVIRONMENTS = {
  TEST: 'test',
  LIVE: 'live',
} as const;

export const USER_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  DEVELOPER: 'developer',
  READ_ONLY: 'read-only',
} as const;

export const PG_UNIQUE_VIOLATION = '23505' as const;

export const USAGE_PERIOD = 'month' as const;

export const USAGE_DAYS = 31 as const;

export const LOGS_DEFAULT_LIMIT = 100 as const;

export const LOGS_MAX_LIMIT = 1000 as const;

export const TOP_REASONS_LIMIT = 10 as const;

export const CACHE_HIT_PLACEHOLDER = 0.95 as const;

export const TWILIO_CHANNEL_SMS = 'sms' as const;

export const CONTENT_TYPES = {
  APPLICATION_JSON: 'application/json',
  APPLICATION_X_WWW_FORM_URLENCODED: 'application/x-www-form-urlencoded',
  TEXT_PLAIN: 'text/plain',
} as const;


export const MESSAGES = {
  LOG_ENTRY_NOT_FOUND: 'Log entry not found',
  INVALID_EVENTS: 'Invalid events: ',
  DATA_ERASURE_INITIATED: (compliance: string) => `Data erasure initiated for ${compliance} compliance`,
  LOG_ENTRY_DELETED: 'Log entry deleted successfully',
  SETTINGS_UPDATED: 'Settings updated successfully',
  WEBHOOK_NOT_FOUND: 'Webhook not found',
  API_KEY_REVOKED: 'API key revoked successfully',
  DATABASE_ERROR: 'Database error',
  UNKNOWN_ERROR: 'Unknown error',
  ERASE_INVALID_REQUEST_MESSAGE: 'Reason must be either "gdpr" or "ccpa"',
  INVALID_SERVER_RESPONSE: 'Invalid response from server',
  POSTGRESQL_CONNECTION_FAILED: (error: string) => `FATAL: Could not connect to PostgreSQL. Shutting down. ${error}`,
  REDIS_CONNECTION_FAILED: (error: string) => `FATAL: Could not connect to Redis. Shutting down. ${error}`,
  STARTUP_SMOKE_TEST_FAILED: (statusCode: number, body: string) => `Startup smoke test failed: /health returned ${statusCode}. Body: ${body}`,
  UNSUPPORTED_DEDUPE_TYPE: (type: string) => `Unsupported dedupe type: ${type}`,
  UNSUPPORTED_VALIDATION_TYPE: (type: string) => `Unsupported validation type: ${type}`,
} as const;

export const COMPLIANCE_REASONS = {
  GDPR: 'gdpr',
  CCPA: 'ccpa',
} as const;

export const CRYPTO_KEY_BYTES = 32 as const;
export const CRYPTO_IV_BYTES = 16 as const;

export const AUTHORIZATION_HEADER = 'authorization' as const;

export const BEARER_PREFIX = 'Bearer ' as const;

export const HASH_ALGORITHM = 'sha256' as const;

export const PAT_PREFIX = 'pat_' as const;

export const DEFAULT_PAT_NAME = 'Default PAT' as const;

export const LOGOUT_MESSAGE = 'Logged out successfully' as const;

export const AUDIT_RESOURCE_API = 'api' as const;

export const AUDIT_ACTION_PAT_USED = 'pat_used' as const;

export const PAT_SCOPES_ALL = ['*'] as const;

export const STRIPE_API_VERSION = '2025-09-30.clover' as const;

export const REQUEST_TIMEOUT_MS = 10_000 as const;

export const API_VERSION = '0.1.0' as const;

export const SESSION_MAX_AGE_MS = 604800000;

export const BCRYPT_ROUNDS = 12;

export const HMAC_VALIDITY_MINUTES = 5;

export const RATE_LIMIT_TTL_SECONDS = 60;

export const IDEMPOTENCY_TTL_SECONDS = 86400;

export const WEBHOOK_TEST_ORDER_ID = 'test-order-123' as const;

export const WEBHOOK_TEST_RISK_SCORE = 25 as const;

export const WEBHOOK_TEST_LOW_RISK_TAG = 'low_risk' as const;

export const STRIPE_DEFAULT_SECRET_KEY = 'sk_test_dummy' as const;

export const USER_AGENT_WEBHOOK_TESTER = 'OrbitCheck-Webhook-Tester/1.0' as const;

export const USER_AGENT_WEBHOOK = 'OrbitCheck-Webhook/1.0' as const;

export const USER_AGENT_ADDRESS_VALIDATION = 'Orbitcheck/0.1' as const;

export const SEED_PROJECT_NAME = 'Dev Project' as const;

export const SEED_API_KEY_PREFIX = 'ok_test_' as const;

export const GEO_NAMES_BASE_URL = 'http://download.geonames.org/export/zip' as const;

export const STARTUP_SMOKE_TEST_TIMEOUT_MS = 2000 as const;

export const STARTUP_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 1000 as const;

export const STARTUP_GUARD_REQUEST_TIMEOUT_MS = 30000 as const;

export const STARTUP_GUARD_HANDLER_TIMEOUT_MS = 5000 as const;

export const STARTUP_GUARD_MEMORY_CHECK_INTERVAL_MS = 5000 as const;

export const STARTUP_GUARD_EVENT_LOOP_CHECK_INTERVAL_MS = 100 as const;

export const STARTUP_GUARD_EVENT_LOOP_BLOCK_THRESHOLD_MS = 50 as const;

export const BATCH_SIZE_GEONAMES = 1000 as const;

export const BATCH_SIZE_DISPOSABLE_UPDATE = 5000 as const;

export const VALIDATION_ITEM_LIMIT = 10000 as const;

export const DEDUPE_ITEM_LIMIT = 10000 as const;

export const BCRYPT_MIN_PASSWORD_LENGTH = 8 as const;

export const NAME_MAX_LENGTH = 100 as const;

export const DEDUPE_TYPES = {
  CUSTOMERS: 'customers',
  ADDRESSES: 'addresses',
} as const;

export const ROUTES = {
  // Health and status routes
  HEALTH: '/health',
  READY: '/ready',
  STATUS: '/v1/status',
  DOCUMENTATION: '/documentation',
  REFERENCE: '/reference',
  METRICS: '/metrics',

  // Auth routes (dashboard)
  REGISTER: '/auth/register',
  LOGIN: '/auth/login',
  LOGOUT: '/auth/logout',

  // Management API routes (v1)
  API_KEYS: '/v1/api-keys',
  DATA: '/v1/data',
  LOGS: '/v1/logs',
  RULES: '/v1/rules',
  SETTINGS: '/v1/settings',
  WEBHOOKS: '/v1/webhooks',

  // Runtime API routes (v1)
  DEDUPE: '/v1/dedupe',
  ORDERS: '/v1/orders',
  VALIDATE: '/v1/validate',
  NORMALIZE: '/v1/normalize',
  VERIFY: '/v1/verify',
  BATCH: '/v1/batch',
  JOBS: '/v1/jobs',

  // Dashboard API routes
  DASHBOARD: '/api/dashboard',
} as const;