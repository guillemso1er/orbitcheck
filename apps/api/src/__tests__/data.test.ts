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

// Mock argon2 to accept test tokens
jest.mock('argon2', () => ({
  verify: jest.fn().mockResolvedValue(true),
}));

const MOCK_PAT = 'pat_token'; // Use PAT token format for management routes

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
    // Only clear jest spies, not the pool mock
    jest.clearAllMocks();
    
    // Mock logEvent - don't use spyOn since we'll clear mocks
    const originalLogEvent = hooks.logEvent;
    jest.doMock('../hooks.js', () => ({
      ...jest.requireActual('../hooks.js'),
      logEvent: jest.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(() => {
    // Reset mockPool to default implementation after each test
    mockPool.query.mockImplementation(() => Promise.resolve({ rows: [] }));
  });

  describe('POST /v1/data/erase', () => {
    it('should erase user data for GDPR compliance', async () => {
      // Set up mocks - the order matters!
      mockPool.query
        // PAT verification query
        .mockResolvedValueOnce({ 
          rows: [{ 
            id: 'pat_1', 
            user_id: 'test_user', 
            scopes: ['*'],
            ip_allowlist: null,
            expires_at: null,
            disabled: false,
            token_hash: 'mock_token_hash' 
          }] 
        })
        // User verification query  
        .mockResolvedValueOnce({ rows: [{ id: 'test_user' }] })
        // Project lookup query
        .mockResolvedValueOnce({ rows: [{ project_id: 'test_project' }] })
        // Update PAT last used
        .mockResolvedValueOnce({ rows: [] })
        // Get user and project info for email
        .mockResolvedValueOnce({ rows: [{ email: 'test@example.com', project_name: 'Test Project' }] })
        // Data deletion queries
        .mockResolvedValueOnce({ rows: [] }) // DELETE FROM LOGS
        .mockResolvedValueOnce({ rows: [] }) // DELETE FROM API_KEYS  
        .mockResolvedValueOnce({ rows: [] }) // DELETE FROM WEBHOOKS
        .mockResolvedValueOnce({ rows: [] }) // DELETE FROM SETTINGS
        .mockResolvedValueOnce({ rows: [] }) // DELETE FROM JOBS
        .mockResolvedValueOnce({ rows: [{ user_id: 'test_user' }] }) // SELECT USER_ID FROM PROJECTS
        .mockResolvedValueOnce({ rows: [] }) // DELETE FROM PERSONAL_ACCESS_TOKENS
        .mockResolvedValueOnce({ rows: [] }) // DELETE FROM AUDIT_LOGS
        .mockResolvedValueOnce({ rows: [] }) // UPDATE USERS SET EMAIL
        .mockResolvedValueOnce({ rows: [] }) // INSERT INTO AUDIT_LOGS
        .mockResolvedValueOnce({ rows: [] }); // Any additional queries

      const res = await request(app.server)
        .post('/v1/data/erase')
        .set('Authorization', `Bearer ${MOCK_PAT}`)
        .send({ reason: 'gdpr' });

      expect(res.statusCode).toBe(202);
      expect(res.body.message).toContain('Data erasure initiated for GDPR compliance');
      expect(res.body.request_id).toBeDefined();
    });
  });
});