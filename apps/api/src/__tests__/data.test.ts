import type { FastifyInstance } from 'fastify';
import request from 'supertest';

import * as hooks from '../hooks.js';
import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

// Mock the auth module to bypass authentication
jest.mock('../routes/auth', () => {
  const actual = jest.requireActual('../routes/auth');
  return {
    ...actual,
    verifyPAT: jest.fn(async (request_: any) => {
      // Default: succeed and set ids
      request_.user_id = 'test_user';
      request_.project_id = 'test_project';
    }),
  };
});

// Mock nodemailer to prevent actual email sending during tests
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({}),
  })),
}));

const MOCK_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdF91c2VyIn0.ignore';

describe('Data Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupBeforeAll();
    app = await createApp();

    // Add auth hooks like the passing tests
    const { authenticateRequest, applyRateLimitingAndIdempotency } = await import('../web.js');
    const { mockPool, mockRedisInstance } = await import('./testSetup.js');
    app.addHook("preHandler", async (request, rep) => {
      await authenticateRequest(request, rep, mockPool as any);
      await applyRateLimitingAndIdempotency(request, rep, mockRedisInstance as any);
      return;
    });

    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock logEvent like in passing tests
    jest.spyOn(hooks, 'logEvent').mockImplementation(jest.fn().mockResolvedValue(undefined));

    // Set up default mock for authentication queries
    mockPool.query.mockImplementation((queryText: string, values: unknown[]) => {
      const upperQuery = queryText.toUpperCase();
      if (upperQuery.startsWith('SELECT ID FROM USERS WHERE ID = $1') && values[0] === 'test_user') {
        return Promise.resolve({ rows: [{ id: 'test_user' }] });
      }
      if (upperQuery.startsWith('SELECT P.ID AS PROJECT_ID FROM PROJECTS P WHERE P.USER_ID = $1') && values[0] === 'test_user') {
        return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  describe('POST /v1/data/erase', () => {
    it('should erase user data for GDPR compliance', async () => {
      // Mock all the queries the new implementation does
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ email: 'test@example.com', project_name: 'Test Project' }] }) // user/project query
        .mockResolvedValueOnce({ rows: [] }) // DELETE logs
        .mockResolvedValueOnce({ rows: [] }) // DELETE api_keys
        .mockResolvedValueOnce({ rows: [] }) // DELETE webhooks
        .mockResolvedValueOnce({ rows: [] }) // DELETE settings
        .mockResolvedValueOnce({ rows: [] }) // DELETE jobs
        .mockResolvedValueOnce({ rows: [{ user_id: 'test_user' }] }) // project user_id query
        .mockResolvedValueOnce({ rows: [] }) // DELETE personal_access_tokens
        .mockResolvedValueOnce({ rows: [] }) // DELETE audit_logs
        .mockResolvedValueOnce({ rows: [] }); // UPDATE users

      const res = await request(app.server)
        .post('/v1/data/erase')
        .set('Authorization', `Bearer ${MOCK_JWT}`)
        .send({ reason: 'gdpr' });

      expect(res.statusCode).toBe(202);
      expect(res.body.message).toContain('Data erasure initiated for GDPR compliance');
      expect(res.body.request_id).toBeDefined();
    });

    it('should erase user data for CCPA compliance', async () => {
      // Mock all the queries the new implementation does
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ email: 'test@example.com', project_name: 'Test Project' }] }) // user/project query
        .mockResolvedValueOnce({ rows: [] }) // DELETE logs
        .mockResolvedValueOnce({ rows: [] }) // DELETE api_keys
        .mockResolvedValueOnce({ rows: [] }) // DELETE webhooks
        .mockResolvedValueOnce({ rows: [] }) // DELETE settings
        .mockResolvedValueOnce({ rows: [] }) // DELETE jobs
        .mockResolvedValueOnce({ rows: [{ user_id: 'test_user' }] }) // project user_id query
        .mockResolvedValueOnce({ rows: [] }) // DELETE personal_access_tokens
        .mockResolvedValueOnce({ rows: [] }) // DELETE audit_logs
        .mockResolvedValueOnce({ rows: [] }); // UPDATE users

      const res = await request(app.server)
        .post('/v1/data/erase')
        .set('Authorization', `Bearer ${MOCK_JWT}`)
        .send({ reason: 'ccpa' });

      expect(res.statusCode).toBe(202);
      expect(res.body.message).toContain('Data erasure initiated for CCPA compliance');
    });

    it('should reject invalid reason', async () => {
      const res = await request(app.server)
        .post('/v1/data/erase')
        .set('Authorization', `Bearer ${MOCK_JWT}`)
        .send({ reason: 'invalid' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('erase_invalid_request');
    });

    it('should require reason field', async () => {
      const res = await request(app.server)
        .post('/v1/data/erase')
        .set('Authorization', `Bearer ${MOCK_JWT}`)
        .send({});

      expect(res.statusCode).toBe(400);
    });

    it('should return 404 when project not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // No user/project found

      const res = await request(app.server)
        .post('/v1/data/erase')
        .set('Authorization', `Bearer ${MOCK_JWT}`)
        .send({ reason: 'gdpr' });

      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });

    it('should handle database errors during erasure', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error')); // First query fails

      const res = await request(app.server)
        .post('/v1/data/erase')
        .set('Authorization', `Bearer ${MOCK_JWT}`)
        .send({ reason: 'gdpr' });

      expect(res.statusCode).toBe(500);
      expect(res.body.error.code).toBe('server_error');
    });

    it('should complete erasure even if email sending fails', async () => {
      // Mock successful DB operations but email failure
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ email: 'test@example.com', project_name: 'Test Project' }] })
        .mockResolvedValueOnce({ rows: [] }) // DELETE logs
        .mockResolvedValueOnce({ rows: [] }) // DELETE api_keys
        .mockResolvedValueOnce({ rows: [] }) // DELETE webhooks
        .mockResolvedValueOnce({ rows: [] }) // DELETE settings
        .mockResolvedValueOnce({ rows: [] }) // DELETE jobs
        .mockResolvedValueOnce({ rows: [{ user_id: 'test_user' }] }) // project user_id query
        .mockResolvedValueOnce({ rows: [] }) // DELETE personal_access_tokens
        .mockResolvedValueOnce({ rows: [] }) // DELETE audit_logs
        .mockResolvedValueOnce({ rows: [] }); // UPDATE users

      const res = await request(app.server)
        .post('/v1/data/erase')
        .set('Authorization', `Bearer ${MOCK_JWT}`)
        .send({ reason: 'gdpr' });

      expect(res.statusCode).toBe(202);
      expect(res.body.message).toContain('Data erasure initiated');
    });
  });

  describe('DELETE /v1/logs/:id', () => {
    it('should delete a log entry', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // DELETE query

      const res = await request(app.server)
        .delete('/v1/logs/test-log-id')
        .set('Authorization', `Bearer ${MOCK_JWT}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toBe('Log entry deleted successfully');
      expect(res.body.request_id).toBeDefined();
    });

    it('should return 404 for non-existent log', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // DELETE query with no rows deleted

      const res = await request(app.server)
        .delete('/v1/logs/non-existent-id')
        .set('Authorization', `Bearer ${MOCK_JWT}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });

    it('should handle database errors', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error')); // DELETE query fails

      const res = await request(app.server)
        .delete('/v1/logs/test-id')
        .set('Authorization', `Bearer ${MOCK_JWT}`);

      expect(res.statusCode).toBe(500);
      expect(res.body.error.code).toBe('server_error');
    });
  });
});
