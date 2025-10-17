import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from "pg";
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
      await auth(request_, rep, mockPool as unknown as Pool);
      return;
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

      expect(result.statusCode).toBe(400);
      expect((result.body as { error: { code: string } }).error.code).toBe('unauthorized');
    });
  });

  describe('Security Headers', () => {
    it('should include security headers in responses', async () => {
      // This test relies on the default successful auth mock from beforeEach
      const result = await request(app.server)
        .post('/v1/validate/email')
        .set('Authorization', 'Bearer valid_key')
        .send({ email: 'test@example.com' });

      // Assuming a successful validation returns 200
      expect(result.statusCode).toBe(200);

      // Check for the security headers added by the preHandler hook in your test setup
      expect(result.headers['x-content-type-options']).toBe('nosniff');
      expect(result.headers['x-frame-options']).toBe('DENY');
      expect(result.headers['x-xss-protection']).toBe('1; mode=block');
      expect(result.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(result.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    });
  });
});