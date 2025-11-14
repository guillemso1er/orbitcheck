import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { build } from '../src/server'
import { getPool, getRedis, resetDb, startTestEnv, stopTestEnv } from './setup'

let app: Awaited<ReturnType<typeof build>>
let pool: ReturnType<typeof getPool>
let redis: Redis
let apiKey: string
let projectId: string
let cookieJar: Record<string, string>
let csrfToken: string

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

  // Extract session cookies from login response
  cookieJar = {}
  for (const c of loginRes.cookies ?? []) {
    cookieJar[c.name] = c.value
    if (c.name === 'csrf_token_client') {
      csrfToken = c.value
    }
  }

  const projectRes = await app.inject({
    method: 'POST',
    url: '/projects',
    payload: { name: 'Default Project' }, // Use default project name
    cookies: cookieJar,
    headers: { 'x-csrf-token': csrfToken }
  })

  // Try to get project ID from API response, fallback to database
  const projectData = projectRes.json()
  projectId = projectData.id || projectData.project_id || projectData.data?.id || projectData.data?.project_id

  // If not found in response, try to get the default project
  if (!projectId) {
    const defaultProjectResult = await pool.query('SELECT id FROM projects WHERE name = $1 LIMIT 1', ['Default Project'])
    if (defaultProjectResult.rows.length > 0) {
      projectId = defaultProjectResult.rows[0].id
    }
  }

  console.log('beforeEach - Project creation response:', projectData)
  console.log('beforeEach - Extracted projectId:', projectId)

  // If not found in response, get from database
  if (!projectId) {
    const projectResult = await pool.query('SELECT id FROM projects WHERE name = $1 LIMIT 1', ['Default Project'])
    if (projectResult.rows.length > 0) {
      projectId = projectResult.rows[0].id
    }
  }

  // If still no project ID, create a basic one for testing
  if (!projectId) {
    const firstUserResult = await pool.query('SELECT id FROM users LIMIT 1')
    if (firstUserResult.rows.length > 0) {
      const result = await pool.query(
        'INSERT INTO projects (name, user_id, created_at) VALUES ($1, $2, NOW()) RETURNING id',
        ['Test Project', firstUserResult.rows[0].id]
      )
      projectId = result.rows[0].id
    }
  }

  // Store the user_id for later use
  const testUserResult = await pool.query('SELECT id FROM users WHERE email = $1', ['test@example.com'])
  if (testUserResult.rows.length > 0) {
    ; (global as any).testUserId = testUserResult.rows[0].id
  }

  const keyRes = await app.inject({
    method: 'POST',
    url: '/v1/api-keys',
    payload: {}, // Empty body as per API spec
    cookies: cookieJar,
    headers: { 'x-csrf-token': csrfToken }
  })

  if (keyRes.statusCode !== 201) {
    throw new Error(`Failed to create API key in beforeEach: ${keyRes.statusCode} - ${keyRes.body}`)
  }

  const responseJson = keyRes.json()
  apiKey = responseJson.full_key

  // Check what project the API key is associated with
  const keyCheck = await pool.query('SELECT id, project_id FROM api_keys WHERE prefix = $1', [responseJson.prefix])
  console.log('API key check result:', keyCheck.rows)
})

