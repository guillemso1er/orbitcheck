import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import request from 'supertest';

import { auth } from '../hooks.js';
import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

describe('Security and Authentication', () => {
  let app: FastifyInstance;

  // Set up the app once before all tests in this file run
  beforeAll(async () => {
    await setupBeforeAll();
    app = await createApp(); // Correctly await the async function

    app.addHook('preHandler', async (request_: FastifyRequest, rep: FastifyReply) => {
      await auth(request_, rep, mockPool as any);
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

    // Default mock implementation: assume authentication is successful
    mockPool.query.mockImplementation((queryText: string) => {
      const upperQuery = queryText.toUpperCase();

      if (upperQuery.includes('API_KEYS')) {
        return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
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
      expect(response.statusCode).toBe(400);
    });

    it('should reject requests with an invalid API key', async () => {
      // For this specific test, override the default mock to simulate a key not being found
      mockPool.query.mockImplementation((queryText: string) => {
        const upperQuery = queryText.toUpperCase();
        if (upperQuery.includes('API_KEYS')) {
          return Promise.resolve({ rows: [] }); // No key found
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app.server)
        .post('/v1/validate/email')
        .set('Authorization', 'Bearer invalid_key')
        .send({ email: 'test@example.com' });

      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
    });
  });

  describe('Security Headers', () => {
    it('should include security headers in responses', async () => {
      // This test relies on the default successful auth mock from beforeEach
      const res = await request(app.server)
        .post('/v1/validate/email')
        .set('Authorization', 'Bearer valid_key')
        .send({ email: 'test@example.com' });

      // Assuming a successful validation returns 200
      expect(res.statusCode).toBe(200);

      // Check for the security headers added by the preHandler hook in your test setup
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-xss-protection']).toBe('1; mode=block');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    });
  });
});