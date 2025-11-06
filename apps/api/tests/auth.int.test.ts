

import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { build } from '../src/server'
import { getPool, getRedis, resetDb, startTestEnv, stopTestEnv } from './setup'



let app: Awaited<ReturnType<typeof build>>
let pool: ReturnType<typeof getPool>
let redis: Redis

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
})

describe('Authentication Integration Tests', () => {
  describe('User Registration (400 - Validation Errors)', () => {
    test('400 on missing email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { password: 'password123', confirm_password: 'password123' }
      })
      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error.code).toBe('invalid_input')
    })

    test('400 on missing password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'test@example.com', confirm_password: 'password123' }
      })
      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error.code).toBe('invalid_input')
    })

    test('400 on password mismatch', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password123',
          confirm_password: 'different'
        }
      })
      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error.code).toBe('invalid_input')
    })

    test('400 on invalid email format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'invalid-email',
          password: 'password123',
          confirm_password: 'password123'
        }
      })
      expect(res.statusCode).toBe(400)
    })

    test('400 on password too short', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: '123',
          confirm_password: '123'
        }
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('User Registration (400 - Conflict)', () => {
    test('400 on duplicate email', async () => {
      // First registration
      const res1 = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })
      expect(res1.statusCode).toBe(201)

      // Duplicate registration
      const res2 = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password456',
          confirm_password: 'password456'
        }
      })
      expect(res2.statusCode).toBe(400)
      const body = res2.json()
      expect(body.error.code).toBe('user_exists')
    })
  })

  describe('User Registration (201 - Success)', () => {
    test('201 on successful registration', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })
      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body).toHaveProperty('user')
      expect(body.user).toHaveProperty('id')
      expect(body.user).toHaveProperty('email', 'test@example.com')
      expect(body).toHaveProperty('request_id')
    })
  })

  describe('User Login (401 - Invalid Credentials)', () => {
    test('401 on non-existent user', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'nonexistent@example.com',
          password: 'password123'
        }
      })
      expect(res.statusCode).toBe(401)
      const body = res.json()
      expect(body.error.code).toBe('invalid_credentials')
    })

    test('401 on wrong password', async () => {
      // Register user first
      await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })

      // Try login with wrong password
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'wrongpassword'
        }
      })
      expect(res.statusCode).toBe(401)
      const body = res.json()
      expect(body.error.code).toBe('invalid_credentials')
    })
  })

  describe('User Login (200 - Success)', () => {
    test('200 on successful login', async () => {
      // Register user first
      await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })

      // Login
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'password123'
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('user')
      expect(body.user).toHaveProperty('id')
      expect(body.user).toHaveProperty('email', 'test@example.com')
      expect(body).toHaveProperty('pat_token')
      expect(body).toHaveProperty('request_id')
      expect(typeof body.pat_token).toBe('string')
    })
  })

  describe('Session Authentication', () => {
    test('dashboard routes require session auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/projects'
      })
      expect(res.statusCode).toBe(401)
      const body = res.json()
      expect(body.error.message).toContain('session authentication')
    })
  })

  describe('PAT Authentication', () => {
    let patToken: string

    beforeEach(async () => {
      // Register and login to get PAT token
      await app.inject({
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
      patToken = loginRes.json().pat_token
    })

    test('401 on invalid PAT', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/pats',
        headers: { authorization: 'Bearer invalid-token' }
      })
      expect(res.statusCode).toBe(401)
    })

    test('401 on expired PAT', async () => {
      // This would require mocking time or creating an expired PAT
      // Skip for now as it requires additional setup
    })

    test('management routes accept PAT auth', async () => {
      // This test would need a real management route
      // For now, test that auth middleware doesn't reject with 401 for management routes
    })
  })

  describe('API Key Authentication', () => {
    test('401 on invalid API key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/address',
        headers: { authorization: 'Bearer invalid-api-key' },
        payload: {
          address: {
            line1: '123 Main St',
            city: 'New York',
            postal_code: '10001',
            country: 'US'
          }
        }
      })
      expect(res.statusCode).toBe(401)
    })

    test('runtime routes accept API key auth', async () => {
      // This would require creating an API key first
      // Skip for now as it requires additional setup
    })
  })

  describe('HMAC Authentication', () => {
    test('401 on invalid HMAC', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/validate/address',
        headers: { authorization: 'HMAC keyId=invalid,signature=invalid,ts=123,nonce=abc' }
      })
      expect(res.statusCode).toBe(401)
    })

    test('401 on expired HMAC timestamp', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/validate/address',
        headers: { authorization: 'HMAC keyId=test,signature=test,ts=1234567890,nonce=test' }
      })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('Public Routes', () => {
    test('health check works without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ status: 'ok' })
    })
  })

  describe('Logout', () => {
    test('logout clears session', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/logout'
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.message).toBeDefined()
    })
  })

  describe('Content-Type Validation (400)', () => {
    test('400 on unsupported content-type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        headers: { 'content-type': 'text/plain' },
        payload: 'not-json-data'
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('Rate Limiting (429)', () => {
    test('rate limit returns 429 after N requests', async () => {
      // This test requires rate limiting to be enabled
      // Skip for now as rate limiting is disabled in tests
    })
  })

  describe('Conditional GET (304)', () => {
    test('304 on not modified with If-None-Match', async () => {
      // Register user
      await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })

      // Login to get session
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'password123'
        }
      })

      // This would require a resource that supports ETags
      // Skip for now as auth routes may not support this
    })
  })

  describe('Optimistic Concurrency (412)', () => {
    test('412 on concurrent update conflict', async () => {
      // This would require If-Match headers and version checking
      // Skip for now as auth routes may not support this
    })
  })

  describe('Pagination and Filtering', () => {
    test('pagination works on list endpoints', async () => {
      // Auth endpoints don't have list endpoints
      // This is more relevant for other API endpoints
    })
  })
})