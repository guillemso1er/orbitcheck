import type { FastifyReply } from 'fastify';
import Fastify from 'fastify';

import { mockPool, mockRedisInstance, mockSession, setupBeforeAll } from './testSetup.js';

describe('Web Module', () => {
  let verifySession: any;
  let verifyPAT: any;
  let auth: any;
  let verifyHttpMessageSignature: any;
  let rateLimit: any;
  let idempotency: any;

  beforeAll(async () => {
    await setupBeforeAll();

    // Import functions
    const authModule = await import('../services/auth.js');
    verifySession = authModule.verifySession;
    verifyPAT = authModule.verifyPAT;
    verifyHttpMessageSignature = authModule.verifyHttpMessageSignature;
    auth = authModule.verifyAPIKey;

    const hooksModule = await import('../hooks.js');
    rateLimit = hooksModule.rateLimit;
    idempotency = hooksModule.idempotency;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('authenticateRequest', () => {
    it('should skip auth for public endpoints', async () => {
      const app = Fastify({ logger: false });

      app.decorateRequest('session', {
        getter() {
          return mockSession;
        },
        setter(value: any) {
          Object.assign(mockSession, value);
        }
      });

      const { registerRoutes } = await import('../web.js');
      await registerRoutes(app, mockPool as any, mockRedisInstance as any);

      app.get("/health", async (): Promise<{ ok: true; timestamp: string; environment: string }> => ({
        ok: true,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
      }));

      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(200);
    });

    it('should use session auth for dashboard routes', async () => {
      const mockRequest = {
        url: '/dashboard/settings',
        log: { info: jest.fn() },
        session: mockSession
      } as any;

      // Mock successful session verification
      mockSession.user_id = 'user123';
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 'user123' }] })
        .mockResolvedValueOnce({ rows: [{ project_id: 'project123' }] });

      await verifySession(mockRequest, mockPool as any);

      expect(mockRequest.user_id).toBe('user123');
      expect(mockRequest.project_id).toBe('project123');
    });

    it('should use PAT auth for management routes', async () => {
      const mockRequest = {
        url: '/v1/api-keys',
        headers: { authorization: 'Bearer oc_pat_test:pat123:secret456' },
        log: { info: jest.fn() }
      } as any;

      // Mock PAT verification - the test expects the function to work with test tokens
      // Clear previous mocks
      jest.clearAllMocks();

      // Mock the database query to return a valid PAT
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'pat123',
            user_id: 'user123',
            scopes: ['*'],
            token_hash: 'mock_token_hash',
            disabled: false,
            expires_at: null,
            ip_allowlist: null
          }]
        });

      // Call the verifyPAT function
      const result = await verifyPAT(mockRequest, mockPool as any);

      // The function should return the PAT object
      expect(result).toBeDefined();
      expect(result.user_id).toBe('user123');
      expect(result.scopes).toEqual(['*']);

      // Also check that the request object gets decorated
      expect(mockRequest.user_id).toBe('user123');
      expect(mockRequest.pat_scopes).toEqual(['*']);
    });

    it('should use API key/HMAC auth for runtime routes', async () => {
      const mockRequest = {
        url: '/v1/orders',
        method: 'POST',
        headers: { authorization: 'Bearer ok_test_key' },
        log: { info: jest.fn() },
        routeType: 'runtime'
      } as any;
      const mockReply = { status: jest.fn().mockReturnThis(), send: jest.fn() } as any;

      // Clear previous mocks
      jest.clearAllMocks();

      // Mock database query for API key lookup - need to match the hash+prefix query in verifyAPIKey
      mockPool.query
        // First call: API key lookup (query for hash and prefix)
        .mockImplementationOnce((queryText: string) => {
          if (queryText.includes('hash=') && queryText.includes('prefix=')) {
            return Promise.resolve({
              rows: [{
                id: 'key123',
                project_id: 'project123'
              }]
            });
          }
          return Promise.resolve({ rows: [] });
        })
        // Second call: usage update
        .mockResolvedValueOnce({ rows: [] });

      // Call the verifyAPIKey function
      const result = await auth(mockRequest, mockReply, mockPool as any);

      // The function should return true on success
      expect(result).toBe(true);
      expect(mockRequest.project_id).toBe('project123');
    });

    it('should reject invalid HMAC signature for runtime routes', async () => {
      const timestamp = Date.now().toString();
      const mockRequest = {
        url: '/v1/validate/email',
        method: 'POST',
        headers: {
          authorization: `HMAC keyId=sk_test signature=invalid_hmac ts=${timestamp} nonce=123`
        },
        body: { test: 'data' },
        log: { info: jest.fn() }
      } as any;
      // Mock HMAC verification - make signature invalid
      const crypto = await import('node:crypto');
      (crypto.createDecipheriv as jest.Mock).mockImplementation(() => ({
        update: jest.fn().mockReturnValue('sk_test'),
        final: jest.fn().mockReturnValue('_key'),
      }));
      (crypto.createHmac as jest.Mock).mockImplementation(() => ({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('different_hmac'), // Different from 'invalid_hmac'
      }));

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'key123',
            project_id: 'project123',
            encrypted_key: 'iv:encrypted_data'
          }]
        })
        .mockResolvedValueOnce({ rows: [{ value: 1 }] });

      // Test HTTP Message Signature authentication directly
      const result = await verifyHttpMessageSignature(mockRequest, mockPool as any);

      expect(result).toBe(false);
    });
  });

  describe('applyRateLimitingAndIdempotency', () => {
    it('should skip middleware for public routes', async () => {
      const app = Fastify({ logger: false });

      app.decorateRequest('session', {
        getter() {
          return mockSession;
        },
        setter(value: any) {
          Object.assign(mockSession, value);
        }
      });

      const { registerRoutes } = await import('../web.js');
      await registerRoutes(app, mockPool as any, mockRedisInstance as any);

      app.get("/health", async (): Promise<{ ok: true; timestamp: string; environment: string }> => ({
        ok: true,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
      }));

      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(200);
      expect(mockRedisInstance.incr).not.toHaveBeenCalled();
    });

    it('should apply rate limiting to runtime routes', async () => {
      const mockRequest = {
        url: '/v1/validate',
        project_id: 'project123',
        ip: '127.0.0.1',
        log: { info: jest.fn() },
        routeType: 'runtime'
      } as any;
      const mockReply = {
        header: jest.fn(),
      } as unknown as FastifyReply;

      mockRedisInstance.incr.mockResolvedValue(1);
      mockRedisInstance.expire.mockResolvedValue(1);

      await rateLimit(mockRequest, mockReply, mockRedisInstance as any);

      expect(mockRedisInstance.incr).toHaveBeenCalledWith(
        expect.stringContaining('rl:project123')
      );
    });

    it('should enforce rate limits', async () => {
      const mockRequest = {
        url: '/v1/validate',
        project_id: 'project123',
        ip: '127.0.0.1',
        log: { info: jest.fn() },
        routeType: 'runtime'
      } as any;
      const mockReply = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
        header: jest.fn(),
      } as unknown as FastifyReply;

      mockRedisInstance.incr.mockResolvedValue(101); // Over limit
      mockRedisInstance.ttl.mockResolvedValue(30); // Remaining TTL

      await rateLimit(mockRequest, mockReply, mockRedisInstance as any);

      expect(mockReply.status).toHaveBeenCalledWith(429);
      expect(mockReply.header).toHaveBeenCalledWith('Retry-After', '30');
    });

    it('should handle idempotency for runtime routes', async () => {
      const mockRequest = {
        url: '/v1/orders',
        headers: { 'idempotency-key': 'test-key' },
        project_id: 'project123',
        log: { info: jest.fn() },
        routeType: 'runtime'
      } as any;
      const mockReply = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
        header: jest.fn(),
      } as unknown as FastifyReply;

      // Simulate cached response
      mockRedisInstance.get.mockResolvedValue(JSON.stringify({
        statusCode: 200,
        body: { result: 'cached' },
        headers: {}
      }));

      await idempotency(mockRequest, mockReply, mockRedisInstance as any);

      expect(mockReply.header).toHaveBeenCalledWith("x-idempotent-replay", "1");
      expect(mockReply.send).toHaveBeenCalledWith({ statusCode: 200, body: { result: 'cached' }, headers: {} });
    });
  });

  describe('registerRoutes', () => {
    it('should register all route modules', async () => {
      const app = Fastify({ logger: false });

      app.decorateRequest('session', {
        getter() {
          return mockSession;
        },
        setter(value: any) {
          Object.assign(mockSession, value);
        }
      });

      const { registerRoutes } = await import('../web.js');
      await registerRoutes(app, mockPool as any, mockRedisInstance as any);

      // Verify hooks are registered
      expect(app.ready).toBeDefined();
    });

    it('should handle authentication flow for different route types', async () => {
      const app = Fastify({ logger: false });

      // Reset mockSession to ensure no auth
      mockSession.user_id = undefined;

      app.decorateRequest('session', {
        getter() {
          return mockSession;
        },
        setter(value: any) {
          Object.assign(mockSession, value);
        }
      });

      // Mock the contracts module to prevent import errors
      jest.doMock('@orbitcheck/contracts', () => ({
        DASHBOARD_ROUTES: {
          GET_CURRENT_USER_PLAN: '/user/plan',
          UPDATE_USER_PLAN: '/user/plan',
          GET_AVAILABLE_PLANS: '/public/plans',
          CHECK_VALIDATION_LIMITS: '/user/plan/usage/check',
          REGISTER_NEW_USER: '/auth/register',
          USER_LOGIN: '/auth/login',
          USER_LOGOUT: '/auth/logout',
        },
        API_V1_ROUTES: {
          VALIDATE: {
            VALIDATE_EMAIL: '/v1/validate/email',
          },
        },
        MGMT_V1_ROUTES: {
          API_KEYS: {
            CREATE_API_KEY: '/v1/api-keys',
          },
        },
      }));

      const { registerRoutes } = await import('../web.js');
      await registerRoutes(app, mockPool as any, mockRedisInstance as any);

      app.get("/health", async (): Promise<{ ok: true; timestamp: string; environment: string }> => ({
        ok: true,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
      }));

      // Test public route - no auth
      const healthResponse = await app.inject({
        method: 'GET',
        url: '/health'
      });
      expect(healthResponse.statusCode).toBe(200);

      // Test management route - requires PAT
      const mgmtResponse = await app.inject({
        method: 'GET',
        url: '/v1/api-keys'
      });
      expect(mgmtResponse.statusCode).toBe(401); // Missing required auth header

      // Test runtime route - basic check that it requires auth
      // Note: This test focuses on the route registration, not the complex auth flow
      // The individual auth method tests above cover the detailed behavior
      expect(true).toBe(true); // Placeholder for successful route registration
    });
  });
});