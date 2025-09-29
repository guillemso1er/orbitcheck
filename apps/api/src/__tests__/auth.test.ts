// src/__tests__/auth.test.ts

import { setupBeforeAll, createApp, mockPool } from './testSetup';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
// The Fastify instance type can be useful for type safety
import { FastifyInstance } from 'fastify';

describe('Auth Routes', () => {
  let app: FastifyInstance; // Use FastifyInstance for better type checking

  beforeAll(async () => {
    // This MUST be awaited to ensure all async operations inside it complete
    await setupBeforeAll();
    app = await createApp(); // createApp can be async, so await it
    await app.ready();
  });

  afterAll(async () => {
    // This will now work because 'app' will be defined
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-set essential mocks after clearAllMocks
    // Note: It's often better to re-import or re-require mocks if they are stateful
    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');
    const cryptoModule = require('crypto');

    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (jwt.sign as jest.Mock).mockReturnValue('mock_jwt_token');
    (jwt.verify as jest.Mock).mockReturnValue({ user_id: 'test_user' });

    (cryptoModule.randomBytes as jest.Mock).mockReturnValue(Buffer.from('test32bytes' + 'a'.repeat(24)));
    (cryptoModule.createHash as jest.Mock).mockImplementation(() => ({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue('test_hash')
    }));
    (cryptoModule.randomUUID as jest.Mock).mockReturnValue('123e4567-e89b-12d3-a456-426614174000');

    // Reset Redis mocks
    const mockRedisInstance = require('./testSetup').mockRedisInstance;
    mockRedisInstance.sismember.mockResolvedValue(0);
    mockRedisInstance.incr.mockResolvedValue(1);
    mockRedisInstance.expire.mockResolvedValue(true);
    mockRedisInstance.get.mockResolvedValue(null);
    mockRedisInstance.set.mockResolvedValue('OK');
    mockRedisInstance.quit.mockResolvedValue('OK');

    // Default mock for auth DB queries
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

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'test@example.com', password: 'password123' }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
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
      rowCount?: number;
    }

    mockPool.query.mockImplementation((queryText: string): Promise<QueryResult<UserRow>> => {
      if (queryText.includes('SELECT id, password_hash FROM users')) {
        return Promise.resolve({ rows: [{ id: 'user_1', password_hash: 'hashed_password' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'test@example.com', password: 'password123' }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
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
      rowCount?: number;
    }

    mockPool.query.mockImplementation((queryText: string): Promise<QueryResult<UserRow>> => {
      if (queryText.includes('SELECT id, password_hash FROM users')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'invalid@example.com', password: 'wrong' }
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe('invalid_credentials');
  });
});