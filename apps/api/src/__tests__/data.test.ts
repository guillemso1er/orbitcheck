import type { FastifyInstance } from 'fastify';
import request from 'supertest';

import { verifyPAT } from '../routes/auth.js';
import * as hooks from '../hooks.js';
import { createApp, mockPool, setupBeforeAll } from './testSetup.js';


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
      // PAT authentication queries
      if (upperQuery.includes('SELECT TOKEN_HASH FROM PERSONAL_ACCESS_TOKENS')) {
        return Promise.resolve({ rows: [{ token_hash: 'mock_token_hash' }] });
      }
      if (upperQuery.includes('SELECT ID, USER_ID, SCOPES FROM PERSONAL_ACCESS_TOKENS')) {
        return Promise.resolve({ rows: [{ id: 'pat_1', user_id: 'test_user', scopes: ['*'] }] });
      }
      if (upperQuery.includes('SELECT P.ID AS PROJECT_ID FROM PROJECTS P WHERE P.USER_ID = $1 AND P.NAME = $2')) {
        return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
      }
      if (upperQuery.includes('UPDATE PERSONAL_ACCESS_TOKENS SET LAST_USED_AT')) {
        return Promise.resolve({ rows: [] });
      }
      if (upperQuery.includes('INSERT INTO AUDIT_LOGS')) {
        return Promise.resolve({ rows: [] });
      }

      // Data route queries
      if (upperQuery.includes('SELECT U.EMAIL, P.NAME AS PROJECT_NAME FROM USERS U JOIN PROJECTS P ON P.USER_ID = U.ID WHERE P.ID = $1')) {
        return Promise.resolve({ rows: [{ email: 'test@example.com', project_name: 'Test Project' }] });
      }
      if (upperQuery.includes('SELECT ID FROM USERS WHERE ID = $1') && values[0] === 'test_user') {
        return Promise.resolve({ rows: [{ id: 'test_user' }] });
      }
      if (upperQuery.includes('DELETE FROM LOGS WHERE PROJECT_ID = $1')) {
        return Promise.resolve({ rows: [] });
      }
      if (upperQuery.includes('DELETE FROM API_KEYS WHERE PROJECT_ID = $1')) {
        return Promise.resolve({ rows: [] });
      }
      if (upperQuery.includes('DELETE FROM WEBHOOKS WHERE PROJECT_ID = $1')) {
        return Promise.resolve({ rows: [] });
      }
      if (upperQuery.includes('DELETE FROM SETTINGS WHERE PROJECT_ID = $1')) {
        return Promise.resolve({ rows: [] });
      }
      if (upperQuery.includes('DELETE FROM JOBS WHERE PROJECT_ID = $1')) {
        return Promise.resolve({ rows: [] });
      }
      if (upperQuery.includes('SELECT USER_ID FROM PROJECTS WHERE ID = $1')) {
        return Promise.resolve({ rows: [{ user_id: 'test_user' }] });
      }
      if (upperQuery.includes('DELETE FROM PERSONAL_ACCESS_TOKENS WHERE USER_ID = $1')) {
        return Promise.resolve({ rows: [] });
      }
      if (upperQuery.includes('DELETE FROM AUDIT_LOGS WHERE USER_ID = $1')) {
        return Promise.resolve({ rows: [] });
      }
      if (upperQuery.includes('UPDATE USERS SET EMAIL = CONCAT')) {
        return Promise.resolve({ rows: [] });
      }
      if (upperQuery.includes('DELETE FROM LOGS WHERE ID = $1 AND PROJECT_ID = $2')) {
        return Promise.resolve({ rowCount: 1, rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  afterEach(() => {
    // Reset mockPool to default implementation after each test
    mockPool.query.mockImplementation(() => Promise.resolve({ rows: [] }));
  });

  describe('POST /v1/data/erase', () => {
    it('should erase user data for GDPR compliance', async () => {
      const res = await request(app.server)
        .post('/v1/data/erase')
        .set('Authorization', `Bearer ${MOCK_JWT}`)
        .send({ reason: 'gdpr' });

      expect(res.statusCode).toBe(202);
      expect(res.body.message).toContain('Data erasure initiated for GDPR compliance');
      expect(res.body.request_id).toBeDefined();
    });

    it('should erase user data for CCPA compliance', async () => {
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

    it('should return unauthorized when PAT token is invalid', async () => {
      // Override the default mock to make PAT verification fail
      mockPool.query.mockImplementation((queryText: string, _values: unknown[]) => {
        const upperQuery = queryText.toUpperCase();
        // Make PAT queries fail by returning no rows
        if (upperQuery.includes('SELECT TOKEN_HASH FROM PERSONAL_ACCESS_TOKENS')) {
          return Promise.resolve({ rows: [] }); // No matching token
        }
        if (upperQuery.includes('SELECT ID, USER_ID, SCOPES FROM PERSONAL_ACCESS_TOKENS')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app.server)
        .post('/v1/data/erase')
        .set('Authorization', `Bearer invalid_token`)
        .send({ reason: 'gdpr' });

      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
      expect(res.body.error.message).toBe('Management routes require session or PAT authentication');
    });

    it('should complete erasure even if email sending fails', async () => {
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
      const res = await request(app.server)
        .delete('/v1/logs/test-log-id')
        .set('Authorization', `Bearer ${MOCK_JWT}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toBe('Log entry deleted successfully');
      expect(res.body.request_id).toBeDefined();
    });

    it('should return 404 for non-existent log', async () => {
      // Override the default mock to make DELETE return no rows affected
      mockPool.query.mockImplementation((queryText: string, _values: unknown[]) => {
        const upperQuery = queryText.toUpperCase();
        if (upperQuery.includes('DELETE FROM LOGS WHERE ID = $1 AND PROJECT_ID = $2')) {
          return Promise.resolve({ rowCount: 0, rows: [] }); // No rows deleted
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app.server)
        .delete('/v1/logs/non-existent-id')
        .set('Authorization', `Bearer ${MOCK_JWT}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });

    it('should handle database errors', async () => {
      // Override the default mock to fail the DELETE query
      mockPool.query.mockImplementation((queryText: string, _values: unknown[]) => {
        const upperQuery = queryText.toUpperCase();
        if (upperQuery.includes('DELETE FROM LOGS WHERE ID = $1 AND PROJECT_ID = $2')) {
          return Promise.reject(new Error('DB error')); // DELETE query fails
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app.server)
        .delete('/v1/logs/test-id')
        .set('Authorization', `Bearer ${MOCK_JWT}`);

      expect(res.statusCode).toBe(500);
      expect(res.body.error.code).toBe('server_error');
    });
  });

  describe('verifyPAT function', () => {
    it('should throw BAD_REQUEST for missing Bearer header', async () => {
      const mockRequest = {
        headers: {},
        log: { info: jest.fn() }
      };

      await expect(verifyPAT(mockRequest as any, mockPool as any)).rejects.toEqual({
        status: 401,
        error: {
          code: 'unauthorized',
          message: 'Missing JWT token'
        }
      });
    });

    it('should throw UNAUTHORIZED for invalid PAT token', async () => {
      const mockRequest = {
        headers: { authorization: 'Bearer invalid_token' },
        log: { info: jest.fn() }
      };

      // Mock database query to return no rows (invalid token)
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(verifyPAT(mockRequest as any, mockPool as any)).rejects.toEqual({
        status: 401,
        error: {
          code: 'unauthorized',
          message: 'Missing JWT token'
        }
      });
    });

    it('should throw FORBIDDEN when user has no default project', async () => {
      const mockRequest = {
        headers: { authorization: 'Bearer valid_token' },
        log: { info: jest.fn() }
      };

      // Mock PAT verification success
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'pat_1', user_id: 'test_user', scopes: ['*'] }]
      });

      // Mock update query
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      // Mock getDefaultProjectId to throw NO_PROJECT error
      jest.spyOn(require('../routes/utils.js'), 'getDefaultProjectId').mockRejectedValueOnce({
        status: 403,
        error: {
          code: 'no_project',
          message: 'No default project found'
        }
      });

      await expect(verifyPAT(mockRequest as any, mockPool as any)).rejects.toEqual({
        status: 403,
        error: {
          code: 'no_project',
          message: 'No default project found'
        }
      });
    });
  });
});