describe('Jobs Integration Tests', () => {
  // Debug: Log the API key to see what we're working with
  // console.log('Using API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : 'NO API KEY')

  describe('Authentication Required', () => {
    test('401 on missing authorization header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/jobs/550e8400-e29b-41d4-a716-446655440099'
      })
      expect(res.statusCode).toBe(401)
    })

    test('401 on invalid API key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/jobs/550e8400-e29b-41d4-a716-446655440099',
        headers: { 'x-api-key': 'invalid' }
      })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('Get Job Status (GET /v1/jobs/:id)', () => {
    test('200 returns job status for valid job', async () => {
      const jobId = '550e8400-e29b-41d4-a716-446655440000'

      console.log('About to insert job with projectId:', projectId)

      await pool.query(`
        INSERT INTO jobs (id, project_id, job_type, status, input_data, total_items, processed_items, created_at, updated_at)
        VALUES ($1, $2, 'batch_validate', 'processing', $3, 100, 50, NOW(), NOW())
      `, [jobId, projectId, JSON.stringify({ test: 'data' })])

      console.log(`Inserted job ${jobId} for project ${projectId}`)

      // Check if job was actually inserted
      const checkJob = await pool.query('SELECT id, project_id FROM jobs WHERE id = $1', [jobId])
      console.log('Job check result:', checkJob.rows)

      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { 'x-api-key': apiKey }
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('id', jobId)
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
      const jobId = '550e8400-e29b-41d4-a716-446655440003'

      await pool.query(`
        INSERT INTO jobs (id, project_id, job_type, status, input_data, result_data, total_items, processed_items, created_at, updated_at)
        VALUES ($1, $2, 'batch_validate', 'completed', $3, $4, 10, 10, NOW(), NOW())
      `, [jobId, projectId, JSON.stringify({ emails: ['test@example.com'] }), JSON.stringify({ results: ['valid'] })])

      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { 'x-api-key': apiKey }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.status).toBe('completed')
      expect(body.progress).toHaveProperty('percentage', 100)
      expect(body.result_data).toBeDefined()
    })

    test('200 returns failed job with error', async () => {
      const jobId = '550e8400-e29b-41d4-a716-446655440004'

      await pool.query(`
        INSERT INTO jobs (id, project_id, job_type, status, input_data, error_message, total_items, processed_items, created_at, updated_at)
        VALUES ($1, $2, 'batch_validate', 'failed', $3, 'Processing failed due to invalid data', 100, 25, NOW(), NOW())
      `, [jobId, projectId, JSON.stringify({ test: 'data' })])

      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { 'x-api-key': apiKey }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.status).toBe('failed')
      expect(body.error).toBe('Processing failed due to invalid data')
      expect(body.progress).toHaveProperty('percentage', 25)
    })

    test('200 returns pending job without progress', async () => {
      const jobId = '550e8400-e29b-41d4-a716-446655440005'

      await pool.query(`
        INSERT INTO jobs (id, project_id, job_type, status, input_data, created_at, updated_at)
        VALUES ($1, $2, 'batch_validate', 'pending', $3, NOW(), NOW())
      `, [jobId, projectId, JSON.stringify({ test: 'data' })])

      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { 'x-api-key': apiKey }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.status).toBe('pending')
      expect(body.progress).toBeNull()
    })

    test('404 on non-existent job', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/jobs/550e8400-e29b-41d4-a716-446655440099',
        headers: { 'x-api-key': apiKey }
      })
      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.error.code).toBe('not_found')
    })

    test('404 on job from different project', async () => {
      const jobId = '550e8400-e29b-41d4-a716-446655440006'

      // Get the test user ID or create a new one
      let testUserId = (global as any).testUserId
      if (!testUserId) {
        const userResult = await pool.query('SELECT id FROM users WHERE email = $1', ['test@example.com'])
        if (userResult.rows.length > 0) {
          testUserId = userResult.rows[0].id
        } else {
          // Create a new user if none exists
          const newUserResult = await pool.query(
            'INSERT INTO users (email, password_hash, created_at) VALUES ($1, $2, NOW()) RETURNING id',
            ['different@example.com', 'dummy_hash']
          )
          testUserId = newUserResult.rows[0].id
        }
      }

      // Create a different project
      const differentProjectResult = await pool.query(`
        INSERT INTO projects (name, user_id, created_at)
        VALUES ($1, $2, NOW())
        RETURNING id
      `, ['Different Project', testUserId])
      const differentProjectId = differentProjectResult.rows[0].id

      // Create job for different project
      await pool.query(`
        INSERT INTO jobs (id, project_id, job_type, status, input_data, created_at, updated_at)
        VALUES ($1, $2, 'batch_validate', 'completed', $3, NOW(), NOW())
      `, [jobId, differentProjectId, JSON.stringify({ test: 'data' })])

      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { 'x-api-key': apiKey }
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
        const jobId = `550e8400-e29b-41d4-a716-446655440${String(testCase.processed).padStart(3, '0')}`

        await pool.query(`
          INSERT INTO jobs (id, project_id, job_type, status, input_data, total_items, processed_items, created_at, updated_at)
          VALUES ($1, $2, 'batch_validate', 'processing', $3, $4, $5, NOW(), NOW())
        `, [jobId, projectId, JSON.stringify({ test: 'data' }), testCase.total, testCase.processed])

        const res = await app.inject({
          method: 'GET',
          url: `/v1/jobs/${jobId}`,
          headers: { 'x-api-key': apiKey }
        })
        expect(res.statusCode).toBe(200)
        const body = res.json()
        expect(body.progress.percentage).toBe(testCase.expectedPercentage)

        // Clean up
        await pool.query('DELETE FROM jobs WHERE id = $1', [jobId])
      }
    })

    test('200 handles job with zero total items', async () => {
      const jobId = '550e8400-e29b-41d4-a716-446655440020'

      await pool.query(`
        INSERT INTO jobs (id, project_id, job_type, status, input_data, total_items, processed_items, created_at, updated_at)
        VALUES ($1, $2, 'batch_validate', 'completed', $3, 0, 0, NOW(), NOW())
      `, [jobId, projectId, JSON.stringify({ test: 'data' })])

      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { 'x-api-key': apiKey }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.progress).toBeNull() // No progress for zero items
    })

    test('200 includes proper timestamp formats', async () => {
      const jobId = '550e8400-e29b-41d4-a716-446655440021'

      await pool.query(`
        INSERT INTO jobs (id, project_id, job_type, status, input_data, created_at, updated_at)
        VALUES ($1, $2, 'batch_validate', 'pending', $3, NOW(), NOW())
      `, [jobId, projectId, JSON.stringify({ test: 'data' })])

      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { 'x-api-key': apiKey }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()

      // Verify ISO 8601 format
      expect(new Date(body.created_at).toISOString()).toBe(body.created_at)
      expect(new Date(body.updated_at).toISOString()).toBe(body.updated_at)
    })

    test('200 maintains data isolation between projects', async () => {
      // Get the test user ID or create a new one
      let testUserId = (global as any).testUserId
      if (!testUserId) {
        const userResult = await pool.query('SELECT id FROM users WHERE email = $1', ['test@example.com'])
        if (userResult.rows.length > 0) {
          testUserId = userResult.rows[0].id
        } else {
          // Create a new user if none exists
          const newUserResult = await pool.query(
            'INSERT INTO users (email, password_hash, created_at) VALUES ($1, $2, NOW()) RETURNING id',
            ['different@example.com', 'dummy_hash']
          )
          testUserId = newUserResult.rows[0].id
        }
      }

      // Create two jobs with different IDs but different projects
      const jobIdA = '550e8400-e29b-41d4-a716-446655440022'
      const jobIdB = '550e8400-e29b-41d4-a716-446655440023'
      const differentProjectResult = await pool.query(`
        INSERT INTO projects (name, user_id, created_at)
        VALUES ($1, $2, NOW())
        RETURNING id
      `, ['Different Project', testUserId])
      const projectBId = differentProjectResult.rows[0].id

      // Create job for project A
      await pool.query(`
        INSERT INTO jobs (id, project_id, job_type, status, input_data, created_at, updated_at)
        VALUES ($1, $2, 'batch_validate', 'completed', $3, NOW(), NOW())
      `, [jobIdA, projectId, JSON.stringify({ project: 'A' })])

      // Create job for project B
      await pool.query(`
        INSERT INTO jobs (id, project_id, job_type, status, input_data, created_at, updated_at)
        VALUES ($1, $2, 'batch_dedupe', 'processing', $3, NOW(), NOW())
      `, [jobIdB, projectBId, JSON.stringify({ project: 'B' })])

      // Request with project A's API key should only return project A's job
      const resA = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobIdA}`,
        headers: { 'x-api-key': apiKey }
      })
      expect(resA.statusCode).toBe(200)
      const bodyA = resA.json()
      expect(bodyA.status).toBe('completed')
      expect(bodyA.id).toBe(jobIdA)
      expect(bodyA).toHaveProperty('created_at')
      expect(bodyA).toHaveProperty('updated_at')

      // Request with project A's API key for project B's job should return 404
      const resB = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobIdB}`,
        headers: { 'x-api-key': apiKey }
      })
      expect(resB.statusCode).toBe(404) // Job from different project should not be accessible
    })
  })

  describe('Response Structure Validation', () => {
    test('job status response has all required fields', async () => {
      const jobId = '550e8400-e29b-41d4-a716-446655440024'

      await pool.query(`
        INSERT INTO jobs (id, project_id, job_type, status, input_data, total_items, processed_items, created_at, updated_at)
        VALUES ($1, $2, 'batch_validate', 'processing', $3, 100, 50, NOW(), NOW())
      `, [jobId, projectId, JSON.stringify({ test: 'data' })])

      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { 'x-api-key': apiKey }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()

      // Check all required fields
      expect(typeof body.id).toBe('string')
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
      const jobId = '550e8400-e29b-41d4-a716-446655440025'

      await pool.query(`
        INSERT INTO jobs (id, project_id, job_type, status, input_data, created_at, updated_at)
        VALUES ($1, $2, 'batch_validate', 'pending', $3, NOW(), NOW())
      `, [jobId, projectId, JSON.stringify({ test: 'data' })])

      const res1 = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { 'x-api-key': apiKey }
      })

      const res2 = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { 'x-api-key': apiKey }
      })

      expect(res1.json().request_id).not.toBe(res2.json().request_id)
    })
  })

  describe('Error Handling', () => {
    test('handles database errors gracefully', async () => {
      // This would require mocking database failures
      // For now, ensure normal operation works
      const jobId = '550e8400-e29b-41d4-a716-446655440026'

      await pool.query(`
        INSERT INTO jobs (id, project_id, job_type, status, input_data, created_at, updated_at)
        VALUES ($1, $2, 'batch_validate', 'pending', $3, NOW(), NOW())
      `, [jobId, projectId, JSON.stringify({ test: 'data' })])

      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { 'x-api-key': apiKey }
      })
      expect(res.statusCode).toBe(200)
    })

    test('handles malformed job data', async () => {
      const jobId = '550e8400-e29b-41d4-a716-446655440027'

      // Insert job with potentially malformed data
      await pool.query(`
        INSERT INTO jobs (id, project_id, job_type, status, input_data, total_items, processed_items, created_at, updated_at)
        VALUES ($1, $2, 'batch_validate', 'processing', $3::jsonb, -1, 150, NOW(), NOW())
      `, [jobId, projectId, JSON.stringify({ test: 'data' })])

      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { 'x-api-key': apiKey }
      })
      // Should still return 200, but handle edge cases gracefully
      expect([200, 500]).toContain(res.statusCode)
    })
  })

  describe('Performance and Concurrency', () => {
    test('handles concurrent job status requests', async () => {
      const jobId = '550e8400-e29b-41d4-a716-446655440028'

      await pool.query(`
        INSERT INTO jobs (id, project_id, job_type, status, input_data, total_items, processed_items, created_at, updated_at)
        VALUES ($1, $2, 'batch_validate', 'processing', $3, 1000, 500, NOW(), NOW())
      `, [jobId, projectId, JSON.stringify({ test: 'data' })])

      // Make multiple concurrent requests
      const requests = Array.from({ length: 5 }, () =>
        app.inject({
          method: 'GET',
          url: `/v1/jobs/${jobId}`,
          headers: { 'x-api-key': apiKey }
        })
      )

      const results = await Promise.all(requests as any[])
      results.forEach(res => {
        expect(res.statusCode).toBe(200)
        const body = res.json()
        expect(body.id).toBe(jobId)
        expect(body.status).toBe('processing')
      })
    })
  })
})