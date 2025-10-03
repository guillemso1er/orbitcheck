
import Fastify from 'fastify';

import type { ValidationResult } from '../validators/email';

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

// --- Module Mocks ---
jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool),
}));

jest.mock('../env', () => ({
  environment: {
    DATABASE_URL: 'postgres://test',
    REDIS_URL: 'redis://localhost',
    JWT_SECRET: 'test_jwt_secret',
    TWILIO_ACCOUNT_SID: 'test_sid',
    TWILIO_AUTH_TOKEN: 'test_token',
    TWILIO_PHONE_NUMBER: '+15551234567',
    TWILIO_VERIFY_SERVICE_SID: 'test_verify_sid',
    GOOGLE_GEOCODING_KEY: '',
    USE_GOOGLE_FALLBACK: false,
    DISPOSABLE_LIST_URL: 'https://example.com/disposable-domains.json',
    RATE_LIMIT_COUNT: 1,
    RETENTION_DAYS: 90,
    // Add any other env vars as needed
  }
}));

jest.mock('ioredis', () => jest.fn(() => mockRedisInstance));

jest.mock('twilio', () => jest.fn(() => mockTwilioInstance));

jest.mock('node-fetch', () => jest.fn());

jest.mock('node:dns/promises', () => ({
  resolveMx: jest.fn(),
  resolve4: jest.fn(),
  resolve6: jest.fn(),
}));

jest.mock('../validators/taxid', () => ({
  validateTaxId: jest.fn(),
}));

jest.mock('../validators/address', () => ({
  validateAddress: jest.fn(),
  normalizeAddress: jest.fn(),
  detectPoBox: jest.fn(),
}));

jest.mock('../validators/phone', () => ({
  validatePhone: jest.fn(),
}));

jest.mock('@hapi/address', () => ({
  isEmailValid: jest.fn(),
}));

jest.mock('libphonenumber-js', () => ({
  parsePhoneNumber: jest.fn(),
}));

jest.mock('tldts', () => ({
  getDomain: jest.fn((domain: string) => domain),
}));


jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'), // Import and spread all original functions
  randomBytes: jest.fn(),               // Override only the ones we need to control
  createHash: jest.fn(),
  randomUUID: jest.fn(),
}));
jest.mock('../validators/email', () => ({
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

// --- Test Setup ---

// This variable will hold the dynamically imported route registration function.
let registerAuthRoutesFunction: any;
let verifyJWTFunction: any;
let registerApiKeysRoutesFunction: any;
let registerValidationRoutesFunction: any;
let registerDedupeRoutesFunction: any;
let registerOrdersRoutesFunction: any;
let registerDataRoutesFunction: any;
let registerWebhooksRoutesFunction: any;
let registerRulesRoutesFunction: any;


export const createApp = async () => {
  const app = Fastify({ logger: false });


  // Register routes using the loaded functions
  if (typeof registerAuthRoutesFunction !== 'function') {
    throw new TypeError("registerAuthRoutesFunction was not loaded correctly.");
  }
  registerAuthRoutesFunction(app, mockPool as any);

  if (typeof registerApiKeysRoutesFunction !== 'function') {
    throw new TypeError("registerApiKeysRoutesFunction was not loaded correctly.");
  }
  registerApiKeysRoutesFunction(app, mockPool as any);

  if (typeof registerValidationRoutesFunction !== 'function') {
    throw new TypeError("registerValidationRoutesFunction was not loaded correctly.");
  }
  registerValidationRoutesFunction(app, mockPool as any, mockRedisInstance as any);

  if (typeof registerDedupeRoutesFunction !== 'function') {
    throw new TypeError("registerDedupeRoutesFunction was not loaded correctly.");
  }
  registerDedupeRoutesFunction(app, mockPool as any);

  if (typeof registerOrdersRoutesFunction !== 'function') {
    throw new TypeError("registerOrdersRoutesFunction was not loaded correctly.");
  }
  registerOrdersRoutesFunction(app, mockPool as any, mockRedisInstance as any);

  if (typeof registerDataRoutesFunction !== 'function') {
    throw new TypeError("registerDataRoutesFunction was not loaded correctly.");
  }
  registerDataRoutesFunction(app, mockPool as any);

  if (typeof registerWebhooksRoutesFunction !== 'function') {
    throw new TypeError("registerWebhooksRoutesFunction was not loaded correctly.");
  }
  registerWebhooksRoutesFunction(app, mockPool as any);

  if (typeof registerRulesRoutesFunction !== 'function') {
    throw new TypeError("registerRulesRoutesFunction was not loaded correctly.");
  }
  registerRulesRoutesFunction(app, mockPool as any);


  // Add security headers for test coverage
  app.addHook('preHandler', (request, reply, done) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // Call done() to signal the hook is complete.
    done();
  });

  return app;
};

// Dynamically imported modules for mocking
export let hapi: any;
export let mockDns: any;
export let libphone: any;
export let mockAddressValidator: any;
export let mockValidateEmail: jest.Mock<Promise<ValidationResult>>;
export let mockGetDomain: jest.Mock<any>;
export let mockValidatePhone: jest.Mock<any>;
export let mockValidateAddress: jest.Mock<any>;
export let bcrypt: any;
export let jwt: any;
// Common beforeAll setup
export const setupBeforeAll = async () => {
  // Set test environment variables to avoid errors
  process.env.JWT_SECRET = 'test_jwt_secret';
  process.env.TWILIO_ACCOUNT_SID = 'test_sid';
  process.env.TWILIO_AUTH_TOKEN = 'test_token';
  process.env.TWILIO_PHONE_NUMBER = '+15551234567';
  process.env.TWILIO_VERIFY_SERVICE_SID = 'test_verify_sid';

  // Load route modules synchronously with require for test environment
  const authModule = await import('../routes/auth');
  registerAuthRoutesFunction = authModule.registerAuthRoutes;
  verifyJWTFunction = authModule.verifyJWT;
  const apiKeysModule = await import('../routes/api-keys');
  registerApiKeysRoutesFunction = apiKeysModule.registerApiKeysRoutes;
  const validationModule = await import('../routes/validation');
  registerValidationRoutesFunction = validationModule.registerValidationRoutes;
  const dedupeModule = await import('../routes/dedupe');
  registerDedupeRoutesFunction = dedupeModule.registerDedupeRoutes;
  const ordersModule = await import('../routes/orders');
  registerOrdersRoutesFunction = ordersModule.registerOrderRoutes;
  const dataModule = await import('../routes/data');
  registerDataRoutesFunction = dataModule.registerDataRoutes;
  const webhooksModule = await import('../routes/webhook');
  registerWebhooksRoutesFunction = webhooksModule.registerWebhookRoutes;
  const rulesModule = await import('../routes/rules');
  registerRulesRoutesFunction = rulesModule.registerRulesRoutes;


  mockValidateEmail = require('../validators/email').validateEmail as jest.Mock;
  mockValidatePhone = require('../validators/phone').validatePhone as jest.Mock;
  mockValidateAddress = require('../validators/address').validateAddress as jest.Mock;
  hapi = require('@hapi/address') as { isEmailValid: jest.Mock };
  mockDns = require('node:dns/promises') as { resolveMx: jest.Mock; resolve4: jest.Mock; resolve6: jest.Mock };
  libphone = require('libphonenumber-js');
  mockAddressValidator = require('../validators/address');
  bcrypt = require('bcryptjs');
  jwt = require('jsonwebtoken');

  // Set default mock implementations once
  mockValidateEmail.mockResolvedValue({
    valid: true,
    normalized: 'test@example.com',
    disposable: false,
    mx_found: true,
    reason_codes: [],
    request_id: 'test-request-id',
    ttl_seconds: 2592000,
  });

  mockValidatePhone.mockResolvedValue({
    valid: true,
    e164: '+15551234567',
    country: 'US',
    reason_codes: [],
  });

  mockValidateAddress.mockResolvedValue({
    valid: true,
    normalized: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' },
    po_box: false,
    postal_city_match: true,
    in_bounds: true,
    geo: { lat: 40, lng: -74 },
    reason_codes: [],
  });

  // Mock crypto for consistent testing
  const cryptoModule = require('node:crypto');
  (cryptoModule.randomBytes as jest.Mock).mockReturnValue(Buffer.from('test32bytes' + 'a'.repeat(24)));
  (cryptoModule.createHash as jest.Mock).mockImplementation(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('test_hash')
  }));
  (cryptoModule.randomUUID as jest.Mock).mockReturnValue('123e4567-e89b-12d3-a456-426614174000');

  // Default Mock Implementations (Success Cases)
  mockPool.end.mockResolvedValue('OK');
  mockPool.connect.mockResolvedValue({
    query: jest.fn().mockResolvedValue({ rows: [{ value: 1 }] }),
    release: jest.fn(),
  });
  mockRedisInstance.quit.mockResolvedValue('OK');
  mockRedisInstance.sadd.mockResolvedValue(1);
  mockRedisInstance.del.mockResolvedValue(1);
  mockRedisInstance.rename.mockResolvedValue('OK');
  mockRedisInstance.sismember.mockResolvedValue(0);
  mockRedisInstance.incr.mockResolvedValue(1);
  mockRedisInstance.expire.mockResolvedValue(true);
  mockRedisInstance.get.mockResolvedValue(null);
  mockRedisInstance.set.mockResolvedValue('OK');
  mockTwilioInstance.messages.create.mockResolvedValue({ sid: 'test_sid' });
  hapi.isEmailValid.mockReturnValue(true);
  libphone.parsePhoneNumber.mockReturnValue({
    isValid: () => true,
    number: '+15551234567',
    country: 'US',
    phone: '15551234567',
  } as any);
  mockDns.resolveMx.mockResolvedValue([{ exchange: 'mx.example.com' }]);
  mockAddressValidator.normalizeAddress.mockResolvedValue({
    line1: '123 Main St',
    city: 'New York',
    postal_code: '10001',
    country: 'US',
  });
  mockAddressValidator.detectPoBox.mockReturnValue(false);

  // Mock bcrypt and jwt defaults
  (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
  (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  (jwt.sign as jest.Mock).mockReturnValue('mock_jwt_token');
  (jwt.verify as jest.Mock).mockReturnValue({ user_id: 'test_user', project_id: 'test_project' });
};

describe('testSetup', () => {
  it('should setup mocks', () => {
    expect(true).toBe(true);
  });
});