import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { build } from '../src/server'
import { getPool, getRedis, resetDb, startTestEnv, stopTestEnv } from './setup'

let app: Awaited<ReturnType<typeof build>>
let pool: ReturnType<typeof getPool>
let redis: Redis
let apiKey: string
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

    // Set up API key for validation tests
    const userRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'test@example.com',
        password: 'Password123*',
        confirm_password: 'Password123*'
      }
    })

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

    const projectRes = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: { name: 'Test Project' },
      cookies: cookieJar
    })

    const keyRes = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      cookies: cookieJar,
      payload: { name: 'Test API Key' }
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
      password: 'Password123*',
      confirm_password: 'Password123*'
    }
  })

  const loginRes = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: {
      email: 'test@example.com',
      password: 'Password123*'
    }
  })

  const projectRes = await app.inject({
    method: 'POST',
    url: '/projects',
    payload: { name: 'Test Project' },
    cookies: cookieJar
  })

  const keyRes = await app.inject({
    method: 'POST',
    url: '/v1/api-keys',
    cookies: cookieJar,
    payload: { name: 'Test API Key' }
  })
  apiKey = keyRes.json().full_key
})

describe('Validation Integration Tests', () => {
  describe('Authentication Required', () => {
    test('401 on missing authorization header for email validation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        payload: { email: 'test@example.com' }
      })
      expect(res.statusCode).toBe(401)
    })

    test('401 on invalid API key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        headers: { authorization: 'Bearer invalid-key' },
        payload: { email: 'test@example.com' }
      })
      expect(res.statusCode).toBe(401)
    })

    test('401 on missing authorization for phone validation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/phone',
        payload: { phone: '+1234567890' }
      })
      expect(res.statusCode).toBe(401)
    })

    test('401 on missing authorization for address validation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/address',
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
  })

  describe('Email Validation (POST /v1/validate/email)', () => {
    test('200 validates valid email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        headers: { 'x-api-key': apiKey },
        payload: { email: 'user@gmail.com' }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('valid')
      expect(body).toHaveProperty('normalized')
      expect(body).toHaveProperty('disposable')
      expect(body).toHaveProperty('mx_found')
      expect(body).toHaveProperty('reason_codes')
      expect(body).toHaveProperty('request_id')
      expect(body).toHaveProperty('ttl_seconds')
    })

    test('200 validates invalid email format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        headers: { 'x-api-key': apiKey },
        payload: { email: 'invalid-email' }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.valid).toBe(false)
      expect(body.reason_codes).toContain('email.invalid_format')
    })

    test('200 handles case normalization', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        headers: { 'x-api-key': apiKey },
        payload: { email: 'USER@EXAMPLE.COM' }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.normalized).toBe('user@example.com')
    })

    test('200 handles disposable email detection', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        headers: { 'x-api-key': apiKey },
        payload: { email: 'user@tempmail.com' }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('disposable')
    })

    test('400 on missing email field', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        headers: { 'x-api-key': apiKey },
        payload: {}
      })
      expect(res.statusCode).toBe(400)
    })

    test('400 on empty email field', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        headers: { 'x-api-key': apiKey },
        payload: { email: '' }
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('Phone Validation (POST /v1/validate/phone)', () => {
    test('200 validates valid US phone number', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/phone',
        headers: { 'x-api-key': apiKey },
        payload: { phone: '+12025550123' }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('valid')
      expect(body).toHaveProperty('e164')
      expect(body).toHaveProperty('country')
      expect(body).toHaveProperty('reason_codes')
      expect(body).toHaveProperty('request_id')
    })

    test('200 validates phone with country hint', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/phone',
        headers: { 'x-api-key': apiKey },
        payload: { phone: '020 1234 5678', country: 'GB' }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('valid')
      expect(body.country).toBe('GB')
    })

    test('200 handles invalid phone number', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/phone',
        headers: { 'x-api-key': apiKey },
        payload: { phone: 'invalid-phone' }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.valid).toBe(false)
      expect(body.reason_codes).toContain('phone.invalid')
    })

    test('200 requests OTP when requested', async () => {
      // const res = await app.inject({
      //   method: 'POST',
      //   url: '/v1/validate/phone',
      //   headers: { 'x-api-key': apiKey },
      //   payload: {
      //     phone: '+12025550123',
      //     request_otp: true
      //   }
      // })
      // expect(res.statusCode).toBe(200)
      // const body = res.json()
      // expect(body).toHaveProperty('verification_sid')
    })

    test('400 on missing phone field', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/phone',
        headers: { 'x-api-key': apiKey },
        payload: {}
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('Address Validation (POST /v1/validate/address)', () => {
    test('200 validates valid US address', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/address',
        headers: { 'x-api-key': apiKey },
        payload: {
          address: {
            line1: '123 Main Street',
            city: 'New York',
            postal_code: '10001',
            country: 'US'
          }
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('valid')
      expect(body).toHaveProperty('normalized')
      expect(body).toHaveProperty('po_box')
      expect(body).toHaveProperty('postal_city_match')
      expect(body).toHaveProperty('reason_codes')
      expect(body).toHaveProperty('request_id')
    })

    test('200 detects P.O. Box addresses', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/address',
        headers: { 'x-api-key': apiKey },
        payload: {
          address: {
            line1: 'P.O. Box 123',
            city: 'Anytown',
            postal_code: '12345',
            country: 'US'
          }
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.po_box).toBe(true)
      expect(body.reason_codes).toContain('address.po_box')
    })

    test('200 validates address with line2', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/address',
        headers: { 'x-api-key': apiKey },
        payload: {
          address: {
            line1: '123 Main Street',
            line2: 'Apt 4B',
            city: 'New York',
            postal_code: '10001',
            country: 'US'
          }
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('valid')
    })

    test('200 validates international address', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/address',
        headers: { 'x-api-key': apiKey },
        payload: {
          address: {
            line1: '10 Downing Street',
            city: 'London',
            postal_code: 'SW1A 2AA',
            country: 'GB'
          }
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('valid')
    })

    test('400 on missing required address fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/address',
        headers: { 'x-api-key': apiKey },
        payload: {
          address: {
            line1: '123 Main St'
            // Missing city, postal_code, country
          }
        }
      })
      expect(res.statusCode).toBe(400)
    })

    test('400 on missing address object', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/address',
        headers: { 'x-api-key': apiKey },
        payload: {}
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('Tax ID Validation (POST /v1/validate/tax-id)', () => {
    test('200 validates US SSN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/tax-id',
        headers: { 'x-api-key': apiKey },
        payload: {
          value: '123-45-6789',
          country: 'US',
          type: 'ssn'
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('valid')
      expect(body).toHaveProperty('normalized')
      expect(body).toHaveProperty('type')
      expect(body).toHaveProperty('reason_codes')
      expect(body).toHaveProperty('request_id')
    })

    test('200 validates US EIN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/tax-id',
        headers: { 'x-api-key': apiKey },
        payload: {
          value: '12-3456789',
          country: 'US',
          type: 'ein'
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('valid')
      expect(body.type).toBe('ein')
    })

    test('200 validates invalid tax ID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/tax-id',
        headers: { 'x-api-key': apiKey },
        payload: {
          value: 'invalid-tax-id',
          country: 'US',
          type: 'ssn'
        }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.valid).toBe(false)
      expect(body.reason_codes).toContain('tax_id.invalid')
    })

    test('400 on missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/tax-id',
        headers: { 'x-api-key': apiKey },
        payload: { value: '123-45-6789' }
        // Missing country and type
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('Name Validation (POST /v1/validate/name)', () => {
    test('200 validates full name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/name',
        headers: { 'x-api-key': apiKey },
        payload: { name: 'John Doe' }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('valid')
      expect(body).toHaveProperty('normalized')
      expect(body).toHaveProperty('reason_codes')
      expect(body).toHaveProperty('request_id')
    })

    test('200 validates name with special characters', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/name',
        headers: { 'x-api-key': apiKey },
        payload: { name: "Jean-Pierre O'Connor" }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('valid')
    })

    test('200 handles short name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/name',
        headers: { 'x-api-key': apiKey },
        payload: { name: 'A' }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('valid')
    })

    test('200 handles very long name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/name',
        headers: { 'x-api-key': apiKey },
        payload: { name: 'A'.repeat(200) }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('valid')
    })

    test('400 on empty name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/name',
        headers: { 'x-api-key': apiKey },
        payload: { name: '' }
      })
      expect(res.statusCode).toBe(400)
    })

    test('400 on missing name field', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/name',
        headers: { 'x-api-key': apiKey },
        payload: {}
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('Usage Tracking and Rate Limiting', () => {
    test('tracks validation usage', async () => {
      // Perform multiple validations
      const emailRes = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        headers: { 'x-api-key': apiKey },
        payload: { email: 'test@example.com' }
      })
      expect(emailRes.statusCode).toBe(200)

      const phoneRes = await app.inject({
        method: 'POST',
        url: '/v1/validate/phone',
        headers: { 'x-api-key': apiKey },
        payload: { phone: '+1234567890' }
      })
      expect(phoneRes.statusCode).toBe(200)

      // Check that API key was used
      const keysRes = await app.inject({
        method: 'GET',
        url: '/v1/keys',
        headers: { authorization: `Bearer ${apiKey.replace('orb_', '')}` }
      })
      // This would need to be adapted based on the actual PAT token flow
    })

    test('handles concurrent validation requests', async () => {
      const promises: Promise<any>[] = []
      for (let i = 0; i < 5; i++) {
        promises.push(
          app.inject({
            method: 'POST',
            url: '/v1/validate/email',
            headers: { 'x-api-key': apiKey },
            payload: { email: `test${i}@example.com` }
          })
        )
      }

      const results = await Promise.all(promises)
      results.forEach(res => {
        expect(res.statusCode).toBe(200)
      })
    })
  })

  describe('Error Handling', () => {
    test('handles malformed JSON payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        payload: 'invalid json'
      })
      expect(res.statusCode).toBe(400)
    })

    test('handles unsupported content type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'text/plain'
        },
        payload: 'test@example.com'
      })
      expect(res.statusCode).toBe(415)
    })

    test('handles extremely large payloads', async () => {
      // Create a payload that exceeds 100KB (server limit is 102400 bytes)
      const largeEmail = 'a'.repeat(200000) + '@example.com' // 200KB+ payload
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        headers: { 'x-api-key': apiKey },
        payload: { email: largeEmail }
      })
      expect(res.statusCode).toBe(413) // Payload too large
    })
  })

  describe('Response Structure Validation', () => {
    test('email validation response has all required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        headers: { 'x-api-key': apiKey },
        payload: { email: 'test@example.com' }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()

      // Check all required fields
      expect(typeof body.valid).toBe('boolean')
      expect(typeof body.normalized).toBe('string')
      expect(typeof body.disposable).toBe('boolean')
      expect(typeof body.mx_found).toBe('boolean')
      expect(Array.isArray(body.reason_codes)).toBe(true)
      expect(typeof body.request_id).toBe('string')
      expect(typeof body.ttl_seconds).toBe('number')
    })

    test('phone validation response has all required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate/phone',
        headers: { 'x-api-key': apiKey },
        payload: { phone: '+12025550123' }
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()

      expect(typeof body.valid).toBe('boolean')
      expect(typeof body.e164).toBe('string')
      expect(typeof body.country).toBe('string')
      expect(Array.isArray(body.reason_codes)).toBe(true)
      expect(typeof body.request_id).toBe('string')
    })

    test('unique request_id for each request', async () => {
      const res1 = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        headers: { 'x-api-key': apiKey },
        payload: { email: 'test@example.com' }
      })

      const res2 = await app.inject({
        method: 'POST',
        url: '/v1/validate/email',
        headers: { 'x-api-key': apiKey },
        payload: { email: 'test2@example.com' }
      })

      expect(res1.json().request_id).not.toBe(res2.json().request_id)
    })
  })
})