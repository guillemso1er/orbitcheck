import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { build } from '../src/server'
import { getPool, getRedis, resetDb, startTestEnv, stopTestEnv } from './setup'

let app: Awaited<ReturnType<typeof build>>
let pool: ReturnType<typeof getPool>
let redis: Redis
let patToken: string

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
    
    // Set up PAT token for rules tests
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
    patToken = loginRes.json().pat_token
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
  // Re-create user and get PAT token after reset
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
  patToken = loginRes.json().pat_token
})

describe('Rules Integration Tests', () => {
  describe('Authentication Required', () => {
    test('401 on missing authorization header for rules list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules'
      })
      expect(res.statusCode).toBe(401)
    })

    test('401 on invalid PAT token for rules list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules',
        headers: { authorization: 'Bearer invalid-token' }
      })
      expect(res.statusCode).toBe(401)
    })

    test('401 on missing authorization for reason codes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/reason-codes'
      })
      expect(res.statusCode).toBe(401)
    })

    test('401 on missing authorization for test rules', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        payload: { email: 'test@example.com' }
      })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('List Available Rules (GET /v1/rules)', () => {
    test('200 returns list of available rules', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules',
        headers: { authorization: `Bearer ${patToken}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('rules')
      expect(Array.isArray(body.rules)).toBe(true)
      expect(body).toHaveProperty('request_id')
      
      // Verify rule structure
      if (body.rules.length > 0) {
        const rule = body.rules[0]
        expect(rule).toHaveProperty('id')
        expect(rule).toHaveProperty('name')
        expect(rule).toHaveProperty('description')
        expect(rule).toHaveProperty('category')
        expect(rule).toHaveProperty('enabled')
      }
    })

    test('200 returns rules with proper categorization', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules',
        headers: { authorization: `Bearer ${patToken}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      
      // Check for expected rule categories
      const categories = body.rules.map((rule: any) => rule.category)
      expect(categories).toContain('email')
      expect(categories).toContain('phone')
      expect(categories).toContain('address')
      expect(categories).toContain('order')
    })

    test('200 includes all built-in validation rules', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules',
        headers: { authorization: `Bearer ${patToken}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      const ruleIds = body.rules.map((rule: any) => rule.id)
      
      // Check for specific expected rule IDs
      expect(ruleIds).toContain('email_format')
      expect(ruleIds).toContain('email_mx')
      expect(ruleIds).toContain('email_disposable')
      expect(ruleIds).toContain('phone_format')
      expect(ruleIds).toContain('phone_otp')
      expect(ruleIds).toContain('address_validation')
      expect(ruleIds).toContain('po_box_detection')
    })

    test('200 returns enabled and disabled rules', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules',
        headers: { authorization: `Bearer ${patToken}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      
      // Should have both enabled and disabled rules
      const enabledRules = body.rules.filter((rule: any) => rule.enabled)
      const disabledRules = body.rules.filter((rule: any) => !rule.enabled)
      
      expect(enabledRules.length).toBeGreaterThan(0)
      expect(Array.isArray(disabledRules)).toBe(true)
    })
  })

  describe('Reason Code Catalog (GET /v1/rules/reason-codes)', () => {
    test('200 returns reason code catalog', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/reason-codes',
        headers: { authorization: `Bearer ${patToken}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('reason_codes')
      expect(Array.isArray(body.reason_codes)).toBe(true)
      expect(body).toHaveProperty('request_id')
    })

    test('200 includes email-related reason codes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/reason-codes',
        headers: { authorization: `Bearer ${patToken}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      const emailCodes = body.reason_codes.filter((code: any) => 
        code.code.includes('EMAIL') || code.category === 'email'
      )
      expect(emailCodes.length).toBeGreaterThan(0)
    })

    test('200 includes phone-related reason codes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/reason-codes',
        headers: { authorization: `Bearer ${patToken}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      const phoneCodes = body.reason_codes.filter((code: any) => 
        code.code.includes('PHONE') || code.category === 'phone'
      )
      expect(phoneCodes.length).toBeGreaterThan(0)
    })

    test('200 includes address-related reason codes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/reason-codes',
        headers: { authorization: `Bearer ${patToken}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      const addressCodes = body.reason_codes.filter((code: any) => 
        code.code.includes('ADDRESS') || code.category === 'address'
      )
      expect(addressCodes.length).toBeGreaterThan(0)
    })

    test('200 reason codes have proper structure', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/reason-codes',
        headers: { authorization: `Bearer ${patToken}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      
      if (body.reason_codes.length > 0) {
        const code = body.reason_codes[0]
        expect(code).toHaveProperty('code')
        expect(code).toHaveProperty('description')
        expect(code).toHaveProperty('category')
        expect(code).toHaveProperty('severity')
        expect(['low', 'medium', 'high']).toContain(code.severity)
      }
    })
  })

  describe('Error Code Catalog (GET /v1/rules/error-codes)', () => {
    test('200 returns error code catalog', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/error-codes',
        headers: { authorization: `Bearer ${patToken}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('error_codes')
      expect(Array.isArray(body.error_codes)).toBe(true)
      expect(body).toHaveProperty('request_id')
    })

    test('200 error codes have proper structure', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/rules/error-codes',
        headers: { authorization: `Bearer ${patToken}` }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      
      if (body.error_codes.length > 0) {
        const code = body.error_codes[0]
        expect(code).toHaveProperty('code')
        expect(code).toHaveProperty('description')
        expect(code).toHaveProperty('category')
        expect(code).toHaveProperty('severity')
      }
    })
  })

  describe('Test Rules Against Payload (POST /v1/rules/test)', () => {
    test('200 tests email validation against rules', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        headers: { authorization: `Bearer ${patToken}` },
        payload: {
          email: 'test@example.com',
          phone: '+1234567890'
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('results')
      expect(body).toHaveProperty('rule_evaluations')
      expect(body).toHaveProperty('request_id')
    })

    test('200 tests phone validation against rules', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        headers: { authorization: `Bearer ${patToken}` },
        payload: {
          phone: '+1234567890',
          name: 'John Doe'
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('results')
      expect(body.results).toHaveProperty('phone')
    })

    test('200 tests address validation against rules', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        headers: { authorization: `Bearer ${patToken}` },
        payload: {
          address: {
            line1: '123 Main St',
            city: 'New York',
            postal_code: '10001',
            country: 'US'
          }
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('results')
      expect(body.results).toHaveProperty('address')
    })

    test('200 tests with all validation fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        headers: { authorization: `Bearer ${patToken}` },
        payload: {
          email: 'user@gmail.com',
          phone: '+1234567890',
          address: {
            line1: '123 Main St',
            city: 'New York',
            postal_code: '10001',
            country: 'US'
          },
          name: 'John Doe',
          ip: '192.168.1.1',
          user_agent: 'Mozilla/5.0',
          transaction_amount: 99.99,
          currency: 'USD'
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('results')
      expect(body.results).toHaveProperty('email')
      expect(body.results).toHaveProperty('phone')
      expect(body.results).toHaveProperty('address')
      expect(body.results).toHaveProperty('name')
    })

    test('200 rule evaluations include trigger status', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        headers: { authorization: `Bearer ${patToken}` },
        payload: {
          email: 'invalid-email-format'
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('rule_evaluations')
      expect(Array.isArray(body.rule_evaluations)).toBe(true)
      
      // Check rule evaluation structure
      if (body.rule_evaluations.length > 0) {
        const evaluation = body.rule_evaluations[0]
        expect(evaluation).toHaveProperty('rule_id')
        expect(evaluation).toHaveProperty('rule_name')
        expect(evaluation).toHaveProperty('triggered')
        expect(evaluation).toHaveProperty('action')
        expect(evaluation).toHaveProperty('priority')
        expect(evaluation).toHaveProperty('evaluation_time_ms')
        expect(['approve', 'hold', 'block']).toContain(evaluation.action)
      }
    })

    test('200 handles empty payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        headers: { authorization: `Bearer ${patToken}` },
        payload: {}
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('results')
      expect(body).toHaveProperty('rule_evaluations')
    })

    test('200 includes risk scoring', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        headers: { authorization: `Bearer ${patToken}` },
        payload: {
          email: 'user@tempmail.com',
          ip: '192.168.1.1'
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('results')
      
      // Each validation field should have risk scoring
      if (body.results.email) {
        expect(body.results.email).toHaveProperty('risk_score')
        expect(typeof body.results.email.risk_score).toBe('number')
      }
    })

    test('200 includes performance metrics', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        headers: { authorization: `Bearer ${patToken}` },
        payload: {
          email: 'test@example.com'
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('results')
      expect(body.results).toHaveProperty('email')
      expect(body.results.email).toHaveProperty('processing_time_ms')
      expect(typeof body.results.email.processing_time_ms).toBe('number')
    })

    test('400 on invalid payload structure', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        headers: { authorization: `Bearer ${patToken}` },
        payload: 'invalid-json'
      })
      expect(res.statusCode).toBe(400)
    })

    test('400 on invalid email format in payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        headers: { authorization: `Bearer ${patToken}` },
        payload: {
          email: 123 // Should be string
        }
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('Register Custom Rules (POST /v1/rules/register)', () => {
    test('201 registers custom rules', async () => {
      const customRules = [
        {
          id: 'custom_email_block',
          name: 'Custom Email Block',
          description: 'Block specific email domains',
          category: 'email',
          enabled: true,
          conditions: {
            email: {
              domain: { in: ['baddomain.com', 'spam.com'] }
            }
          },
          actions: {
            block: true,
            reason_code: 'CUSTOM_EMAIL_BLOCK'
          }
        }
      ]

      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/register',
        headers: { authorization: `Bearer ${patToken}` },
        payload: { rules: customRules }
      })
      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body).toHaveProperty('message')
      expect(body).toHaveProperty('request_id')
    })

    test('400 on invalid rule structure', async () => {
      const invalidRules = [
        {
          // Missing required fields
          name: 'Invalid Rule'
        }
      ]

      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/register',
        headers: { authorization: `Bearer ${patToken}` },
        payload: { rules: invalidRules }
      })
      expect(res.statusCode).toBe(400)
    })

    test('400 on duplicate rule IDs', async () => {
      const duplicateRules = [
        {
          id: 'existing_rule',
          name: 'Rule 1',
          description: 'Test rule 1',
          category: 'email',
          enabled: true
        },
        {
          id: 'existing_rule', // Same ID
          name: 'Rule 2',
          description: 'Test rule 2',
          category: 'email',
          enabled: true
        }
      ]

      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/register',
        headers: { authorization: `Bearer ${patToken}` },
        payload: { rules: duplicateRules }
      })
      expect(res.statusCode).toBe(400)
    })

    test('400 on empty rules array', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/register',
        headers: { authorization: `Bearer ${patToken}` },
        payload: { rules: [] }
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('Business Logic Validation', () => {
    test('rules test returns consistent results for same input', async () => {
      const payload = { email: 'test@example.com' }
      
      const res1 = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        headers: { authorization: `Bearer ${patToken}` },
        payload
      })
      
      const res2 = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        headers: { authorization: `Bearer ${patToken}` },
        payload
      })
      
      expect(res1.statusCode).toBe(200)
      expect(res2.statusCode).toBe(200)
      
      // Results should be consistent (note: might differ due to time-based checks)
      expect(res1.json().results.email.valid).toBe(res2.json().results.email.valid)
    })

    test('rule evaluations include proper confidence scores', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/rules/test',
        headers: { authorization: `Bearer ${patToken}` },
        payload: {
          email: 'test@example.com',
          phone: '+1234567890'
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      
      // Each rule evaluation should have confidence scoring
      body.rule_evaluations.forEach((evaluation: any) => {
        if (evaluation.triggered) {
          expect(evaluation).toHaveProperty('confidence_score')
          expect(typeof evaluation.confidence_score).toBe('number')
          expect(evaluation.confidence_score).toBeGreaterThanOrEqual(0)
          expect(evaluation.confidence_score).toBeLessThanOrEqual(1)
        }
      })
    })

    test('handles high validation volume efficiently', async () => {
      const startTime = Date.now()
      
      for (let i = 0; i < 10; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/rules/test',
          headers: { authorization: `Bearer ${patToken}` },
          payload: { email: `test${i}@example.com` }
        })
        expect(res.statusCode).toBe(200)
      }
      
      const endTime = Date.now()
      
      // Should complete within reasonable time (adjust threshold as needed)
      expect(endTime - startTime).toBeLessThan(30000) // 30 seconds
    })
  })

  describe('Cross-User Data Isolation', () => {
    test('users cannot access other users custom rules', async () => {
      // Create two users
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
      
      // User1 registers custom rules
      const customRules = [
        {
          id: 'user1_custom_rule',
          name: 'User1 Custom Rule',
          description: 'Custom rule for user1',
          category: 'email',
          enabled: true
        }
      ]
      
      const registerRes = await app.inject({
        method: 'POST',
        url: '/v1/rules/register',
        headers: { authorization: `Bearer ${login1Res.json().pat_token}` },
        payload: { rules: customRules }
      })
      expect(registerRes.statusCode).toBe(201)
      
      // User2 should not see User1's custom rules in the list
      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/rules',
        headers: { authorization: `Bearer ${login2Res.json().pat_token}` }
      })
      expect(listRes.statusCode).toBe(200)
      const body = listRes.json()
      const user1Rules = body.rules.filter((rule: any) => rule.id === 'user1_custom_rule')
      expect(user1Rules).toHaveLength(0)
    })
  })
})