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
jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
}));

import * as crypto from 'node:crypto';

import * as bcrypt from 'bcryptjs';
import * as argon2 from 'argon2';
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
    (crypto.randomBytes as jest.Mock).mockImplementation((size, callback) => {
      if (callback) {
        if (size === 32) {
          callback(null, Buffer.from('test32bytes' + 'a'.repeat(24)));
        } else if (size === 16) {
          callback(null, Buffer.from('1234567890123456'));
        } else {
          callback(null, Buffer.alloc(size));
        }
      } else {
        if (size === 32) {
          return Buffer.from('test32bytes' + 'a'.repeat(24));
        } else if (size === 16) {
          return Buffer.from('1234567890123456');
        } else {
          return Buffer.alloc(size);
        }
      }
    });
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

    // Mock crypto.randomBytes to return a buffer synchronously (for synchronous usage)
    (crypto.randomBytes as jest.Mock).mockReturnValue(Buffer.from('test32bytes' + 'a'.repeat(24)));
    // Mock crypto.createHash
    (crypto.createHash as jest.Mock).mockImplementation(() => ({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue('test_hash')
    }));
    // Mock crypto.createCipheriv
    (crypto.createCipheriv as jest.Mock).mockImplementation(() => ({
      update: jest.fn().mockReturnValue('encrypted_'),
      final: jest.fn().mockReturnValue('final')
    }));

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
      if (queryText.includes('INSERT INTO personal_access_tokens')) {
        return Promise.resolve({ rows: [{ id: 'pat_1', created_at: new Date().toISOString() }] });
      }
      if (queryText.includes('SELECT * FROM plans WHERE slug')) {
        return Promise.resolve({ rows: [{ id: 'plan_free', slug: 'free', name: 'Free Plan' }] });
      }
      if (queryText.includes('UPDATE users SET plan_id')) {
        return Promise.resolve({ rowCount: 1 });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'test@example.com', password: 'password123', confirm_password: 'password123' }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ user: { id: string; email: string }; request_id: string }>();
    expect(body.user.id).toBe('user_1');
    expect(body.user.email).toBe('test@example.com');
  });

  it('should login a user successfully', async () => {
    interface QueryResult<T> {
      rows: T[];
    }

    // Clear all previous mocks
    jest.clearAllMocks();

    mockPool.query.mockImplementation((queryText: string): Promise<QueryResult<any>> => {
      const upperQuery = queryText.toUpperCase();
      
      // Login query
      if (upperQuery.includes('SELECT') && upperQuery.includes('EMAIL') && upperQuery.includes('USERS')) {
        return Promise.resolve({ rows: [{ id: 'user_1', email: 'test@example.com', password_hash: 'hashed_password' }] });
      }
      
      // PAT insertion query
      if (upperQuery.includes('INSERT') && upperQuery.includes('PERSONAL_ACCESS_TOKENS')) {
        return Promise.resolve({ rows: [] });
      }
      
      return Promise.resolve({ rows: [] });
    });

    // Mock bcrypt.compare to return true
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    // Mock bcrypt.hash for any hash operations
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
    // Mock argon2.hash for PAT creation
    (argon2.hash as jest.Mock).mockResolvedValue('mock_argon2_hash');
    // Mock jwt.sign to return a token
    (jwt.sign as jest.Mock).mockReturnValue('mock_pat_token');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'test@example.com', password: 'password123' }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ user: { id: string; email: string }; pat_token: string; request_id: string }>();
    expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'hashed_password');
    expect(body.user.id).toBe('user_1');
    expect(body.user.email).toBe('test@example.com');
    expect(body.pat_token).toBeDefined();
  });

  it('should reject login with invalid credentials', async () => {
    // Clear all previous mocks
    jest.clearAllMocks();

    mockPool.query.mockImplementation((queryText: string) => {
      const upperQuery = queryText.toUpperCase();
      
      // User not found
      if (upperQuery.includes('SELECT') && upperQuery.includes('EMAIL') && upperQuery.includes('USERS')) {
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