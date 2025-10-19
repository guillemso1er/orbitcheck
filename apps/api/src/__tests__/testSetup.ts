import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';


// --- Reusable Mock Instances ---
export const mockPool = {
  query: jest.fn(),
  end: jest.fn(),
  connect: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({ rows: [{ value: 1 }] }),
    release: jest.fn(),
  }),
};

export const mockRedisInstance = {
  sismember: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  quit: jest.fn(),
  sadd: jest.fn(),
  del: jest.fn(),
  rename: jest.fn(),
  ping: jest.fn().mockResolvedValue('PONG'),
  status: 'ready',
  on: jest.fn(),
  once: jest.fn(),
};

export const mockTwilioInstance = {
  messages: {
    create: jest.fn(),
  },
  verify: {
    v2: {
      services: jest.fn().mockReturnValue({
        verifications: {
          create: jest.fn().mockResolvedValue({ sid: 'test_verify_sid' })
        },
        verificationChecks: {
          create: jest.fn().mockResolvedValue({ status: 'approved' })
        }
      })
    }
  }
};

// Mock session object
export const mockSession = {
  user_id: undefined as string | undefined,
  destroy: jest.fn().mockResolvedValue(undefined),
  save: jest.fn().mockResolvedValue(undefined),
};

// --- Module Mocks ---
jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool),
}));

jest.mock('../environment.js', () => ({
  environment: {
    DATABASE_URL: 'postgres://test',
    REDIS_URL: 'redis://localhost',
    JWT_SECRET: 'test_jwt_secret',
    SESSION_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // 32 bytes hex
    ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // 32 bytes hex
    TWILIO_ACCOUNT_SID: 'test_sid',
    TWILIO_AUTH_TOKEN: 'test_token',
    TWILIO_PHONE_NUMBER: '+15551234567',
    TWILIO_VERIFY_SERVICE_SID: 'test_verify_sid',
    GOOGLE_GEOCODING_KEY: '',
    USE_GOOGLE_FALLBACK: false,
    DISPOSABLE_LIST_URL: 'https://example.com/disposable-domains.json',
    RATE_LIMIT_COUNT: 100,
    RETENTION_DAYS: 90,
    PORT: 3000,
    LOG_LEVEL: 'error',
    SENTRY_DSN: '',
    OIDC_ENABLED: false,
    OIDC_CLIENT_ID: '',
    OIDC_CLIENT_SECRET: '',
    OIDC_PROVIDER_URL: '',
    OIDC_REDIRECT_URI: '',
    STRIPE_SECRET_KEY: 'sk_test_mock',
    STRIPE_BASE_PLAN_PRICE_ID: 'price_base_mock',
    STRIPE_USAGE_PRICE_ID: 'price_usage_mock',
    STRIPE_STORE_ADDON_PRICE_ID: 'price_addon_mock',
    FRONTEND_URL: 'http://localhost:3000',
  }
}));

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedisInstance);
});

jest.mock('@fastify/cookie', () => jest.fn().mockImplementation(() => Promise.resolve()));

jest.mock('@fastify/secure-session', () => jest.fn().mockImplementation(() => Promise.resolve()));

jest.mock('@fastify/cors', () => jest.fn().mockImplementation(() => Promise.resolve()));

jest.mock('@fastify/swagger', () => jest.fn().mockImplementation(() => Promise.resolve()));

jest.mock('@fastify/swagger-ui', () => jest.fn().mockImplementation(() => Promise.resolve()));

jest.mock('twilio', () => jest.fn(() => mockTwilioInstance));

jest.mock('stripe', () => jest.fn(() => ({
  checkout: {
    sessions: {
      create: jest.fn().mockResolvedValue({
        url: 'https://checkout.stripe.com/pay/test_session_id',
        id: 'cs_test_123',
      }),
    },
  },
  billingPortal: {
    sessions: {
      create: jest.fn().mockResolvedValue({
        url: 'https://billing.stripe.com/p/session/test_session_id',
      }),
    },
  },
})));


