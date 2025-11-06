import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { build } from '../src/server';
import { getPool, getRedis, resetDb, startTestEnv, stopTestEnv } from './setup';

let app: Awaited<ReturnType<typeof build>>;
let pool: ReturnType<typeof getPool>;
let redis: Redis;
let authToken: string; // A real, valid PAT to authenticate test requests
let patForPatAuth: string; // A second PAT for testing PAT-to-PAT auth

beforeAll(async () => {
  try {
    await startTestEnv();
    pool = getPool();
    redis = getRedis();
    app = await build(pool, redis);
    await app.ready();
  } catch (error) {
    console.error('Failed to start test environment:', error);
    throw error;
  }
}, 30000);

afterAll(async () => {
  try {
    await app?.close();
    redis?.disconnect();
    await stopTestEnv();
  } catch (error) {
    // Ignore cleanup errors
  }
});

beforeEach(async () => {
  await resetDb();

  // 1. Register a user
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email: 'test@example.com',
      password: 'password123',
      confirm_password: 'password123'
    }
  });

  // 2. Log in to get a session cookie
  const loginRes = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: {
      email: 'test@example.com',
      password: 'password123'
    }
  });

  // Build a cookie jar from whatever the server set (secure-session uses "orbitcheck_session")
  const cookieJar: Record<string, string> = {};
  for (const c of loginRes.cookies ?? []) {
    cookieJar[c.name] = c.value;
  }
  // Optional: sanity check
  // console.log('login cookies:', loginRes.cookies);

  // 3. Use the session to create a valid PAT. This tests session-based auth.
  const createPatRes = await app.inject({
    method: 'POST',
    url: '/v1/pats',
    payload: { name: 'Auth Token For Tests' },
    cookies: cookieJar
  });

  expect(createPatRes.statusCode).toBe(201);
  authToken = createPatRes.json().token;

  // 4. Use the new PAT to create a second one for PAT-to-PAT auth
  const createSecondPatRes = await app.inject({
    method: 'POST',
    url: '/v1/pats',
    headers: { authorization: `Bearer ${authToken}` },
    payload: { name: 'PAT for PAT-to-PAT Auth' }
  });
  expect(createSecondPatRes.statusCode).toBe(201);
  patForPatAuth = createSecondPatRes.json().token;
});

describe('PATs Integration Tests', () => {
  describe('Create Personal Access Token (POST /v1/pats)', () => {
    test('201 creates PAT with minimal required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/pats',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { name: 'Minimal PAT' }
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('token');
      expect(body).toHaveProperty('name', 'Minimal PAT');
    });
  });

  describe('List Personal Access Tokens (GET /v1/pats)', () => {
    test('200 returns list of user PATs', async () => {
      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/pats',
        headers: { authorization: `Bearer ${authToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      const body = listRes.json();
      // Login creates a default PAT; beforeEach creates one via session; then we create a second via PAT.
      // So we expect at least those two named PATs to exist.
      expect(Array.isArray(body.pats)).toBe(true);
      expect(body.pats.length).toBeGreaterThanOrEqual(2);
      const names = body.pats.map((p: any) => p.name);
      expect(names).toEqual(
        expect.arrayContaining(['Auth Token For Tests', 'PAT for PAT-to-PAT Auth'])
      );
    });
  });

  describe('Revoke Personal Access Token (DELETE /v1/pats/:token_id)', () => {
    test('204 revokes PAT successfully', async () => {
      const tokenIdToRevoke = patForPatAuth.split('_')[3]; // Extract ID from the token

      const revokeRes = await app.inject({
        method: 'DELETE',
        url: `/v1/pats/${tokenIdToRevoke}`,
        headers: { authorization: `Bearer ${authToken}` },
      });
      expect(revokeRes.statusCode).toBe(204);
    });
  });

  describe('PAT Security and Token Management', () => {
    test('PAT token can be used for authentication', async () => {
      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/pats',
        headers: { authorization: `Bearer ${patForPatAuth}` }
      });
      expect(listRes.statusCode).toBe(200);
    });

    test('revoked PAT is rejected', async () => {
      const tokenIdToRevoke = patForPatAuth.split('_')[3];

      // Revoke the PAT
      await app.inject({
        method: 'DELETE',
        url: `/v1/pats/${tokenIdToRevoke}`,
        headers: { authorization: `Bearer ${authToken}` },
      });

      // Try to use the now-revoked PAT
      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/pats',
        headers: { authorization: `Bearer ${patForPatAuth}` }
      });
      expect(listRes.statusCode).toBe(401);
    });
  });
});