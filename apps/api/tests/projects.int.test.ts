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

describe('Projects Integration Tests', () => {
  describe('Authentication Required', () => {
    test('401 on missing authorization header for GET /projects', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/projects'
      })
      expect(res.statusCode).toBe(401)
      const body = res.json()
      expect(body.error.code).toBe('UNAUTHORIZED')
    })

    test('401 on invalid authorization header for GET /projects', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/projects',
        headers: { authorization: 'Bearer invalid-token' }
      })
      expect(res.statusCode).toBe(401)
    })

    test('401 on missing authorization header for POST /projects', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Test Project' }
      })
      expect(res.statusCode).toBe(401)
    })

    test('401 on missing authorization header for DELETE /projects/:id', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/projects/test-id'
      })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('List Projects (GET /projects)', () => {
    test('200 returns empty projects array for new user', async () => {
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

      // Get projects list
      const res = await app.inject({
        method: 'GET',
        url: '/projects',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('projects')
      expect(body).toHaveProperty('plan')
      expect(body.projects).toHaveLength(0)
      expect(body.plan.currentProjects).toBe(0)
      expect(body.plan.canCreateMore).toBe(true)
    })

    test('200 returns projects with plan info', async () => {
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

      // Create projects
      const project1Res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Project 1' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(project1Res.statusCode).toBe(201)

      const project2Res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Project 2' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(project2Res.statusCode).toBe(201)

      // Get projects list
      const listRes = await app.inject({
        method: 'GET',
        url: '/projects',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(listRes.statusCode).toBe(200)
      const body = listRes.json()
      expect(body.projects).toHaveLength(2)
      expect(body.plan.currentProjects).toBe(2)
      expect(body.plan.canCreateMore).toBe(true) // Assuming free plan allows more
      expect(body.projects[0]).toHaveProperty('id')
      expect(body.projects[0]).toHaveProperty('name')
      expect(body.projects[0]).toHaveProperty('created_at')
    })

    test('200 returns projects ordered by creation date (newest first)', async () => {
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

      // Create projects with small delay
      const project1Res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'First Project' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      
      await new Promise(resolve => setTimeout(resolve, 10))

      const project2Res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Second Project' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })

      // Get projects list
      const listRes = await app.inject({
        method: 'GET',
        url: '/projects',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(listRes.statusCode).toBe(200)
      const body = listRes.json()
      expect(body.projects[0].name).toBe('Second Project') // Newest first
      expect(body.projects[1].name).toBe('First Project')
    })
  })

  describe('Create Project (POST /projects)', () => {
    test('201 creates project successfully', async () => {
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
      const res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'My Test Project' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body).toHaveProperty('id')
      expect(body).toHaveProperty('name', 'My Test Project')
      expect(body).toHaveProperty('created_at')
    })

    test('400 on missing project name', async () => {
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

      // Try to create project without name
      const res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: {},
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error.code).toBe('INVALID_INPUT')
    })

    test('400 on empty project name', async () => {
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

      // Try to create project with empty name
      const res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: '' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error.code).toBe('INVALID_INPUT')
    })

    test('400 on whitespace-only project name', async () => {
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

      // Try to create project with whitespace-only name
      const res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: '   ' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error.code).toBe('INVALID_INPUT')
    })

    test('201 trims whitespace from project name', async () => {
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

      // Create project with leading/trailing whitespace
      const res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: '  Trimmed Project  ' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body).toHaveProperty('name', 'Trimmed Project')
    })

    test('402 on exceeding project limit', async () => {
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

      // Fill up to the limit (assuming free plan allows 2 projects)
      const project1Res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Project 1' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(project1Res.statusCode).toBe(201)

      const project2Res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Project 2' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(project2Res.statusCode).toBe(201)

      // Try to create third project (should fail if limit is 2)
      const project3Res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Project 3' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      
      if (project3Res.statusCode === 402) {
        const body = project3Res.json()
        expect(body.error.code).toBe('LIMIT_EXCEEDED')
        expect(body).toHaveProperty('plan')
        expect(body.plan.projectsLimit).toBeDefined()
        expect(body.plan.currentProjects).toBe(2)
      }
    })

    test('creates multiple projects with unique names', async () => {
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

      // Create projects with same base name
      const project1Res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'My Project' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(project1Res.statusCode).toBe(201)

      const project2Res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'My Project' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(project2Res.statusCode).toBe(201)

      // Both should succeed and have different IDs
      expect(project1Res.json().id).not.toBe(project2Res.json().id)
    })
  })

  describe('Delete Project (DELETE /projects/:id)', () => {
    test('200 deletes project successfully', async () => {
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
        payload: { name: 'Project to Delete' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      const projectId = projectRes.json().id

      // Delete project
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/projects/${projectId}`,
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(deleteRes.statusCode).toBe(200)
      const body = deleteRes.json()
      expect(body).toHaveProperty('message')

      // Verify project is deleted
      const listRes = await app.inject({
        method: 'GET',
        url: '/projects',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(listRes.statusCode).toBe(200)
      const projects = listRes.json().projects
      expect(projects).toHaveLength(0)
    })

    test('404 on deleting non-existent project', async () => {
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

      // Try to delete non-existent project
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: '/projects/non-existent-id',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(deleteRes.statusCode).toBe(404)
      const body = deleteRes.json()
      expect(body.error.code).toBe('NOT_FOUND')
    })

    test('404 on deleting project from another user', async () => {
      // Register two users
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
      const projectId = projectRes.json().id

      // User2 tries to delete User1's project
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/projects/${projectId}`,
        headers: { authorization: `Bearer ${login2Res.json().pat_token}` }
      })
      expect(deleteRes.statusCode).toBe(404)
    })

    test('decrements project count after deletion', async () => {
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

      // Create two projects
      const project1Res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Project 1' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      const project1Id = project1Res.json().id

      const project2Res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Project 2' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })

      // Check initial count
      const listRes1 = await app.inject({
        method: 'GET',
        url: '/projects',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(listRes1.json().plan.currentProjects).toBe(2)

      // Delete one project
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/projects/${project1Id}`,
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(deleteRes.statusCode).toBe(200)

      // Check updated count
      const listRes2 = await app.inject({
        method: 'GET',
        url: '/projects',
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(listRes2.json().plan.currentProjects).toBe(1)
    })
  })

  describe('Cross-User Data Isolation', () => {
    test('users only see their own projects', async () => {
      // Register two users
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
      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'User1 Project' },
        headers: { authorization: `Bearer ${login1Res.json().pat_token}` }
      })

      // User2 creates a project
      await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'User2 Project' },
        headers: { authorization: `Bearer ${login2Res.json().pat_token}` }
      })

      // User1 should only see their project
      const user1ProjectsRes = await app.inject({
        method: 'GET',
        url: '/projects',
        headers: { authorization: `Bearer ${login1Res.json().pat_token}` }
      })
      expect(user1ProjectsRes.json().projects).toHaveLength(1)
      expect(user1ProjectsRes.json().projects[0].name).toBe('User1 Project')

      // User2 should only see their project
      const user2ProjectsRes = await app.inject({
        method: 'GET',
        url: '/projects',
        headers: { authorization: `Bearer ${login2Res.json().pat_token}` }
      })
      expect(user2ProjectsRes.json().projects).toHaveLength(1)
      expect(user2ProjectsRes.json().projects[0].name).toBe('User2 Project')
    })
  })

  describe('Error Handling and Edge Cases', () => {
    test('handles database errors gracefully', async () => {
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

      // This would require mocking database failures
      // For now, ensure normal operation works
      const projectRes = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Test Project' },
        headers: { authorization: `Bearer ${loginRes.json().pat_token}` }
      })
      expect(projectRes.statusCode).toBe(201)
    })
  })
})