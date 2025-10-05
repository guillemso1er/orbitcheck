import { registerRoutes } from '../web.js';
import { verifyJWT } from '../routes/auth.js';
import { auth, rateLimit, idempotency } from '../hooks.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Redis as IORedisType } from 'ioredis';

// Mock dependencies
jest.mock('../routes/auth');
jest.mock('../hooks');

const mockVerifyJWT = verifyJWT as jest.MockedFunction<typeof verifyJWT>;
const mockAuth = auth as jest.MockedFunction<typeof auth>;
const mockRateLimit = rateLimit as jest.MockedFunction<typeof rateLimit>;
const mockIdempotency = idempotency as jest.MockedFunction<typeof idempotency>;

// Mock Fastify
const mockAddHook = jest.fn();
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();
const mockApp = {
  addHook: mockAddHook,
  get: mockGet,
  post: mockPost,
  delete: mockDelete,
} as unknown as FastifyInstance;

const mockPool = {} as Pool;
const mockRedis = {} as IORedisType;

describe('Web Authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddHook.mockClear();
    mockGet.mockClear();
    mockPost.mockClear();
    mockDelete.mockClear();
  });

  describe('registerRoutes', () => {
    it('should register preHandler hook that applies authentication and rate limiting', () => {
      registerRoutes(mockApp, mockPool, mockRedis);

      expect(mockAddHook).toHaveBeenCalledWith('preHandler', expect.any(Function));
    });

    it('should register all route handlers', () => {
      registerRoutes(mockApp, mockPool, mockRedis);

      // Should register all route handlers
      expect(mockAddHook).toHaveBeenCalledTimes(1);
      // The exact number of route registrations may vary depending on the implementation
      expect(mockGet).toHaveBeenCalled();
      expect(mockPost).toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  describe('Authentication Logic', () => {
    let hookHandler: Function;

    beforeEach(() => {
      registerRoutes(mockApp, mockPool, mockRedis);
      hookHandler = mockAddHook.mock.calls[0][1];
    });

    it('should skip authentication for health endpoints', async () => {
      const request = createMockRequest('/health');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockVerifyJWT).not.toHaveBeenCalled();
      expect(mockAuth).not.toHaveBeenCalled();
    });

    it('should skip authentication for documentation endpoints', async () => {
      const request = createMockRequest('/documentation');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockVerifyJWT).not.toHaveBeenCalled();
      expect(mockAuth).not.toHaveBeenCalled();
    });

    it('should skip authentication for auth endpoints', async () => {
      const request = createMockRequest('/auth/login');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockVerifyJWT).not.toHaveBeenCalled();
      expect(mockAuth).not.toHaveBeenCalled();
    });

    it('should use JWT verification for /api-keys endpoints', async () => {
      const request = createMockRequest('/api-keys');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockVerifyJWT).toHaveBeenCalled();
      expect(mockAuth).not.toHaveBeenCalled();
    });

    it('should use JWT verification for /v1/api-keys endpoints', async () => {
      const request = createMockRequest('/v1/api-keys');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockVerifyJWT).toHaveBeenCalled();
      expect(mockAuth).not.toHaveBeenCalled();
    });

    it('should use JWT verification for /webhooks endpoints', async () => {
      const request = createMockRequest('/webhooks');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockVerifyJWT).toHaveBeenCalled();
      expect(mockAuth).not.toHaveBeenCalled();
    });

    it('should use JWT verification for /v1/webhooks endpoints', async () => {
      const request = createMockRequest('/v1/webhooks');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockVerifyJWT).toHaveBeenCalled();
      expect(mockAuth).not.toHaveBeenCalled();
    });

    it('should use JWT verification for /v1/usage endpoints', async () => {
      const request = createMockRequest('/v1/usage');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockVerifyJWT).toHaveBeenCalled();
      expect(mockAuth).not.toHaveBeenCalled();
    });

    it('should use JWT verification for /v1/logs endpoints', async () => {
      const request = createMockRequest('/v1/logs');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockVerifyJWT).toHaveBeenCalled();
      expect(mockAuth).not.toHaveBeenCalled();
    });

    it('should use API key auth for other endpoints', async () => {
      const request = createMockRequest('/api/validation/email');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockAuth).toHaveBeenCalled();
      expect(mockVerifyJWT).not.toHaveBeenCalled();
    });

    it('should apply rate limiting for non-dashboard routes', async () => {
      const request = createMockRequest('/api/validation/email');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockRateLimit).toHaveBeenCalled();
      expect(mockIdempotency).toHaveBeenCalled();
    });

    it('should skip rate limiting for dashboard routes', async () => {
      const dashboardRoutes = [
        '/api-keys',
        '/v1/api-keys',
        '/webhooks',
        '/v1/webhooks',
        '/v1/usage',
        '/v1/logs'
      ];

      for (const route of dashboardRoutes) {
        const request = createMockRequest(route);
        const reply = createMockReply();
        jest.clearAllMocks();

        await hookHandler(request, reply);

        expect(mockRateLimit).not.toHaveBeenCalled();
        expect(mockIdempotency).not.toHaveBeenCalled();
      }
    });
  });
});

// Helper functions
const createMockRequest = (url: string, headers: Record<string, string> = {}): FastifyRequest => {
  return {
    url,
    headers,
    user_id: undefined,
    project_id: undefined,
  } as unknown as FastifyRequest;
};

const createMockReply = (): FastifyReply => {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  } as unknown as FastifyReply;
};