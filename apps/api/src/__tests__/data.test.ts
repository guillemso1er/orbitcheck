import type { FastifyInstance } from 'fastify';

import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

describe('Data Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupBeforeAll();
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /v1/data/erase', () => {
    it('should erase user data for GDPR compliance', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // DELETE logs
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // DELETE api_keys

      const response = await app.inject({
        method: 'POST',
        url: '/v1/data/erase',
        headers: {
          authorization: 'Bearer test_token'
        },
        payload: { reason: 'gdpr' }
      });

      expect(response.statusCode).toBe(202);
      const body = response.json();
      expect(body.message).toContain('Data erasure initiated for GDPR compliance');
      expect(body.request_id).toBeDefined();
    });

    it('should erase user data for CCPA compliance', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/data/erase',
        headers: {
          authorization: 'Bearer test_token'
        },
        payload: { reason: 'ccpa' }
      });

      expect(response.statusCode).toBe(202);
      const body = response.json();
      expect(body.message).toContain('Data erasure initiated for CCPA compliance');
    });

    it('should reject invalid reason', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/data/erase',
        headers: {
          authorization: 'Bearer test_token'
        },
        payload: { reason: 'invalid' }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe('INVALID_REQUEST');
    });

    it('should require reason field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/data/erase',
        headers: {
          authorization: 'Bearer test_token'
        },
        payload: {}
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /v1/logs/:id', () => {
    it('should delete a log entry', async () => {
      mockPool.query.mockImplementation(() => Promise.resolve({ rowCount: 1 }));

      const response = await app.inject({
        method: 'DELETE',
        url: '/v1/logs/test-log-id',
        headers: {
          authorization: 'Bearer test_token'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.message).toBe('Log entry deleted successfully');
      expect(body.request_id).toBeDefined();
    });

    it('should return 404 for non-existent log', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const response = await app.inject({
        method: 'DELETE',
        url: '/v1/logs/non-existent-id',
        headers: {
          authorization: 'Bearer test_token'
        }
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBe('NOT_FOUND');
    });

    it('should handle database errors', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await app.inject({
        method: 'DELETE',
        url: '/v1/logs/test-id',
        headers: {
          authorization: 'Bearer test_token'
        }
      });
      const body = response.json();
      // const error = body.error.json();
      const errorMessage = body.error.code;
      console.log('Response body:', errorMessage); // Debug log

      expect(response.statusCode).toBe(500);
    });
  });
});