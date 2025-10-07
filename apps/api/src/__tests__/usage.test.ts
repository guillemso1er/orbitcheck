import type { FastifyInstance } from 'fastify'; // Import the type for safety
import request from 'supertest';

import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

describe('Usage Stats Endpoints', () => {
  let app: FastifyInstance;

  // Create the app once before all tests in this suite run
  beforeAll(async () => {
    await setupBeforeAll();   // Set up all global mocks
    app = await createApp();    // Await the async function to get the app instance
    await app.ready();        // Wait for the app to be fully ready
  });

  // Close the app once after all tests in this suite have finished
  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // Before each test, just clear mocks to ensure test isolation
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /usage', () => {
    it('should return usage stats when data is present', async () => {
      const usageData = [
        { date: '2023-01-01', validations: 10, orders: 5 },
        { date: '2023-01-02', validations: 20, orders: 10 },
      ];

      // Mock all the necessary DB queries for this specific test case
      mockPool.query.mockImplementation((queryText: string) => {
        const upperQuery = queryText.toUpperCase();

        if (upperQuery.includes('FROM USAGE_DAILY')) {
          return Promise.resolve({ rows: usageData });
        }
        if (upperQuery.includes('UNNEST(REASON_CODES) AS CODE')) {
          // Mocking top reason codes
          return Promise.resolve({ rows: [{ code: 'email.valid', count: 20 }] });
        }
        if (upperQuery.includes('COUNT(*) AS TOTAL_REQUESTS FROM LOGS')) {
          // Mocking total requests for cache hit ratio calculation
          return Promise.resolve({ rows: [{ total_requests: 300 }] });
        }
        if (upperQuery.includes('COUNT(*) AS CACHED_REQUESTS FROM LOGS')) {
          // Mocking cached requests for cache hit ratio (300 total - 15 non-cached = 285 cached)
          return Promise.resolve({ rows: [{ cached_requests: 285 }] });
        }
        if (upperQuery.includes('API_KEYS')) {
          // Mocking the authentication query
          return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
        }
        // Mock the projects query for JWT auth
        if (upperQuery.includes('FROM PROJECTS') && upperQuery.includes('WHERE P.USER_ID')) {
          return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const _result = await request(app.server)
        .get('/data/usage')
        .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdF91c2VyIiwicHJvamVjdF9pZCI6InRlc3RfcHJvamVjdCJ9.test');

      expect(_result.statusCode).toBe(200);
      // Sum of validations from usageData
      expect(_result.body.totals.validations).toBe(30);
      // Sum of orders from usageData
      expect(_result.body.totals.orders).toBe(15);
      expect(_result.body.by_day.length).toBe(2);
      expect(_result.body.top_reason_codes.length).toBe(1);
      expect(_result.body.top_reason_codes[0].code).toBe('email.valid');
      // 285 cached / 300 total = 0.95
      expect(_result.body.cache_hit_ratio).toBeCloseTo(95);
    });

    it('should handle no usage data gracefully', async () => {
      // Mock all DB queries to return empty or zero results for this test case
      mockPool.query.mockImplementation((queryText: string) => {
        const upperQuery = queryText.toUpperCase();

        if (upperQuery.includes('COUNT(*) AS TOTAL_REQUESTS FROM LOGS')) {
          return Promise.resolve({ rows: [{ total_requests: 0 }] });
        }
        if (upperQuery.includes('COUNT(*) AS CACHED_REQUESTS FROM LOGS')) {
          return Promise.resolve({ rows: [{ cached_requests: 0 }] });
        }
        if (upperQuery.includes('API_KEYS')) {
          return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
        }
        // Mock the projects query for JWT auth
        if (upperQuery.includes('FROM projects') && upperQuery.includes('WHERE p.user_id')) {
          return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
        }
        // For all other queries (usage_daily, reason_codes), return empty rows
        return Promise.resolve({ rows: [] });
      });

      const _result = await request(app.server)
        .get('/data/usage')
        .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdF91c2VyIiwicHJvamVjdF9pZCI6InRlc3RfcHJvamVjdCJ9.test');

      expect(_result.statusCode).toBe(200);
      expect(_result.body.totals.validations).toBe(0);
      expect(_result.body.totals.orders).toBe(0);
      expect(_result.body.by_day.length).toBe(0);
      expect(_result.body.top_reason_codes.length).toBe(0);
      // 0 / 0 should be handled as 0 in the endpoint logic
      expect(_result.body.cache_hit_ratio).toBe(0);
    });
  });
});