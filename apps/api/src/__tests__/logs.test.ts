import type { FastifyInstance } from 'fastify'; // Import the type for safety
import request from 'supertest';

import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

describe('Logs Retrieval Endpoints', () => {
  let app: FastifyInstance;

  // Create the app instance once before all tests in this suite run
  beforeAll(async () => {
    await setupBeforeAll(); // Set up all global mocks
    app = await createApp();  // Correctly await the async function
    await app.ready();      // Wait for the app to be ready
  });

  // Close the app instance once after all tests in this suite are finished
  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // Before each test, simply clear all mocks to ensure a clean slate.
  // We will define specific mock behaviors inside each test.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /logs', () => {
    it('should return logs for the project', async () => {
      const logEntry = { id: 'log-1', type: 'validation', endpoint: '/validate/email', reason_codes: [], status: 200, created_at: new Date().toISOString(), meta: {} };

      // Mock the DB to handle all queries for this specific request
      mockPool.query.mockImplementation((queryText: string) => {
        const upperQuery = queryText.toUpperCase();

        // Mock the query that gets the total count for pagination
        if (upperQuery.includes('COUNT(*) AS TOTAL FROM LOGS')) {
          return Promise.resolve({ rows: [{ total: 1 }] });
        }
        // Mock the query that fetches the actual log data
        if (upperQuery.includes('FROM LOGS') && upperQuery.includes('ORDER BY CREATED_AT DESC')) {
          return Promise.resolve({ rows: [logEntry] });
        }
        // Mock the authentication query
        if (upperQuery.includes('FROM API_KEYS') && upperQuery.includes('WHERE HASH =') && upperQuery.includes('PREFIX =') && upperQuery.includes('STATUS =')) {
          // Mocking API key authentication
          return Promise.resolve({ rows: [{ id: 'test_api_key_id', project_id: 'test_project' }] });
        }
        // Mock the projects query for JWT auth
        if (upperQuery.includes('FROM PROJECTS') && upperQuery.includes('WHERE P.USER_ID')) {
          return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const response = await request(app.server)
        .get('/data/logs')
        .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdF91c2VyIiwicHJvamVjdF9pZCI6InRlc3RfcHJvamVjdCJ9.test');

      expect(response.status).toBe(200);
      const body = response.body as { data: unknown[]; total_count: number };
      expect(body.data.length).toBe(1);
      expect((body.data[0] as { id: string }).id).toBe('log-1');
      expect(body.total_count).toBe(1);
    });

    it('should filter logs by reason_code', async () => {
      const logEntry = { id: 'log-filtered', type: 'validation', endpoint: '/validate/email', reason_codes: ['email.invalid_format'], status: 200, created_at: new Date().toISOString(), meta: {} };

      mockPool.query.mockImplementation((queryText: string) => {
        const upperQuery = queryText.toUpperCase();

        if (upperQuery.includes('REASON_CODES @> ARRAY[') && upperQuery.includes('ORDER BY CREATED_AT DESC')) {
          return Promise.resolve({ rows: [logEntry] });
        }
        if (upperQuery.includes('COUNT(*) AS TOTAL FROM LOGS')) {
          return Promise.resolve({ rows: [{ total: 1 }] });
        }
        if (upperQuery.includes('FROM API_KEYS') && upperQuery.includes('WHERE HASH =') && upperQuery.includes('PREFIX =') && upperQuery.includes('STATUS =')) {
          // Mocking API key authentication
          return Promise.resolve({ rows: [{ id: 'test_api_key_id', project_id: 'test_project' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const response = await request(app.server)
        .get('/data/logs?reason_code=email.invalid_format')
        .set('Authorization', 'Bearer test_api_key_12345678901234567890123456789012');

      expect(response.status).toBe(200);
      const body = response.body as { data: { reason_codes: string[] }[] };
      expect((body.data[0] as { reason_codes: string[] }).reason_codes).toContain('email.invalid_format');
    });

    it('should filter logs by endpoint and status', async () => {
      const logEntry = { id: 'log-status', type: 'validation', endpoint: '/v1/validate/email', reason_codes: [], status: 400, created_at: new Date().toISOString(), meta: {} };

      mockPool.query.mockImplementation((queryText: string) => {
        const upperQuery = queryText.toUpperCase();

        if (upperQuery.includes('ENDPOINT = $') && upperQuery.includes('STATUS = $') && upperQuery.includes('ORDER BY CREATED_AT DESC')) {
          return Promise.resolve({ rows: [logEntry] });
        }
        if (upperQuery.includes('COUNT(*) AS TOTAL FROM LOGS')) {
          return Promise.resolve({ rows: [{ total: 1 }] });
        }
        if (upperQuery.includes('FROM API_KEYS') && upperQuery.includes('WHERE HASH =') && upperQuery.includes('PREFIX =') && upperQuery.includes('STATUS =')) {
          // Mocking API key authentication
          return Promise.resolve({ rows: [{ id: 'test_api_key_id', project_id: 'test_project' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const response = await request(app.server)
        .get('/data/logs?endpoint=/v1/validate/email&status=400')
        .set('Authorization', 'Bearer test_api_key_12345678901234567890123456789012');

      expect(response.status).toBe(200);
      const body = response.body as { data: { endpoint: string; status: number }[] };
      expect((body.data[0] as { endpoint: string }).endpoint).toBe('/v1/validate/email');
      expect((body.data[0] as { status: number }).status).toBe(400);
    });

    it('should handle pagination with limit and offset', async () => {
      const logEntries = [
        { id: 'log-1', type: 'validation', endpoint: '/validate/email', reason_codes: [], status: 200, created_at: new Date(Date.now() - 2000).toISOString(), meta: {} },
        { id: 'log-2', type: 'validation', endpoint: '/validate/email', reason_codes: [], status: 200, created_at: new Date().toISOString(), meta: {} }
      ];

      mockPool.query.mockImplementation((queryText: string) => {
        const upperQuery = queryText.toUpperCase();

        if (upperQuery.includes('FROM LOGS') && upperQuery.includes('ORDER BY CREATED_AT DESC')) {
          return Promise.resolve({ rows: [logEntries[0]] });
        }
        if (upperQuery.includes('COUNT(*) AS TOTAL FROM LOGS')) {
          return Promise.resolve({ rows: [{ total: 2 }] });
        }
        if (upperQuery.includes('API_KEYS')) {
          return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const response = await request(app.server)
        .get('/data/logs?limit=1&offset=1')
        .set('Authorization', 'Bearer test_api_key_12345678901234567890123456789012');

      expect(response.status).toBe(200);
      const body = response.body as { data: { id: string }[]; total_count: number; next_cursor: string };
      expect(body.data.length).toBe(1);
      expect((body.data[0] as { id: string }).id).toBe('log-1');
      expect(body.total_count).toBe(2);
      expect(body.next_cursor).toBe('2');
    });
  });
});