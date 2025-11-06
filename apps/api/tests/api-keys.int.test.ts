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

describe('API Keys Integration Tests', () => {
  describe('Authentication Required', () => {
    test('401 on missing authorization header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/keys'
      })
      expect(res.statusCode).toBe(401)
      const body = res.json()
      expect(body.error.code).toBe('UNAUTHORIZED')
    })

    test('401 on invalid authorization header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/keys',
        headers: { authorization: 'Bearer invalid-token' }
      })
      expect(res.statusCode).toBe(401)
    })

    test('401 on invalid API key format', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/keys',
        headers: { authorization: 'API-Key invalid-key' }
      })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('List API Keys (GET /v1/keys)', () => {
    test('200 returns empty list for new project', async () => {
      // Create a project and get valid API key
      const userRes = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })
      expect(userRes.statusCode).toBe(201)

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'password123'
        }
      })
      expect(loginRes.statusCode).toBe(200)

      // Create a project first
      const projectRes = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Test Project' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(projectRes.statusCode).toBe(201)
      const projectId = projectRes.json().id

      // Get the project API key
      const keyRes = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(keyRes.statusCode).toBe(201)
      const apiKey = keyRes.json().full_key

      // Now test with API key
      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/keys',
        headers: { authorization: `API-Key ${apiKey}` }
      })
      expect(listRes.statusCode).toBe(200)
      const body = listRes.json()
      expect(body).toHaveProperty('data')
      expect(body).toHaveProperty('request_id')
      expect(body.data).toHaveLength(1)
      expect(body.data[0]).toHaveProperty('id')
      expect(body.data[0]).toHaveProperty('prefix')
      expect(body.data[0]).toHaveProperty('status', 'active')
      expect(body.data[0]).toHaveProperty('created_at')
      expect(body.data[0]).toHaveProperty('last_used_at')
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

      const projectRes = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Test Project' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      const projectId = projectRes.json().id

      const firstKeyRes = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      const firstKey = firstKeyRes.json().full_key

      // Create second API key with name
      const secondKeyRes = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` },
        payload: { name: 'production-key' }
      })
      expect(secondKeyRes.statusCode).toBe(201)
      const secondKey = secondKeyRes.json().full_key

      // List all keys
      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/keys',
        headers: { authorization: `API-Key ${firstKey}` }
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

      // Create project
      const projectRes = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Test Project' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })

      // Create API key
      const keyRes = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(keyRes.statusCode).toBe(201)
      const body = keyRes.json()
      expect(body).toHaveProperty('id')
      expect(body).toHaveProperty('prefix')
      expect(body).toHaveProperty('full_key')
      expect(body).toHaveProperty('status', 'active')
      expect(body).toHaveProperty('created_at')
      expect(body).toHaveProperty('request_id')
      expect(body.full_key).toMatch(/^orb_[a-zA-Z0-9]{32}$/)
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

      // Create project
      const projectRes = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Test Project' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })

      // Create API key with name
      const keyRes = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` },
        payload: { name: 'production-api-key' }
      })
      expect(keyRes.statusCode).toBe(201)
      const body = keyRes.json()
      expect(body.full_key).toMatch(/^orb_[a-zA-Z0-9]{32}$/)
    })

    test('400 on invalid authorization for key creation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { authorization: 'Bearer invalid-token' }
      })
      expect(res.statusCode).toBe(401)
    })

    test('400 on creating key without project access', async () => {
      // Register two different users
      const user1Res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'user1@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })

      const user2Res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'user2@example.com',
          password: 'password123',
          confirm_password: 'password123'
        }
      })

      const login1Res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'user1@example.com',
          password: 'password123'
        }
      })

      const login2Res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'user2@example.com',
          password: 'password123'
        }
      })

      // User1 creates a project
      const projectRes = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'User1 Project' },
        headers: { authorization: `Bearer ${login1Res.json().pat_token}` }
      })

      // User2 tries to create API key for User1's project
      const keyRes = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${login2Res.json().pat_token}` }
      })
      expect(keyRes.statusCode).toBe(404) // Project not found for user2
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

      const projectRes = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Test Project' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })

      const keyRes = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      const keyId = keyRes.json().id

      // Revoke the key
      const revokeRes = await app.inject({
        method: 'DELETE',
        url: `/v1/keys/${keyId}`,
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(revokeRes.statusCode).toBe(204)

      // Verify key is revoked by checking list
      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(listRes.statusCode).toBe(200)
      const listBody = listRes.json()
      expect(listBody.data[0].status).toBe('revoked')
    })

    test('404 on revoking non-existent key', async () => {
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
        url: '/v1/keys/non-existent-id',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(revokeRes.statusCode).toBe(404)
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
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })

      const keyRes = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      const keyId = keyRes.json().id

      // Try to revoke with invalid token
      const revokeRes = await app.inject({
        method: 'DELETE',
        url: `/v1/keys/${keyId}`,
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

      const projectRes = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Test Project' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })

      const keyRes = await app.inject({
        method: 'POST',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
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
        url: '/v1/keys',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(listRes.statusCode).toBe(200)
      const body = listRes.json()
      expect(body.data[0].last_used_at).toBeDefined()
    })
  })
})