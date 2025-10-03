// Mock native and external modules at the top level
jest.mock('node:crypto'); // <--- ADD THIS LINE
jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn(),
}));

import * as crypto from 'node:crypto';

import * as bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import * as jwt from 'jsonwebtoken';

import { createApp, mockPool, mockRedisInstance, setupBeforeAll } from './testSetup.js';

describe('Auth Routes', () => {
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

    // Now you can safely mock the crypto functions
    (crypto.randomBytes as jest.Mock).mockReturnValue(Buffer.from('test32bytes' + 'a'.repeat(24)));
    (crypto.createHash as jest.Mock).mockImplementation(() => ({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue('test_hash')
    }));

    // It's good practice to also mock any other functions from the module you use
    // If your `generateRequestId` uses `randomUUID`, this mock is necessary.
    if (crypto.randomUUID) {
      (crypto.randomUUID as jest.Mock).mockReturnValue('123e4567-e89b-12d3-a456-426614174000');
    }

    // Reset other mocks
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (jwt.sign as jest.Mock).mockReturnValue('mock_jwt_token');
    (jwt.verify as jest.Mock).mockReturnValue({ user_id: 'test_user' });

    // Reset Redis mocks
    mockRedisInstance.sismember.mockResolvedValue(0);
    mockRedisInstance.incr.mockResolvedValue(1);
    mockRedisInstance.expire.mockResolvedValue(true);
    mockRedisInstance.get.mockResolvedValue(null);
    mockRedisInstance.set.mockResolvedValue('OK');
    mockRedisInstance.quit.mockResolvedValue('OK');

    // Default mock for DB queries
    mockPool.query.mockImplementation((queryText: string) => {
      const upperQuery = queryText.toUpperCase();
      if (upperQuery.includes('API_KEYS')) {
        return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
      }
      if (upperQuery.startsWith('INSERT INTO LOGS')) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  it('should register a new user successfully', async () => {
    mockPool.query.mockImplementation((queryText: string) => {
      if (queryText.includes('INSERT INTO users')) {
        return Promise.resolve({ rows: [{ id: 'user_1', email: 'test@example.com' }] });
      }
      if (queryText.includes('INSERT INTO projects')) {
        return Promise.resolve({ rows: [{ id: 'project_1' }] });
      }
      if (queryText.includes('INSERT INTO api_keys')) {
        return Promise.resolve({ rows: [{ id: 'default_key_id', created_at: new Date().toISOString() }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'test@example.com', password: 'password123' }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ token: string; user: { id: string } }>();
    expect(jwt.sign).toHaveBeenCalled();
    expect(body.token).toBe('mock_jwt_token');
    expect(body.user.id).toBe('user_1');
  });

  it('should login a user successfully', async () => {
    interface UserRow {
      id: string;
      password_hash: string;
    }
    interface QueryResult<T> {
      rows: T[];
    }

    mockPool.query.mockImplementation((queryText: string): Promise<QueryResult<UserRow>> => {
      if (queryText.includes('SELECT id, password_hash FROM users')) {
        return Promise.resolve({ rows: [{ id: 'user_1', password_hash: 'hashed_password' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'test@example.com', password: 'password123' }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ token: string; user: { id: string } }>();
    expect(bcrypt.compare).toHaveBeenCalled();
    expect(jwt.sign).toHaveBeenCalled();
    expect(body.token).toBe('mock_jwt_token');
    expect(body.user.id).toBe('user_1');
  });

  it('should reject login with invalid credentials', async () => {
    interface UserRow {
      id: string;
      password_hash: string;
    }
    interface QueryResult<T> {
      rows: T[];
    }

    mockPool.query.mockImplementation((queryText: string): Promise<QueryResult<UserRow>> => {
      if (queryText.includes('SELECT id, password_hash FROM users')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'invalid@example.com', password: 'wrong' }
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('invalid_credentials');
  });
});