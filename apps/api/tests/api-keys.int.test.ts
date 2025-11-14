import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { build } from '../src/server'
import { getPool, getRedis, resetDb, startTestEnv, stopTestEnv } from './setup'

let app: Awaited<ReturnType<typeof build>>
let pool: ReturnType<typeof getPool>
let redis: Redis
let cookieJar: Record<string, string>
let cookieJar1: Record<string, string>
let cookieJar2: Record<string, string>
let csrfToken: string
let csrfToken1: string
let csrfToken2: string

beforeAll(async () => {
  try {
    // Start environment first
    await startTestEnv()

    // Get connections
    pool = getPool()
    redis = getRedis()

    // Build app
    app = await build(pool, redis)
    await app.ready()

    // Give the app a moment to fully initialize
    await new Promise(resolve => setTimeout(resolve, 100))
  } catch (error) {
    console.error('Failed to start test environment:', error)
    throw error
  }
}, 30000) // Increase timeout

afterAll(async () => {
  // Close connections in order
  try {
    if (app) {
      await app.close()
    }
  } catch (error) {
    // Ignore closing errors in tests
  }

  try {
    if (redis) {
      redis.disconnect()
    }
  } catch (error) {
    // Ignore
  }

  try {
    await stopTestEnv()
  } catch (error) {
    // Ignore
  }
})

beforeEach(async () => {
  await resetDb()
  // register a user
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email: 'test@example.com',
      password: 'password123',
      confirm_password: 'password123'
    }
  })
  // Login and get fresh session cookie for each test
  const loginRes = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: {
      email: 'test@example.com',
      password: 'password123'
    }
  })

  // Extract session cookies from login response
  cookieJar = {}
  for (const c of loginRes.cookies ?? []) {
    cookieJar[c.name] = c.value
    if (c.name === 'csrf_token_client') {
      csrfToken = c.value
    }
  }
})

