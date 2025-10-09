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
  user_id: null as string | null,
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

jest.mock('node-fetch', () => jest.fn());

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
jest.mock('@orbicheck/contracts', () => ({
  DASHBOARD_ROUTES: {
    REGISTER_NEW_USER: '/auth/register',
    USER_LOGIN: '/auth/login',
    USER_LOGOUT: '/auth/logout',
  },
  MGMT_V1_ROUTES: {
    API_KEYS: {
      LIST_API_KEYS: '/v1/api-keys',
    },
    WEBHOOKS: {
      TEST_WEBHOOK: '/v1/webhooks/test',
    },
  },
}));

jest.mock('../validators/taxid.js', () => ({
  validateTaxId: jest.fn(),
}));

jest.mock('../validators/address.js', () => ({
  validateAddress: jest.fn(),
  normalizeAddress: jest.fn(),
  detectPoBox: jest.fn(),
}));

jest.mock('../validators/phone.js', () => ({
  validatePhone: jest.fn(),
}));

jest.mock('@hapi/address', () => ({
  isEmailValid: jest.fn(),
}));

jest.mock('libphonenumber-js', () => ({
  parsePhoneNumber: jest.fn(),
  parsePhoneNumberWithError: jest.fn(),
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
  createHash: jest.fn().mockImplementation((algo) => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('mocked_hash'),
  })),
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
  app.decorateRequest('session', null);
  app.addHook('preHandler', async (request) => {
    (request as any).session = mockSession;
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

  // Default Redis responses
  mockRedisInstance.quit.mockResolvedValue('OK');
  mockRedisInstance.ping.mockResolvedValue('PONG');
};

// Export loaded functions for tests
export {
  authHookFunction, idempotencyFunction, rateLimitFunction, registerAuthRoutesFunction, registerRoutesFunction, verifyPATFunction, verifySessionFunction
};
