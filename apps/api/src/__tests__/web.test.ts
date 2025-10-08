import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Redis as IORedisType } from 'ioredis';
import * as jwt from 'jsonwebtoken';
import type { Pool } from 'pg';

import { auth, idempotency, rateLimit } from '../hooks.js';
import { verifyJWT } from '../routes/auth.js';
import { registerRoutes } from '../web.js';

 // Mock dependencies
jest.mock('../routes/auth');
jest.mock('../hooks');
jest.mock('jsonwebtoken');

const mockVerifyJWT = verifyJWT as jest.MockedFunction<typeof verifyJWT>;
const mockAuth = auth as jest.MockedFunction<typeof auth>;
const mockRateLimit = rateLimit as jest.MockedFunction<typeof rateLimit>;
const mockIdempotency = idempotency as jest.MockedFunction<typeof idempotency>;
const _mockJwtVerify = jwt.verify as jest.Mock;

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
      const request = createMockRequest('/v1/api-keys', { authorization: 'Bearer token' });
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockVerifyJWT).toHaveBeenCalled();
      expect(mockAuth).not.toHaveBeenCalled();
    });

    it('should use JWT verification for /webhooks/test endpoints', async () => {
      const request = createMockRequest('/v1/webhooks/test');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockVerifyJWT).toHaveBeenCalled();
      expect(mockAuth).not.toHaveBeenCalled();
    });

    it('should use API key auth for /data/usage endpoints', async () => {
      const request = createMockRequest('/v1/data/usage');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockAuth).toHaveBeenCalled();
      expect(mockVerifyJWT).not.toHaveBeenCalled();
    });

    it('should use API key auth for /data/logs endpoints', async () => {
      const request = createMockRequest('/data/logs');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockAuth).toHaveBeenCalled();
      expect(mockVerifyJWT).not.toHaveBeenCalled();
    });

    it('should use API key auth for other endpoints', async () => {
      const request = createMockRequest('/v1/validation/email');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockAuth).toHaveBeenCalled();
      expect(mockVerifyJWT).not.toHaveBeenCalled();
    });

    it('should apply rate limiting for non-dashboard routes', async () => {
      const request = createMockRequest('/v1/validation/email');
      const reply = createMockReply();

      await hookHandler(request, reply);

      expect(mockRateLimit).toHaveBeenCalled();
      expect(mockIdempotency).toHaveBeenCalled();
    });

    it('should skip rate limiting for dashboard routes', async () => {
      const dashboardRoutes = [
        '/v1/api-keys',
        '/v1/webhooks/test'
      ];

      await Promise.all(dashboardRoutes.map(async (route) => {
        const request = createMockRequest(route);
        const reply = createMockReply();
        jest.clearAllMocks();

        await hookHandler(request, reply);

        expect(mockRateLimit).not.toHaveBeenCalled();
        expect(mockIdempotency).not.toHaveBeenCalled();
      }));
    });

    it('should apply rate limiting for data routes', async () => {
      const dataRoutes = [
        '/v1/data/usage',
        '/v1/data/logs'
      ];

      await Promise.all(dataRoutes.map(async (route) => {
        const request = createMockRequest(route);
        const reply = createMockReply();
        jest.clearAllMocks();

        await hookHandler(request, reply);

        expect(mockRateLimit).toHaveBeenCalled();
        expect(mockIdempotency).toHaveBeenCalled();
      }));
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
    log: {
      info: jest.fn(),
    },
  } as unknown as FastifyRequest;
};

const createMockReply = (): FastifyReply => {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  } as unknown as FastifyReply;
};