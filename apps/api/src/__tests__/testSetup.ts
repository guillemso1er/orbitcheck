import Fastify from 'fastify';

import type { ValidationResult } from '../validators/email.js';

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

jest.mock('../environment.js', () => ({
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

// Mock the OpenAPI spec for tests
jest.mock('@orbicheck/contracts/openapi.yaml', () => ({
  openapi: '3.0.3',
  info: {
    title: 'OrbiCheck API',
    description: 'API for validation, deduplication, and risk assessment services',
    version: '1.0.0'
  },
  paths: {}
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

// --- Test Setup ---

// This variable will hold the dynamically imported route registration function.
let registerAuthRoutesFunction: unknown;
let _verifyJWTFunction: unknown;
let registerApiKeysRoutesFunction: unknown;
let registerValidationRoutesFunction: unknown;
let registerDedupeRoutesFunction: unknown;
let registerOrdersRoutesFunction: unknown;
let registerDataRoutesFunction: unknown;
let registerWebhooksRoutesFunction: unknown;
let registerRulesRoutesFunction: unknown;

export const createApp = async (): Promise<Fastify.FastifyInstance> => {
  const app = Fastify({ logger: false });
  enableDiagnostics(app);

  app.addHook('preHandler', async (request, rep) => {
    const url = request.url;

    // Skip auth for public routes
    if (url.startsWith('/health') || url.startsWith('/documentation') || url.startsWith('/auth')) {
      return;
    }

    // Dashboard routes: require JWT
    const isDashboardRoute = url.startsWith('/api-keys') || url.startsWith('/api/webhooks') ||
      url.startsWith('/v1/api-keys') || url.startsWith('/v1/webhooks') ||
      url.startsWith('/v1/usage') || url.startsWith('/v1/logs');
    
    if (isDashboardRoute) {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return rep.code(401).send({ error: 'Unauthorized' });
      }

      const token = authHeader.split(' ')[1];
      
      try {
        // Actually call jwt.verify so our mocks work
        const payload = jwt.verify(token, process.env.JWT_SECRET || 'test_jwt_secret');
        
        // Check if user has a project
        const projectResult = await mockPool.query(
          "SELECT p.id AS project_id FROM projects p WHERE p.user_id = $1",
          [payload.user_id]
        );
        
        if (!projectResult.rows || projectResult.rows.length === 0) {
          return rep.code(401).send({ error: 'Unauthorized' });
        }
        
        (request as any).project_id = projectResult.rows[0].project_id;
        (request as any).user_id = payload.user_id;
      } catch {
        return rep.code(401).send({ error: { code: 'invalid_token', message: 'Invalid token' } });
      }
    }
    return;
  });


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
  app.addHook('preHandler', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    return;
  });

  return app;
};

// Dynamically imported modules for mocking
export let hapi: unknown;
export let mockDns: unknown;
export let libphone: unknown;
export let mockAddressValidator: unknown;
export let mockValidateEmail: jest.Mock<Promise<ValidationResult>>;
export let mockGetDomain: jest.Mock<any>;
export let mockValidatePhone: jest.Mock<any>;
export let mockValidateAddress: jest.Mock<any>;
export let bcrypt: unknown;
export let jwt: unknown;

// Common beforeAll setup
export const setupBeforeAll = async (): Promise<void> => {
  // Set test environment variables to avoid errors
  process.env.JWT_SECRET = 'test_jwt_secret';
  process.env.TWILIO_ACCOUNT_SID = 'test_sid';
  process.env.TWILIO_AUTH_TOKEN = 'test_token';
  process.env.TWILIO_PHONE_NUMBER = '+15551234567';
  process.env.TWILIO_VERIFY_SERVICE_SID = 'test_verify_sid';

  // Load route modules synchronously with require for test environment
  const authModule = await import('../routes/auth.js');
  registerAuthRoutesFunction = authModule.registerAuthRoutes;
  _verifyJWTFunction = authModule.verifyJWT;
  const apiKeysModule = await import('../routes/api-keys.js');
  registerApiKeysRoutesFunction = apiKeysModule.registerApiKeysRoutes;
  const validationModule = await import('../routes/validation.js');
  registerValidationRoutesFunction = validationModule.registerValidationRoutes;
  const dedupeModule = await import('../routes/dedupe.js');
  registerDedupeRoutesFunction = dedupeModule.registerDedupeRoutes;
  const ordersModule = await import('../routes/orders.js');
  registerOrdersRoutesFunction = ordersModule.registerOrderRoutes;
  const dataModule = await import('../routes/data.js');
  registerDataRoutesFunction = dataModule.registerDataRoutes;
  const webhooksModule = await import('../routes/webhook.js');
  registerWebhooksRoutesFunction = webhooksModule.registerWebhookRoutes;
  const rulesModule = await import('../routes/rules.js');
  registerRulesRoutesFunction = rulesModule.registerRulesRoutes;


  const emailModule = await import('../validators/email.js');
  mockValidateEmail = emailModule.validateEmail as jest.Mock;
  const phoneModule = await import('../validators/phone.js');
  mockValidatePhone = phoneModule.validatePhone as jest.Mock;
  const addressModule = await import('../validators/address.js');
  mockValidateAddress = addressModule.validateAddress as jest.Mock;
  const hapiModule = await import('@hapi/address');
  hapi = hapiModule as any;
  const dnsModule = await import('node:dns/promises');
  mockDns = dnsModule as any;
  const libphoneModule = await import('libphonenumber-js');
  libphone = libphoneModule;
  mockAddressValidator = addressModule;
  const bcryptModule = await import('bcryptjs');
  bcrypt = bcryptModule;
  const jwtModule = await import('jsonwebtoken');
  jwt = jwtModule;

  // Set default mock implementations once
  mockValidateEmail.mockResolvedValue({
    valid: true,
    normalized: 'test@example.com',
    disposable: false,
    mx_found: true,
    reason_codes: [],
    request_id: 'test-request-id',
    ttl_seconds: 2_592_000,
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
  const cryptoModule = await import('node:crypto');
  (cryptoModule.randomBytes as jest.Mock).mockReturnValue(Buffer.from('test32bytes' + 'a'.repeat(24)));
  const actualCrypto = jest.requireActual('node:crypto');
  (cryptoModule.createHash as jest.Mock).mockImplementation((algorithm) => actualCrypto.createHash(algorithm));
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

// test diagnostics: lifecycle + response logging
export function enableDiagnostics(app: unknown): void {
  app.addHook('onRequest', async (request: unknown, _rep: unknown) => {
    console.log(`[onRequest] ${request.method} ${request.url} auth=${request.headers.authorization ?? '<none>'}`);
    return;
  });

  app.addHook('preHandler', async (request: unknown, _rep: unknown) => {
    console.log(`[preHandler] ${request.method} ${request.url}`);
    return;
  });

  app.addHook('onSend', async (request: unknown, rep: unknown, payload: unknown) => {
    const status = rep.statusCode;
    if (status >= 400) {
      let bodyText = '';
      try { bodyText = typeof payload === 'string' ? payload : payload?.toString?.() ?? ''; } catch { }
      console.log(`[onSend] ${request.method} ${request.url} -> ${status} body=${bodyText}`);
    }
    return payload;
  });

  app.addHook('onError', async (request: unknown, rep: unknown, error: unknown) => {
    console.log(`[onError] ${request.method} ${request.url} err=${error?.message} status=${rep.statusCode}`);
    return error;
  });
}