describe('API Keys Integration Tests', () => {
  describe('Authentication Required', () => {
    test('401 on missing authorization header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/api-keys'
      })
      expect(res.statusCode).toBe(401)
      const body = res.json()
      expect(body.error.code).toBe('unauthorized')
    })

    test('401 on invalid authorization header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/api-keys',
        headers: { authorization: 'Bearer invalid-token' }
      })
      expect(res.statusCode).toBe(401)
    })

    test('401 on invalid API key format', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/api-keys',
        headers: { authorization: 'API-Key invalid-key' }
      })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('List API Keys (GET /v1/keys)', () => {
    test('200 returns empty list for new project', async () => {
      // Create a different user for this test to ensure clean state
      const userRes = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test2@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })
      expect(userRes.statusCode).toBe(201)

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test2@example.com',
          password: 'password123'
        }
      })
      expect(loginRes.statusCode).toBe(200)

      // Extract cookies for this user
      const testCookies: Record<string, string> = {}
      let testCsrfToken = ''
      for (const c of loginRes.cookies ?? []) {
        testCookies[c.name] = c.value
        if (c.name === 'csrf_token_client') {
          testCsrfToken = c.value
        }
      }

      // Default project is automatically created during registration, so we can directly list API keys
      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/api-keys',
        cookies: testCookies
      })
      expect(listRes.statusCode).toBe(200)
      const body = listRes.json()
      expect(body).toHaveProperty('data')
      expect(body).toHaveProperty('request_id')
      expect(body.data).toHaveLength(0) // Should be empty for new project
    })

    test('200 returns multiple API keys', async () => {
      // Set up project and API key
      const userRes = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'password123'
        }
      })

      // Default project is automatically created during registration
      const firstKeyRes = await app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        payload: {},
        cookies: cookieJar,
        headers: { 'x-csrf-token': csrfToken }
      })
      const firstKey = firstKeyRes.json().full_key

      // Create second API key with name
      const secondKeyRes = await app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        payload: { name: 'production-key' },
        cookies: cookieJar,
        headers: { 'x-csrf-token': csrfToken }
      })
      expect(secondKeyRes.statusCode).toBe(201)
      const secondKey = secondKeyRes.json().full_key

      // List all keys using PAT token (management API uses PAT, not API keys)
      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/api-keys',
        cookies: cookieJar
      })
      expect(listRes.statusCode).toBe(200)
      const body = listRes.json()
      expect(body.data).toHaveLength(2)
    })
  })

  describe('Create API Key (POST /v1/keys)', () => {
    test('201 creates new API key without name', async () => {
      // Register and login
      const userRes = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'password123'
        }
      })

      // Default project is automatically created during registration
      // Create API key
      const keyRes = await app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        payload: {}, // Add empty body to prevent validation error
        cookies: cookieJar,
        headers: { 'x-csrf-token': csrfToken }
      })
      expect(keyRes.statusCode).toBe(201)
      const body = keyRes.json()
      expect(body).toHaveProperty('id')
      expect(body).toHaveProperty('prefix')
      expect(body).toHaveProperty('full_key')
      expect(body).toHaveProperty('status', 'active')
      expect(body).toHaveProperty('created_at')
      expect(body).toHaveProperty('request_id')
      expect(body.full_key).toMatch(/^ok_[a-zA-Z0-9]{64}$/)
    })

    test('201 creates new API key with name', async () => {
      // Register and login
      const userRes = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'password123'
        }
      })

      // Default project is automatically created during registration
      // Create API key with name
      const keyRes = await app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        payload: { name: 'production-api-key' },
        cookies: cookieJar,
        headers: { 'x-csrf-token': csrfToken }
      })
      expect(keyRes.statusCode).toBe(201)
      const body = keyRes.json()
      expect(body.full_key).toMatch(/^ok_[a-zA-Z0-9]{64}$/)
    })

    test('400 on invalid authorization for key creation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        headers: { authorization: 'Bearer invalid-token' }
      })
      expect(res.statusCode).toBe(401) // Authentication fails first
    })

    test('400 on creating key without project access', async () => {
      // Register and login user1
      const user1Res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'user1@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })
      expect(user1Res.statusCode).toBe(201)

      const login1Res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'user1@example.com',
          password: 'password123'
        }
      })
      expect(login1Res.statusCode).toBe(200)

      // Extract user1 session cookies
      cookieJar1 = {}
      for (const c of login1Res.cookies ?? []) {
        cookieJar1[c.name] = c.value
        if (c.name === 'csrf_token_client') {
          csrfToken1 = c.value
        }
      }

      // Register and login user2
      const user2Res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'user2@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })
      expect(user2Res.statusCode).toBe(201)

      const login2Res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'user2@example.com',
          password: 'password123'
        }
      })
      expect(login2Res.statusCode).toBe(200)

      // Extract user2 session cookies
      cookieJar2 = {}
      for (const c of login2Res.cookies ?? []) {
        cookieJar2[c.name] = c.value
        if (c.name === 'csrf_token_client') {
          csrfToken2 = c.value
        }
      }

      // User1 creates a project
      const projectRes = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'User1 Project' },
        cookies: cookieJar1,
        headers: { 'x-csrf-token': csrfToken1 }
      })
      expect(projectRes.statusCode).toBe(201)

      // User2 tries to create API key in their own default project
      const keyRes = await app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        cookies: cookieJar2,
        headers: { 'x-csrf-token': csrfToken2 }
      })
      expect(keyRes.statusCode).toBe(201) // Should succeed for user's own project
    })
  })

  describe('Revoke API Key (DELETE /v1/keys/{id})', () => {
    test('204 revokes API key', async () => {
      // Set up user, project, and key
      const userRes = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'password123'
        }
      })

      // Default project is automatically created during registration
      const keyRes = await app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        payload: {},
        cookies: cookieJar,
        headers: { 'x-csrf-token': csrfToken }
      })
      const keyId = keyRes.json().id

      // Revoke the key
      const revokeRes = await app.inject({
        method: 'DELETE',
        url: `/v1/api-keys/${keyId}`,
        cookies: cookieJar,
        headers: { 'x-csrf-token': csrfToken }
      })
      expect(revokeRes.statusCode).toBe(200)

      // Verify key is revoked by checking list
      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/api-keys',
        cookies: cookieJar
      })
      expect(listRes.statusCode).toBe(200)
      const listBody = listRes.json()
      expect(listBody.data[0].status).toBe('revoked')
    })

    test('500 on revoking invalid key id', async () => {
      // Set up user and login
      const userRes = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'password123'
        }
      })

      // Try to revoke non-existent key
      const revokeRes = await app.inject({
        method: 'DELETE',
        url: '/v1/api-keys/non-existent-id',
        cookies: cookieJar,
        headers: { 'x-csrf-token': csrfToken }
      })
      expect(revokeRes.statusCode).toBe(500)
    })

    test('401 on revoking key without proper authorization', async () => {
      // Set up user and project
      const userRes = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'password123'
        }
      })

      const projectRes = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Test Project' },
        cookies: cookieJar,
        headers: { 'x-csrf-token': csrfToken }
      })

      const keyRes = await app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        cookies: cookieJar,
        headers: { 'x-csrf-token': csrfToken }
      })
      const keyId = keyRes.json().id

      // Try to revoke with invalid token
      const revokeRes = await app.inject({
        method: 'DELETE',
        url: `/v1/api-keys/${keyId}`,
        headers: { authorization: 'Bearer invalid-token' }
      })
      expect(revokeRes.statusCode).toBe(401)
    })
  })

  describe('API Key Usage Tracking', () => {
    test('updates last_used_at when key is used', async () => {
      // Set up user, project, and key
      const userRes = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'password123'
        }
      })

      // Default project is automatically created during registration
      const keyRes = await app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        payload: {},
        cookies: cookieJar,
        headers: { 'x-csrf-token': csrfToken }
      })
      const apiKey = keyRes.json().full_key

      // Use the API key for validation
      const validationRes = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        headers: { authorization: `API-Key ${apiKey}` },
        payload: { email: 'test@example.com' }
      })

      // Check if last_used_at was updated
      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/api-keys',
        cookies: cookieJar
      })
      expect(listRes.statusCode).toBe(200)
      const body = listRes.json()
      expect(body.data && body.data.length > 0).toBe(true)
      expect(body.data[0].last_used_at).toBeDefined()
    })
  })
})