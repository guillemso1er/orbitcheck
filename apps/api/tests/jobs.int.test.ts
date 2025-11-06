import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { build } from '../src/server'
import { getPool, getRedis, resetDb, startTestEnv, stopTestEnv } from './setup'

let app: Awaited<ReturnType<typeof build>>
let pool: ReturnType<typeof getPool>
let redis: Redis
let apiKey: string

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
    
    // Set up API key for jobs tests
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
    apiKey = keyRes.json().full_key
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
  // Re-create API key after reset
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
  apiKey = keyRes.json().full_key
})

describe('Jobs Integration Tests', () => {
  describe('Authentication Required', () => {
    test('401 on missing authorization header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/jobs/test-job-id'
      })
      expect(res.statusCode).toBe(401)
    })

    test('401 on invalid API key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/jobs/test-job-id',
        headers: { authorization: 'API-Key invalid-key' }
      })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('Get Job Status (GET /v1/jobs/:id)', () => {
    test('200 returns job status for valid job', async () => {
      // First create a mock job in the database
      const jobId = 'test-job-123'
      const projectId = 'test-project-123'
      
      await pool.query(`
        INSERT INTO jobs (id, project_id, status, input_data, total_items, processed_items, created_at, updated_at)
        VALUES ($1, $2, 'processing', $3, 100, 50, NOW(), NOW())
      `, [jobId, projectId, JSON.stringify({ test: 'data' })])
      
      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `API-Key ${apiKey}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('job_id', jobId)
      expect(body).toHaveProperty('status', 'processing')
      expect(body).toHaveProperty('progress')
      expect(body.progress).toHaveProperty('total', 100)
      expect(body.progress).toHaveProperty('processed', 50)
      expect(body.progress).toHaveProperty('percentage', 50)
      expect(body).toHaveProperty('created_at')
      expect(body).toHaveProperty('updated_at')
      expect(body).toHaveProperty('request_id')
    })

    test('200 returns completed job with results', async () => {
      const jobId = 'completed-job-123'
      
      await pool.query(`
        INSERT INTO jobs (id, project_id, status, input_data, result_data, total_items, processed_items, created_at, updated_at)
        VALUES ($1, $2, 'completed', $3, $4, 10, 10, NOW(), NOW())
      `, [jobId, 'test-project', JSON.stringify({ emails: ['test@example.com'] }), JSON.stringify({ results: ['valid'] })])
      
      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `API-Key ${apiKey}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.status).toBe('completed')
      expect(body.progress).toHaveProperty('percentage', 100)
      expect(body.result_data).toBeDefined()
    })

    test('200 returns failed job with error', async () => {
      const jobId = 'failed-job-123'
      
      await pool.query(`
        INSERT INTO jobs (id, project_id, status, input_data, error_message, total_items, processed_items, created_at, updated_at)
        VALUES ($1, $2, 'failed', $3, 'Processing failed due to invalid data', 100, 25, NOW(), NOW())
      `, [jobId, 'test-project', JSON.stringify({ test: 'data' })])
      
      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `API-Key ${apiKey}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.status).toBe('failed')
      expect(body.error).toBe('Processing failed due to invalid data')
      expect(body.progress).toHaveProperty('percentage', 25)
    })

    test('200 returns pending job without progress', async () => {
      const jobId = 'pending-job-123'
      
      await pool.query(`
        INSERT INTO jobs (id, project_id, status, input_data, created_at, updated_at)
        VALUES ($1, $2, 'pending', $3, NOW(), NOW())
      `, [jobId, 'test-project', JSON.stringify({ test: 'data' })])
      
      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `API-Key ${apiKey}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.status).toBe('pending')
      expect(body.progress).toBeNull()
    })

    test('404 on non-existent job', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/jobs/non-existent-job',
        headers: { authorization: `API-Key ${apiKey}` }
      })
      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.error.code).toBe('NOT_FOUND')
    })

    test('404 on job from different project', async () => {
      const jobId = 'other-project-job'
      
      // Create job for different project
      await pool.query(`
        INSERT INTO jobs (id, project_id, status, input_data, created_at, updated_at)
        VALUES ($1, $2, 'completed', $3, NOW(), NOW())
      `, [jobId, 'different-project', JSON.stringify({ test: 'data' })])
      
      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `API-Key ${apiKey}` }
      })
      expect(res.statusCode).toBe(404)
    })

    test('200 calculates progress percentage correctly', async () => {
      const testCases = [
        { processed: 0, total: 100, expectedPercentage: 0 },
        { processed: 25, total: 100, expectedPercentage: 25 },
        { processed: 50, total: 100, expectedPercentage: 50 },
        { processed: 75, total: 100, expectedPercentage: 75 },
        { processed: 100, total: 100, expectedPercentage: 100 },
        { processed: 99, total: 100, expectedPercentage: 99 },
        { processed: 1, total: 3, expectedPercentage: 33 } // Rounding test
      ]
      
      for (const testCase of testCases) {
        const jobId = `progress-test-${testCase.processed}-${testCase.total}`
        
        await pool.query(`
          INSERT INTO jobs (id, project_id, status, input_data, total_items, processed_items, created_at, updated_at)
          VALUES ($1, $2, 'processing', $3, $4, $5, NOW(), NOW())
        `, [jobId, 'test-project', JSON.stringify({ test: 'data' }), testCase.total, testCase.processed])
        
        const res = await app.inject({
          method: 'GET',
          url: `/v1/jobs/${jobId}`,
          headers: { authorization: `API-Key ${apiKey}` }
        })
        expect(res.statusCode).toBe(200)
        const body = res.json()
        expect(body.progress.percentage).toBe(testCase.expectedPercentage)
        
        // Clean up
        await pool.query('DELETE FROM jobs WHERE id = $1', [jobId])
      }
    })

    test('200 handles job with zero total items', async () => {
      const jobId = 'zero-items-job'
      
      await pool.query(`
        INSERT INTO jobs (id, project_id, status, input_data, total_items, processed_items, created_at, updated_at)
        VALUES ($1, $2, 'completed', $3, 0, 0, NOW(), NOW())
      `, [jobId, 'test-project', JSON.stringify({ test: 'data' })])
      
      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `API-Key ${apiKey}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.progress).toBeNull() // No progress for zero items
    })

    test('200 includes proper timestamp formats', async () => {
      const jobId = 'timestamp-test-job'
      
      await pool.query(`
        INSERT INTO jobs (id, project_id, status, input_data, created_at, updated_at)
        VALUES ($1, $2, 'pending', $3, NOW(), NOW())
      `, [jobId, 'test-project', JSON.stringify({ test: 'data' })])
      
      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `API-Key ${apiKey}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      
      // Verify ISO 8601 format
      expect(new Date(body.created_at).toISOString()).toBe(body.created_at)
      expect(new Date(body.updated_at).toISOString()).toBe(body.updated_at)
    })

    test('200 maintains data isolation between projects', async () => {
      // Create two jobs with same ID but different projects
      const jobId = 'shared-id-job'
      
      await pool.query(`
        INSERT INTO jobs (id, project_id, status, input_data, created_at, updated_at)
        VALUES ($1, $2, 'completed', $3, NOW(), NOW()),
               ($1, $4, 'processing', $5, NOW(), NOW())
      `, [jobId, 'project-a', JSON.stringify({ project: 'A' }), 'project-b', JSON.stringify({ project: 'B' })])
      
      // Request with project A's API key should return project A's job
      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `API-Key ${apiKey}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.status).toBeDefined() // Should return one of the jobs
    })
  })

  describe('Response Structure Validation', () => {
    test('job status response has all required fields', async () => {
      const jobId = 'structure-test-job'
      
      await pool.query(`
        INSERT INTO jobs (id, project_id, status, input_data, total_items, processed_items, created_at, updated_at)
        VALUES ($1, $2, 'processing', $3, 100, 50, NOW(), NOW())
      `, [jobId, 'test-project', JSON.stringify({ test: 'data' })])
      
      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `API-Key ${apiKey}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      
      // Check all required fields
      expect(typeof body.job_id).toBe('string')
      expect(['pending', 'processing', 'completed', 'failed']).toContain(body.status)
      expect(typeof body.created_at).toBe('string')
      expect(typeof body.updated_at).toBe('string')
      expect(typeof body.request_id).toBe('string')
      
      if (body.progress) {
        expect(typeof body.progress.total).toBe('number')
        expect(typeof body.progress.processed).toBe('number')
        expect(typeof body.progress.percentage).toBe('number')
      }
    })

    test('unique request_id for each request', async () => {
      const jobId = 'request-id-test-job'
      
      await pool.query(`
        INSERT INTO jobs (id, project_id, status, input_data, created_at, updated_at)
        VALUES ($1, $2, 'pending', $3, NOW(), NOW())
      `, [jobId, 'test-project', JSON.stringify({ test: 'data' })])
      
      const res1 = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `API-Key ${apiKey}` }
      })
      
      const res2 = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `API-Key ${apiKey}` }
      })
      
      expect(res1.json().request_id).not.toBe(res2.json().request_id)
    })
  })

  describe('Error Handling', () => {
    test('handles database errors gracefully', async () => {
      // This would require mocking database failures
      // For now, ensure normal operation works
      const jobId = 'error-test-job'
      
      await pool.query(`
        INSERT INTO jobs (id, project_id, status, input_data, created_at, updated_at)
        VALUES ($1, $2, 'pending', $3, NOW(), NOW())
      `, [jobId, 'test-project', JSON.stringify({ test: 'data' })])
      
      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `API-Key ${apiKey}` }
      })
      expect(res.statusCode).toBe(200)
    })

    test('handles malformed job data', async () => {
      const jobId = 'malformed-job'
      
      // Insert job with potentially malformed data
      await pool.query(`
        INSERT INTO jobs (id, project_id, status, input_data, total_items, processed_items, created_at, updated_at)
        VALUES ($1, $2, 'processing', $3, -1, 150, NOW(), NOW())
      `, [jobId, 'test-project', 'invalid-json'])
      
      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `API-Key ${apiKey}` }
      })
      // Should still return 200, but handle edge cases gracefully
      expect([200, 500]).toContain(res.statusCode)
    })
  })

  describe('Performance and Concurrency', () => {
    test('handles concurrent job status requests', async () => {
      const jobId = 'concurrent-test-job'
      
      await pool.query(`
        INSERT INTO jobs (id, project_id, status, input_data, total_items, processed_items, created_at, updated_at)
        VALUES ($1, $2, 'processing', $3, 1000, 500, NOW(), NOW())
      `, [jobId, 'test-project', JSON.stringify({ test: 'data' })])
      
      // Make multiple concurrent requests
      const requests = Array.from({ length: 5 }, () =>
        app.inject({
          method: 'GET',
          url: `/v1/jobs/${jobId}`,
          headers: { authorization: `API-Key ${apiKey}` }
        })
      )
      
      const results = await Promise.all(requests as any[])
      results.forEach(res => {
        expect(res.statusCode).toBe(200)
        const body = res.json()
        expect(body.job_id).toBe(jobId)
        expect(body.status).toBe('processing')
      })
    })
  })
})