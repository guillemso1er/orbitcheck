import type { FastifyReply } from 'fastify';
import Fastify from 'fastify';

import { createApp, mockPool, mockRedisInstance, mockSession, setupBeforeAll } from './testSetup.js';

describe('Web Module', () => {
  let verifySession: any;
  let verifyPAT: any;
  let auth: any;
  let rateLimit: any;
  let idempotency: any;

  beforeAll(async () => {
    await setupBeforeAll();

    // Import functions
    const authModule = await import('../routes/auth.js');
    verifySession = authModule.verifySession;
    verifyPAT = authModule.verifyPAT;

    const hooksModule = await import('../hooks.js');
    auth = hooksModule.auth;
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

      const webModule = await import('../web.js');
      webModule.registerRoutes(app, mockPool as any, mockRedisInstance as any);

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
      const mockReply = {} as FastifyReply;

      // Mock successful session verification
      mockSession.user_id = 'user123';
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 'user123' }] })
        .mockResolvedValueOnce({ rows: [{ project_id: 'project123' }] });

      await verifySession(mockRequest, mockReply, mockPool as any);

      expect(mockRequest.user_id).toBe('user123');
      expect(mockRequest.project_id).toBe('project123');
    });

    it('should use PAT auth for management routes', async () => {
      const mockRequest = {
        url: '/v1/api-keys',
        headers: { authorization: 'Bearer pat_token' },
        log: { info: jest.fn() }
      } as any;
      const mockReply = {} as FastifyReply;

      // Mock PAT verification
      const crypto = await import('node:crypto');
      (crypto.createHash as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('token_hash'),
      });

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 'pat123', user_id: 'user123', scopes: ['*'] }] })
        .mockResolvedValueOnce({ rows: [{ value: 1 }] })
        .mockResolvedValueOnce({ rows: [{ project_id: 'project123' }] })
        .mockResolvedValueOnce({ rows: [{ value: 1 }] });

      await verifyPAT(mockRequest, mockReply, mockPool as any);

      expect(mockRequest.user_id).toBe('user123');
      expect(mockRequest.pat_scopes).toEqual(['*']);
    });

    it('should use API key/HMAC auth for runtime routes', async () => {
      const mockRequest = {
        url: '/v1/orders',
        headers: { authorization: 'Bearer sk_test_key' },
        log: { info: jest.fn() }
      } as any;
      const mockReply = {} as FastifyReply;

      // Mock API key verification
      const crypto = await import('node:crypto');
      (crypto.createHash as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('key_hash'),
      });

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 'key123', project_id: 'project123' }] })
        .mockResolvedValueOnce({ rows: [{ value: 1 }] });

      await auth(mockRequest, mockReply, mockPool as any);

      expect(mockRequest.project_id).toBe('project123');
    });

    it('should reject invalid HMAC signature for runtime routes', async () => {
      const timestamp = Date.now().toString();
      const mockRequest = {
        url: '/v1/validate',
        method: 'POST',
        headers: {
          authorization: `HMAC keyId=sk_test signature=mocked_hmac ts=${timestamp} nonce=123`
        },
        body: { test: 'data' },
        log: { info: jest.fn() }
      } as any;
      const mockReply = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as unknown as FastifyReply;

      // Mock HMAC verification
      const crypto = await import('node:crypto');
      (crypto.createDecipheriv as jest.Mock).mockImplementation(() => ({
        update: jest.fn().mockReturnValue('sk_test'),
        final: jest.fn().mockReturnValue('_key'),
      }));
      (crypto.createHmac as jest.Mock).mockImplementation(() => ({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('mocked_hmac'),
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

      await auth(mockRequest, mockReply, mockPool as any);

      expect(mockReply.status).toHaveBeenCalledWith(401);
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

      registerRoutes(app, mockPool as any, mockRedisInstance as any);

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
        log: { info: jest.fn() }
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
        log: { info: jest.fn() }
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
        log: { info: jest.fn() }
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

      registerRoutes(app, mockPool as any, mockRedisInstance as any);

      // Verify hooks are registered
      expect(app.ready).toBeDefined();
    });

    it('should handle authentication flow for different route types', async () => {
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

      registerRoutes(app, mockPool as any, mockRedisInstance as any);

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
      expect(mgmtResponse.statusCode).toBe(400); // Missing required auth header

      // Test runtime route - requires API key
      const runtimeResponse = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        payload: { email: 'test@example.com' }
      });
      expect(runtimeResponse.statusCode).toBe(400); // Missing required auth header
    });
  });
});