jest.mock('node:dns/promises', () => ({
  resolveMx: jest.fn(),
  resolve4: jest.fn(),
  resolve6: jest.fn(),
}));

// Mock js-yaml
jest.mock('js-yaml', () => ({
  load: jest.fn().mockReturnValue({
    openapi: '3.0.3',
    info: {
      title: 'OrbiCheck API',
      description: 'API for validation, deduplication, and risk assessment services',
      version: '1.0.0'
    },
    paths: {}
  })
}));

// Mock fs for YAML loading
jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  readFileSync: jest.fn().mockReturnValue('openapi: 3.0.3'),
}));

// Mock contracts
jest.mock('@orbitcheck/contracts', () => ({
  DASHBOARD_ROUTES: {
    REGISTER_NEW_USER: '/auth/register',
    USER_LOGIN: '/auth/login',
    USER_LOGOUT: '/auth/logout',
  },
  MGMT_V1_ROUTES: {
    API_KEYS: {
      CREATE_API_KEY: '/v1/api-keys',
      LIST_API_KEYS: '/v1/api-keys',
      REVOKE_API_KEY: '/v1/api-keys/:id',
    },
    WEBHOOKS: {
      LIST_WEBHOOKS: '/v1/webhooks',
      CREATE_WEBHOOK: '/v1/webhooks',
      DELETE_WEBHOOK: '/v1/webhooks/:id',
      TEST_WEBHOOK: '/v1/webhooks/test',
    },
    DATA: {
      ERASE_USER_DATA: '/v1/data/erase',
      GET_EVENT_LOGS: '/v1/data/logs',
      GET_USAGE_STATISTICS: '/v1/data/usage',
    },
    RULES: {
      GET_AVAILABLE_RULES: '/v1/rules',
      GET_ERROR_CODE_CATALOG: '/v1/rules/error-codes',
      GET_REASON_CODE_CATALOG: '/v1/rules/catalog',
      REGISTER_CUSTOM_RULES: '/v1/rules/register',
      TEST_RULES_AGAINST_PAYLOAD: '/v1/rules/test',
    },
    SETTINGS: {
      GET_TENANT_SETTINGS: '/v1/settings',
      UPDATE_TENANT_SETTINGS: '/v1/settings',
    },
    LOGS: {
      DELETE_LOG_ENTRY: '/v1/logs/:id',
    },
    BILLING: {
      CREATE_STRIPE_CHECKOUT_SESSION: '/v1/billing/checkout',
      CREATE_STRIPE_CUSTOMER_PORTAL_SESSION: '/v1/billing/portal',
    },
  },
  API_V1_ROUTES: {
    BATCH: {
      BATCH_VALIDATE_DATA: '/v1/batch/validate',
      BATCH_DEDUPLICATE_DATA: '/v1/batch/dedupe',
    },
    JOBS: {
      GET_JOB_STATUS: '/v1/jobs/:id',
    },
    NORMALIZE: {
      NORMALIZE_ADDRESS_CHEAP: '/v1/normalize/address',
    },
    VALIDATE: {
      VALIDATE_EMAIL_ADDRESS: '/v1/validate/email',
      VALIDATE_PHONE_NUMBER: '/v1/validate/phone',
      VALIDATE_ADDRESS: '/v1/validate/address',
      VALIDATE_NAME: '/v1/validate/name',
      VALIDATE_TAX_ID: '/v1/validate/tax-id',
    },
    VERIFY: {
      VERIFY_PHONE_OTP: '/v1/verify/phone',
    },
    DEDUPE: {
      DEDUPLICATE_ADDRESS: '/v1/dedupe/address',
      DEDUPLICATE_CUSTOMER: '/v1/dedupe/customer',
      MERGE_DEDUPLICATED_RECORDS: '/v1/dedupe/merge',
    },
    ORDERS: {
      EVALUATE_ORDER_FOR_RISK_AND_RULES: '/v1/orders/evaluate',
    },
  },
}));

