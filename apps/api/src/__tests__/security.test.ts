import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import request from 'supertest';

import { createApp, mockPool, mockRedisInstance, mockValidateEmail, setupBeforeAll } from './testSetup.js';

// Mock environment module
jest.mock('../environment.js', () => ({
  environment: {
    DATABASE_URL: 'postgres://test',
    REDIS_URL: 'redis://localhost',
    JWT_SECRET: 'test_jwt_secret',
    SESSION_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    TWILIO_ACCOUNT_SID: 'test_sid',
    TWILIO_AUTH_TOKEN: 'test_token',
    TWILIO_PHONE_NUMBER: '+15551234567',
    TWILIO_VERIFY_SERVICE_SID: 'test_verify_sid',
    GOOGLE_GEOCODING_KEY: '',
    USE_GOOGLE_FALLBACK: false,
    DISPOSABLE_LIST_URL: 'https://example.com/disposable-domains.json',
    RATE_LIMIT_COUNT: 100,
    RATE_LIMIT_BURST: 200,
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

// Mock bcrypt functions
jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('Security and Authentication', () => {
  let app: FastifyInstance;

  // Set up the app once before all tests in this file run
  beforeAll(async () => {
    await setupBeforeAll();
    app = await createApp(); // Correctly await the async function

    // Add the proper authentication hook that matches the real authentication flow
    const { applyRateLimitingAndIdempotency } = await import('../web.js');
    app.addHook('preHandler', async (request: FastifyRequest, rep: FastifyReply) => {
      await applyRateLimitingAndIdempotency(request, rep, mockRedisInstance as any);
    });

    await app.ready();
  });

  // Close the app once after all tests in this file are complete
  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // Before each test, reset mocks to a clean, default state
  beforeEach(() => {
    jest.clearAllMocks();

    // Set up default validator mock
    mockValidateEmail.mockResolvedValue({
      valid: true,
      reason_codes: [],
      disposable: false,
      normalized: 'test@example.com',
      mx_found: true,
      request_id: 'test-id',
      ttl_seconds: 2_592_000
    });

    // Set up Redis mocks for rate limiting
    mockRedisInstance.incr.mockResolvedValue(1); // First request, count = 1
    mockRedisInstance.expire.mockResolvedValue(true);
    mockRedisInstance.ttl.mockResolvedValue(60);
    mockRedisInstance.get.mockResolvedValue(null); // No cached idempotency
    mockRedisInstance.set.mockResolvedValue('OK');

    // Default mock implementation: assume authentication is successful
    mockPool.query.mockImplementation((queryText: string) => {
      const upperQuery = queryText.toUpperCase();

      // For API key lookups (from verifyAPIKey function)
      if (upperQuery.includes('API_KEYS') && upperQuery.includes('PREFIX')) {
        return Promise.resolve({
          rows: [{
            id: 'test_key_id',
            project_id: 'test_project',
            encrypted_key: '0123456789abcdef0123456789abcdef:test_encrypted_key'
          }]
        });
      }

      // For usage tracking
      if (upperQuery.includes('PROJECTS') && upperQuery.includes('ID')) {
        return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
      }

      return Promise.resolve({ rows: [] });
    });
  });

  describe('Authentication', () => {
    it('should reject requests with a missing API key', async () => {
      // This relies on Fastify's schema validation for the required header
      const response = await request(app.server)
        .post('/v1/validate/email')
        .send({ email: 'test@example.com' });

      // A missing required header is typically a 400 Bad Request
      expect(response.statusCode).toBe(401);
    });

    it('should reject requests with an invalid API key', async () => {
      // Set expected status to 400 (BAD_REQUEST) as per auth function
      // For this specific test, override the default mock to simulate a key not being found
      mockPool.query.mockImplementation((queryText: string) => {
        const upperQuery = queryText.toUpperCase();
        if (upperQuery.includes('API_KEYS')) {
          return Promise.resolve({ rows: [] }); // No key found
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await request(app.server)
        .post('/v1/validate/email')
        .set('Authorization', 'Bearer invalid_key')
        .send({ email: 'test@example.com' });

      expect(result.statusCode).toBe(401);
      expect((result.body as { error: { code: string } }).error.code).toBe('unauthorized');
    });
  });

  describe('Security Headers', () => {
    it('should include security headers in responses', async () => {
      // Clear previous mocks and set up comprehensive mocks
      jest.clearAllMocks();

      // Set up mocks for all expected database queries
      mockPool.query
        // API key lookup (verifyAPIKey function)
        .mockImplementationOnce((queryText: string) => {
          if (queryText.includes('hash=') && queryText.includes('prefix=')) {
            return Promise.resolve({
              rows: [{
                id: 'valid_key_id',
                project_id: 'test_project'
              }]
            });
          }
          return Promise.resolve({ rows: [] });
        })
        // API key usage update
        .mockResolvedValueOnce({ rows: [] })
        // Project lookup
        .mockResolvedValueOnce({ rows: [{ project_id: 'test_project' }] })
        // Usage increment
        .mockResolvedValueOnce({ rows: [] })
        // Log event insertion (logEvent call after successful validation)
        .mockResolvedValueOnce({ rows: [] });

      const result = await request(app.server)
        .post('/v1/validate/email')
        .set('Authorization', 'Bearer ok_test_key_1234567890abcdef')
        .send({ email: 'test@example.com' });


      // Check that the request was successful
      expect(result.statusCode).toBe(200);

      // Check for the security headers added by the preHandler hook
      expect(result.headers['x-content-type-options']).toBe('nosniff');
      expect(result.headers['x-frame-options']).toBe('DENY');
      expect(result.headers['x-xss-protection']).toBe('1; mode=block');
      expect(result.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(result.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    });
  });
});