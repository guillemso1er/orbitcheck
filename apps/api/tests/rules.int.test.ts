import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { build } from '../src/server'
import { getPool, getRedis, resetDb, seedTestData, startTestEnv, stopTestEnv } from './setup'

let app: Awaited<ReturnType<typeof build>>
let pool: ReturnType<typeof getPool>
let redis: Redis
let cookieJar: Record<string, string>

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

    // Seed test data for disposable domains
    await seedTestData()


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
  try {
    await resetDb()
    // Set up session cookies for rules tests
    const userRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'test@example.com',
        password: 'Password123*',
        confirm_password: 'Password123*'
      }
    })
    // Login and get fresh session cookie for each test
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'test@example.com',
        password: 'Password123*'
      }
    })

    // Extract session cookies from login response
    cookieJar = {}
    for (const c of loginRes.cookies ?? []) {
      cookieJar[c.name] = c.value
    }
  } catch (error) {
    console.error('Failed to reset test environment:', error)
    throw error
  }
})

describe('Rules Integration Tests', () => {
  describe('Basic CRUD Operations', () => {
    test('GET /v1/rules returns empty array', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules',
        cookies: cookieJar
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual([])
    })

    test('GET /v1/rules with existing rules', async () => {
      const customRule = {
        name: 'Test Rule',
        description: 'Test rule description',
        category: 'email',
        enabled: true,
        conditions: { email: { valid: true } },
        actions: { approve: true }
      }

      // Create a rule first
      await app.inject({
        method: 'POST',
        url: '/v1/rules',
        cookies: cookieJar,
        payload: customRule
      })

      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules',
        cookies: cookieJar
      })

      expect(res.statusCode).toBe(200)
      const rules = res.json()
      expect(Array.isArray(rules)).toBe(true)
      expect(rules.length).toBeGreaterThan(0)
    })

    test('POST /v1/rules creates new rule', async () => {
      const newRule = {
        name: 'New Test Rule',
        description: 'A new test rule',
        category: 'email',
        enabled: true,
        conditions: { email: { valid: false } },
        actions: { block: true }
      }

      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules',
        cookies: cookieJar,
        payload: newRule
      })

      expect(res.statusCode).toBe(201)
      const createdRule = res.json()
      expect(createdRule.name).toBe(newRule.name)
      expect(createdRule.enabled).toBe(true)
    })

    test('PUT /v1/rules/:id updates rule', async () => {
      // First create a rule
      const newRule = {
        name: 'Update Test Rule',
        description: 'Rule to be updated',
        category: 'email',
        enabled: true,
        conditions: { email: { valid: true } },
        actions: { approve: true }
      }

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/rules',
        cookies: cookieJar,
        payload: newRule
      })

      const createdRule = createRes.json()
      const ruleId = createdRule.id

      // Update the rule
      const updates = {
        name: 'Updated Test Rule',
        description: 'Updated description',
        enabled: false
      }

      const updateRes = await app.inject({
        method: 'PUT',
        url: `/v1/rules/${ruleId}`,
        cookies: cookieJar,
        payload: updates
      })

      expect(updateRes.statusCode).toBe(200)
      const updatedRule = updateRes.json()
      expect(updatedRule.name).toBe(updates.name)
      expect(updatedRule.enabled).toBe(updates.enabled)
    })

    test('DELETE /v1/rules/:id deletes rule', async () => {
      // First create a rule
      const newRule = {
        name: 'Delete Test Rule',
        description: 'Rule to be deleted',
        category: 'email',
        enabled: true,
        conditions: { email: { valid: true } },
        actions: { approve: true }
      }

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/rules',
        cookies: cookieJar,
        payload: newRule
      })

      const createdRule = createRes.json()
      const ruleId = createdRule.id

      // Delete the rule
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/v1/rules/${ruleId}`,
        cookies: cookieJar
      })

      expect(deleteRes.statusCode).toBe(204)

      // Verify it's deleted
      const getRes = await app.inject({
        method: 'GET',
        url: `/v1/rules/${ruleId}`,
        cookies: cookieJar
      })

      expect(getRes.statusCode).toBe(404)
    })
  })

  describe('Rules Catalog', () => {
    test('GET /v1/rules/catalog returns available rules', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/catalog',
        cookies: cookieJar
      })

      expect(res.statusCode).toBe(200)
      const catalog = res.json()
      expect(Array.isArray(catalog)).toBe(true)
      expect(catalog.length).toBeGreaterThan(0)
    })

    test('GET /v1/rules/catalog includes rule descriptions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/catalog',
        cookies: cookieJar
      })

      expect(res.statusCode).toBe(200)
      const catalog = res.json()

      catalog.forEach((rule: any) => {
        expect(rule).toHaveProperty('id')
        expect(rule).toHaveProperty('name')
        expect(rule).toHaveProperty('description')
        expect(rule).toHaveProperty('category')
      })
    })

    test('GET /v1/rules/catalog filtered by category', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/catalog?category=email',
        cookies: cookieJar
      })

      expect(res.statusCode).toBe(200)
      const catalog = res.json()

      catalog.forEach((rule: any) => {
        expect(rule.category).toBe('email')
      })
    })

    test('GET /v1/rules/catalog sorted by name', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/catalog?sort=name&order=asc',
        cookies: cookieJar
      })

      expect(res.statusCode).toBe(200)
      const catalog = res.json()

      // Verify it's sorted alphabetically
      const names = catalog.map((rule: any) => rule.name)
      const sortedNames = [...names].sort()
      expect(names).toEqual(sortedNames)
    })

    test('GET /v1/rules/catalog with pagination', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/catalog?page=1&limit=5',
        cookies: cookieJar
      })

      expect(res.statusCode).toBe(200)
      const catalog = res.json()

      expect(catalog).toHaveProperty('data')
      expect(catalog).toHaveProperty('pagination')
      expect(Array.isArray(catalog.data)).toBe(true)
      expect(catalog.data.length).toBeLessThanOrEqual(5)
    })

    test('GET /v1/rules/catalog with search', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/catalog?search=email',
        cookies: cookieJar
      })

      expect(res.statusCode).toBe(200)
      const catalog = res.json()

      // Filter results should contain 'email' in name or description
      catalog.data.forEach((rule: any) => {
        expect(
          rule.name.toLowerCase().includes('email') ||
          rule.description.toLowerCase().includes('email')
        ).toBe(true)
      })
    })
  })

  describe('Error Codes', () => {
    test('GET /v1/rules/error-codes returns error code definitions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/error-codes',
        cookies: cookieJar
      })

      expect(res.statusCode).toBe(200)
      const errorCodes = res.json()
      expect(Array.isArray(errorCodes)).toBe(true)
      expect(errorCodes.length).toBeGreaterThan(0)
    })

    test('GET /v1/rules/error-codes includes code descriptions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/error-codes',
        cookies: cookieJar
      })

      expect(res.statusCode).toBe(200)
      const errorCodes = res.json()

      errorCodes.forEach((code: any) => {
        expect(code).toHaveProperty('code')
        expect(code).toHaveProperty('description')
        expect(code).toHaveProperty('category')
      })
    })
  })

  describe('Rule Testing', () => {
    test('POST /v1/rules/test validates payload against rules', async () => {
      const testPayload = {
        email: 'test@example.com',
        phone: '+1234567890',
        address: {
          line1: '123 Main St',
          city: 'Anytown',
          state: 'NY',
          postal_code: '10001',
          country: 'US'
        }
      }

      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        cookies: cookieJar,
        payload: {
          payload: testPayload
        }
      })

      expect(res.statusCode).toBe(200)
      const result = res.json()
      expect(result).toHaveProperty('final_decision')
      expect(result).toHaveProperty('rule_evaluations')
    })

    test('POST /v1/rules/test returns valid decision for email payload', async () => {
      const testPayload = {
        email: 'user@gmail.com'
      }

      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        cookies: cookieJar,
        payload: {
          payload: testPayload
        }
      })

      expect(res.statusCode).toBe(200)
      const result = res.json()
      expect(result.final_decision).toHaveProperty('action')
      expect(['approve', 'block', 'hold']).toContain(result.final_decision.action)
    })

    test('POST /v1/rules/test returns detailed rule evaluations', async () => {
      const testPayload = {
        email: 'user@unknown-domain.com',
        phone: '+1234567890'
      }

      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        cookies: cookieJar,
        payload: {
          payload: testPayload
        }
      })

      expect(res.statusCode).toBe(200)
      const result = res.json()
      expect(Array.isArray(result.rule_evaluations)).toBe(true)

      result.rule_evaluations.forEach((evaluation: any) => {
        expect(evaluation).toHaveProperty('rule_id')
        expect(evaluation).toHaveProperty('triggered')
        expect(evaluation).toHaveProperty('action')
      })
    })

    test('POST /v1/rules/test handles empty payload gracefully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        cookies: cookieJar,
        payload: { payload: {} }
      })

      expect(res.statusCode).toBe(200)
      const result = res.json()
      expect(result).toHaveProperty('final_decision')
      expect(result.final_decision.action).toBeDefined()
    })

    test('POST /v1/rules/test validates multiple data types', async () => {
      const testPayload = {
        email: 'test@example.com',
        phone: '+1234567890',
        address: {
          line1: '123 Main St',
          city: 'New York',
          state: 'NY',
          postal_code: '10001',
          country: 'US'
        },
        transaction_amount: 99.99,
        currency: 'USD'
      }

      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        cookies: cookieJar,
        payload: {
          payload: testPayload
        }
      })

      expect(res.statusCode).toBe(200)
      const result = res.json()
      expect(result).toHaveProperty('final_decision')
      expect(result.final_decision).toHaveProperty('confidence')
      expect(result.final_decision).toHaveProperty('risk_level')
    })

    test('POST /v1/rules/test includes performance metrics', async () => {
      const testPayload = {
        email: 'user@example.com'
      }

      const startTime = Date.now()
      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        cookies: cookieJar,
        payload: {
          payload: testPayload
        }
      })
      const endTime = Date.now()

      expect(res.statusCode).toBe(200)
      const result = res.json()

      // Should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(5000)
    })

    describe('Rule Registration', () => {
      test('POST /v1/rules/register registers custom rules', async () => {
        const customRules = [
          {
            id: 'test_custom_rule',
            name: 'Test Custom Rule',
            description: 'A custom rule for testing',
            category: 'email',
            enabled: true,
            conditions: { email: { domain: 'test.com' } },
            actions: { block: true }
          }
        ]

        const res = await app.inject({
          method: 'POST',
          url: '/v1/rules/register',
          cookies: cookieJar,
          payload: { rules: customRules }
        })

        expect(res.statusCode).toBe(201)
        const result = res.json()
        expect(result.message).toContain('successfully registered')
      })

      test('POST /v1/rules/register validates rule structure', async () => {
        const invalidRules = [
          {
            // Missing required fields
            name: 'Invalid Rule'
          }
        ]

        const res = await app.inject({
          method: 'POST',
          url: '/v1/rules/register',
          cookies: cookieJar,
          payload: { rules: invalidRules }
        })

        expect(res.statusCode).toBe(400)
      })

      test('POST /v1/rules/register prevents duplicate rule IDs', async () => {
        const duplicateRules = [
          {
            id: 'duplicate_rule',
            name: 'Duplicate Rule 1',
            description: 'First duplicate',
            category: 'email',
            enabled: true,
            conditions: { email: { valid: true } },
            actions: { approve: true }
          },
          {
            id: 'duplicate_rule', // Same ID
            name: 'Duplicate Rule 2',
            description: 'Second duplicate',
            category: 'email',
            enabled: true,
            conditions: { email: { valid: true } },
            actions: { approve: true }
          }
        ]

        const res = await app.inject({
          method: 'POST',
          url: '/v1/rules/register',
          cookies: cookieJar,
          payload: { rules: duplicateRules }
        })

        expect(res.statusCode).toBe(400)
      })

      test('POST /v1/rules/register handles empty rules array', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/rules/register',
          cookies: cookieJar,
          payload: { rules: [] }
        })

        expect(res.statusCode).toBe(400)
      })

      test('POST /v1/rules/register validates rule conditions', async () => {
        const malformedRules = [
          {
            id: 'malformed_rule',
            name: 'Malformed Rule',
            description: 'Rule with malformed conditions',
            category: 'email',
            enabled: true,
            conditions: { invalid_condition: 'test' },
            actions: { approve: true }
          }
        ]

        const res = await app.inject({
          method: 'POST',
          url: '/v1/rules/register',
          cookies: cookieJar,
          payload: { rules: malformedRules }
        })

        expect(res.statusCode).toBe(201) // Should accept but log warning
      })

      test('POST /v1/rules/register prevents duplicate rule names', async () => {
        const duplicateNameRules = [
          {
            id: 'rule_1',
            name: 'Duplicate Name Rule',
            description: 'First rule with this name',
            category: 'email',
            enabled: true,
            conditions: { email: { valid: true } },
            actions: { approve: true }
          }
        ]

        // Register first rule
        await app.inject({
          method: 'POST',
          url: '/v1/rules/register',
          cookies: cookieJar,
          payload: { rules: duplicateNameRules }
        })

        // Try to register another rule with the same name
        const secondRule = [...duplicateNameRules]
        secondRule[0].id = 'rule_2'

        const res = await app.inject({
          method: 'POST',
          url: '/v1/rules/register',
          cookies: cookieJar,
          payload: { rules: secondRule }
        })

        expect(res.statusCode).toBe(400)
      })

      test('POST /v1/rules/register allows rule updates with same name', async () => {
        const firstRule = [
          {
            id: 'updateable_rule',
            name: 'Updateable Rule',
            description: 'First version',
            category: 'email',
            enabled: true,
            conditions: { email: { valid: true } },
            actions: { approve: true }
          }
        ]

        // Register first rule
        const firstRes = await app.inject({
          method: 'POST',
          url: '/v1/rules/register',
          cookies: cookieJar,
          payload: { rules: firstRule }
        })

        expect(firstRes.statusCode).toBe(201)

        // Update rule with same name but different ID
        const updatedRule = [
          {
            id: 'updated_rule',
            name: 'Updateable Rule', // Same name
            description: 'Updated version',
            category: 'email',
            enabled: false,
            conditions: { email: { valid: false } },
            actions: { block: true }
          }
        ]

        const updateRes = await app.inject({
          method: 'POST',
          url: '/v1/rules/register',
          cookies: cookieJar,
          payload: { rules: updatedRule }
        })

        expect(updateRes.statusCode).toBe(201)
      })

      test('POST /v1/rules/test uses registered rules', async () => {
        const payload = { email: 'test@test.com' }

        // Test without custom rule
        const beforeRes = await app.inject({
          method: 'POST',
          url: '/v1/rules/test',
          cookies: cookieJar,
          payload: { payload }
        })

        const beforeResult = beforeRes.json()

        // Register custom rule
        const customRules = [
          {
            id: 'test_domain_rule',
            name: 'Test Domain Rule',
            description: 'Blocks test.com domain',
            category: 'email',
            enabled: true,
            conditions: { email: { domain: 'test.com' } },
            actions: { block: true }
          }
        ]

        await app.inject({
          method: 'POST',
          url: '/v1/rules/register',
          cookies: cookieJar,
          payload: { rules: customRules }
        })

        // Test with custom rule
        const afterRes = await app.inject({
          method: 'POST',
          url: '/v1/rules/test',
          cookies: cookieJar,
          payload: { payload }
        })

        const afterResult = afterRes.json()

        // Should have different result due to custom rule
        expect(afterResult.final_decision.action).toBe('block')
      })
    })

    describe('Multiple Concurrent Tests', () => {
      test('handles multiple simultaneous rule test requests', async () => {
        const testPayloads = Array.from({ length: 10 }, (_, i) => ({
          email: `test${i}@example.com`
        }))

        const promises = testPayloads.map(payload =>
          app.inject({
            method: 'POST',
            url: '/v1/rules/test',
            cookies: cookieJar,
            payload: { payload }
          })
        )

        const results = await Promise.all(promises)

        results.forEach((res, index) => {
          expect(res.statusCode).toBe(200)
          const result = res.json()
          expect(result.final_decision).toBeDefined()
          expect(result.final_decision.action).toMatch(/approve|block|hold/)
        })
      })

      test('handles rapid consecutive requests', async () => {
        const testPayload = { email: 'rapidtest@example.com' }

        const startTime = Date.now()
        for (let i = 0; i < 50; i++) {
          const res = await app.inject({
            method: 'POST',
            url: '/v1/rules/test',
            cookies: cookieJar,
            payload: { payload: testPayload }
          })
          expect(res.statusCode).toBe(200)
        }
        const endTime = Date.now()

        // Should handle 50 requests within reasonable time
        expect(endTime - startTime).toBeLessThan(30000)
      })
    })

    describe('Edge Cases and Performance', () => {
      test('handles malformed JSON payload', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/rules/test',
          cookies: cookieJar,
          payload: 'invalid json'
        })

        expect(res.statusCode).toBe(400)
      })

      test('handles extremely large payload', async () => {
        const largePayload: any = { email: 'test@example.com' }

        // Create a very large nested object
        for (let i = 0; i < 1000; i++) {
          largePayload[`field${i}`] = 'x'.repeat(100)
        }

        const res = await app.inject({
          method: 'POST',
          url: '/v1/rules/test',
          cookies: cookieJar,
          payload: { payload: largePayload }
        })

        // Should either handle it gracefully or return 413
        expect([200, 413]).toContain(res.statusCode)
      })

      test('handles invalid email formats gracefully', async () => {
        const invalidEmails = ['invalid-email', '@domain.com', 'user@', 'user..double..dot@domain.com']

        for (const email of invalidEmails) {
          const res = await app.inject({
            method: 'POST',
            url: '/v1/rules/test',
            cookies: cookieJar,
            payload: { payload: { email } }
          })

          expect(res.statusCode).toBe(200)
          const result = res.json()
          expect(result.final_decision).toBeDefined()
        }
      })

      test('handles invalid phone formats gracefully', async () => {
        const invalidPhones = ['123', '+123', '1234567890123456', 'abc123def']

        for (const phone of invalidPhones) {
          const res = await app.inject({
            method: 'POST',
            url: '/v1/rules/test',
            cookies: cookieJar,
            payload: { payload: { phone } }
          })

          expect(res.statusCode).toBe(200)
          const result = res.json()
          expect(result.final_decision).toBeDefined()
        }
      })

      test('handles invalid address formats gracefully', async () => {
        const invalidAddresses = [
          { address: { line1: '', city: '', country: '' } },
          { address: { line1: null, city: 'New York', country: 'US' } },
          { address: { line1: '123 Main St', city: null, country: 'US' } }
        ]

        for (const testCase of invalidAddresses) {
          const res = await app.inject({
            method: 'POST',
            url: '/v1/rules/test',
            cookies: cookieJar,
            payload: { payload: testCase }
          })

          expect(res.statusCode).toBe(200)
          const result = res.json()
          expect(result.final_decision).toBeDefined()
        }
      })

      test('handles special characters in payload', async () => {
        const specialCharPayload = {
          email: 'test+tag@domain.com',
          phone: '+1 (555) 123-4567',
          address: {
            line1: '123 Main St. #Apt 2-B',
            city: 'São Paulo',
            state: 'SP',
            postal_code: '01234-567',
            country: 'BR'
          }
        }

        const res = await app.inject({
          method: 'POST',
          url: '/v1/rules/test',
          cookies: cookieJar,
          payload: { payload: specialCharPayload }
        })

        expect(res.statusCode).toBe(200)
        const result = res.json()
        expect(result.final_decision).toBeDefined()
      })

      test('maintains consistent performance under load', async () => {
        const iterations = 20
        const responseTimes: number[] = []

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now()

          const res = await app.inject({
            method: 'POST',
            url: '/v1/rules/test',
            cookies: cookieJar,
            payload: {
              payload: {
                email: `user${i}@example.com`,
                phone: `+123456789${i}`,
                address: {
                  line1: `${i} Main Street`,
                  city: 'Anytown',
                  postal_code: '12345',
                  country: 'US'
                }
              }
            }
          })

          const endTime = Date.now()
          responseTimes.push(endTime - startTime)

          expect(res.statusCode).toBe(200)
        }

        // Calculate statistics
        const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        const maxResponseTime = Math.max(...responseTimes)
        const minResponseTime = Math.min(...responseTimes)

        // Performance should be reasonable and consistent
        expect(avgResponseTime).toBeLessThan(2000) // Average under 2 seconds
        expect(maxResponseTime).toBeLessThan(5000) // No request over 5 seconds
        expect(maxResponseTime / minResponseTime).toBeLessThan(10) // Not too much variance
      })
    })
  })
})