jest.mock('../validators/taxid.js', () => ({
  validateTaxId: jest.fn(),
}));

jest.mock('../validators/address.js', () => ({
  validateAddress: jest.fn(),
  normalizeAddress: jest.fn((addr) => Promise.resolve(addr)), // Default to return input
  detectPoBox: jest.fn(),
}));

jest.mock('../validators/phone.js', () => ({
  validatePhone: jest.fn(),
}));

jest.mock('@hapi/address', () => ({
  isEmailValid: jest.fn(),
}));

jest.mock('libphonenumber-js', () => ({
  parsePhoneNumber: jest.fn().mockReturnValue({ isValid: () => true, number: '+15551234567', country: 'US' }),
  parsePhoneNumberWithError: jest.fn().mockReturnValue({ isValid: () => true, number: '+15551234567', country: 'US' }),
}));

jest.mock('tldts', () => ({
  getDomain: jest.fn((domain: string) => domain),
}));

// More comprehensive crypto mock
const actualCrypto = jest.requireActual('node:crypto');
jest.mock('node:crypto', () => ({
  ...actualCrypto,
  randomBytes: jest.fn((size, callback) => {
    const buf = Buffer.from('test' + 'a'.repeat(Math.max(0, size - 4)));
    if (callback) {
      callback(null, buf);
    }
    return buf;
  }),
  createHash: jest.fn().mockImplementation((algo) => {
    const actual = actualCrypto.createHash(algo);
    return {
      update: jest.fn((data) => {
        actual.update(data);
        return { digest: jest.fn((enc) => actual.digest(enc)) };
      }),
      digest: jest.fn((enc) => actual.digest(enc)),
    };
  }),
  createCipheriv: jest.fn().mockImplementation(() => ({
    update: jest.fn().mockReturnValue('encrypted_part1'),
    final: jest.fn().mockReturnValue('encrypted_part2'),
  })),
  createDecipheriv: jest.fn().mockImplementation(() => ({
    update: jest.fn().mockReturnValue('decrypted_part1'),
    final: jest.fn().mockReturnValue('decrypted_part2'),
  })),
  createHmac: jest.fn().mockImplementation(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('mocked_hmac'),
  })),
  randomUUID: jest.fn().mockReturnValue('123e4567-e89b-12d3-a456-426614174000'),
}));

jest.mock('../validators/email.js', () => ({
  validateEmail: jest.fn(),
}));

// Mock bcrypt and jwt for auth tests
jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn(),
}));

// Mock BullMQ
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({}),
  })),
  Worker: jest.fn().mockImplementation(() => ({})),
}));

// Mock node-cron
jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

// Mock Sentry
jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
}));

// Test route registration functions
let registerAuthRoutesFunction: unknown;
let verifySessionFunction: unknown;
let verifyPATFunction: unknown;
let authHookFunction: unknown;
let rateLimitFunction: unknown;
let idempotencyFunction: unknown;
let registerRoutesFunction: unknown;

export const createApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false });

  // Add mock session to request
  app.decorateRequest('session', {
    getter() {
      return mockSession;
    },
    setter(value: any) {
      Object.assign(mockSession, value);
    }
  });

  // Register routes needed for tests
  const { registerAuthRoutes } = await import('../routes/auth.js');
  const { registerApiKeysRoutes } = await import('../routes/api-keys.js');
  const { registerBatchRoutes } = await import('../routes/batch.js');
  const { registerDataRoutes } = await import('../routes/data.js');
  const { registerDedupeRoutes } = await import('../routes/dedupe.js');
  const { registerJobRoutes } = await import('../routes/jobs.js');
  const { registerOrderRoutes } = await import('../routes/orders.js');
  const { registerRulesRoutes } = await import('../routes/rules.js');
  const { registerValidationRoutes } = await import('../routes/validation.js');
  const { registerWebhookRoutes } = await import('../routes/webhook.js');
  const { registerSettingsRoutes } = await import('../routes/settings.js');



  registerAuthRoutes(app, mockPool as any);
  registerApiKeysRoutes(app, mockPool as any);
  registerBatchRoutes(app, mockPool as any, mockRedisInstance as any);
  registerDataRoutes(app, mockPool as any);
  registerDedupeRoutes(app, mockPool as any);
  registerJobRoutes(app, mockPool as any);
  registerOrderRoutes(app, mockPool as any, mockRedisInstance as any);
  registerRulesRoutes(app, mockPool as any, mockRedisInstance as any);
  registerSettingsRoutes(app, mockPool as any);
  registerValidationRoutes(app, mockPool as any, mockRedisInstance as any);
  registerWebhookRoutes(app, mockPool as any);
  const { registerBillingRoutes } = await import('../routes/billing.js');
  registerBillingRoutes(app, mockPool as any);

  // Add security headers hook like in server.ts
  app.addHook('onSend', async (request, reply, payload) => {
    // Basic security headers
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // Add request ID to response headers for tracing
    if (request.id) {
      reply.header('X-Request-Id', request.id);
    }

    return payload;
  });

  return app;
};

// Common beforeAll setup
export const setupBeforeAll = async (): Promise<void> => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test_jwt_secret';
  process.env.SESSION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  // Load modules
  const authModule = await import('../routes/auth.js');
  registerAuthRoutesFunction = authModule.registerAuthRoutes;
  verifySessionFunction = authModule.verifySession;
  verifyPATFunction = authModule.verifyPAT;

  const hooksModule = await import('../hooks.js');
  authHookFunction = hooksModule.auth;
  rateLimitFunction = hooksModule.rateLimit;
  idempotencyFunction = hooksModule.idempotency;

  const webModule = await import('../web.js');
  registerRoutesFunction = webModule.registerRoutes;

  // Setup default mock implementations
  const bcrypt = await import('bcryptjs');
  (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
  (bcrypt.compare as jest.Mock).mockResolvedValue(true);

  const jwt = await import('jsonwebtoken');
  (jwt.sign as jest.Mock).mockReturnValue('mock_jwt_token');
  (jwt.verify as jest.Mock).mockReturnValue({ user_id: 'test_user' });

  // Default pool query responses
  mockPool.query.mockResolvedValue({ rows: [] });
  mockPool.end.mockResolvedValue('OK');

  // Default validator mocks
  mockValidateEmail.mockResolvedValue({ valid: true, reason_codes: [], disposable: false, normalized: 'test@example.com', mx_found: true, request_id: 'test-id', ttl_seconds: 2_592_000 });
  mockValidatePhone.mockResolvedValue({ valid: true, reason_codes: [], country: 'US', e164: '+15551234567' });
  mockValidateAddress.mockResolvedValue({ valid: true, reason_codes: [], po_box: false, postal_city_match: true, in_bounds: true, geo: { lat: 40, lng: -74 }, normalized: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' } });

  // Default Redis responses
  mockRedisInstance.quit.mockResolvedValue('OK');
  mockRedisInstance.ping.mockResolvedValue('PONG');
};

// Additional exports for test files
export const hapi = jest.requireMock('@hapi/address');
export const mockDns = jest.requireMock('node:dns/promises');
export const mockValidateEmail = jest.requireMock('../validators/email.js').validateEmail;
export const mockValidateAddress = jest.requireMock('../validators/address.js').validateAddress;
export const mockValidatePhone = jest.requireMock('../validators/phone.js').validatePhone;
export const libphone = jest.requireMock('libphonenumber-js');

// Export loaded functions for tests
export {
  authHookFunction, idempotencyFunction, rateLimitFunction, registerAuthRoutesFunction, registerRoutesFunction, verifyPATFunction, verifySessionFunction
};

describe('Test Setup', () => {
  it('should setup tests', () => {
    expect(true).toBe(true);
  });
});
