import Redis from "ioredis"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { build } from "../src/server"
import { getPool, getRedis, seedTestData, startTestEnv, stopTestEnv } from "./setup"

let app: Awaited<ReturnType<typeof build>>
let pool: ReturnType<typeof getPool>
let redis: Redis
let patToken: string
let projectId: string

// Test order data generators
const createValidOrder = (overrides: any = {}) => ({
    order_id: `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    customer: {
        email: 'test@example.com',
        phone: '+1234567890',
        first_name: 'John',
        last_name: 'Doe'
    },
    shipping_address: {
        line1: '123 Main Street',
        city: 'Anytown',
        state: 'NY',
        postal_code: '10001',
        country: 'US'
    },
    total_amount: 99.99,
    currency: 'USD',
    payment_method: 'card',
    session_id: `SESSION-${Date.now()}`,
    metadata: {
        source: 'test',
        campaign: 'test-campaign'
    },
    ...overrides
})

const createHighRiskOrder = (overrides: any = {}) => ({
    order_id: `ORDER-HIGH-RISK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    customer: {
        email: 'user@10minutemail.com', // Disposable email
        phone: '+123', // Invalid phone
        first_name: 'Test',
        last_name: 'User'
    },
    shipping_address: {
        line1: 'PO Box 123', // PO Box
        city: 'Anytown',
        state: 'CA',
        postal_code: '10001', // Mismatch - NY code for CA
        country: 'US'
    },
    total_amount: 15000.00, // High value
    currency: 'USD',
    payment_method: 'cod', // COD increases risk
    ...overrides
})

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

        // Set up authentication and get project ID
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

        // Get project ID
        const projectRes = await app.inject({
            method: 'GET',
            url: '/v1/projects',
            headers: { authorization: `Bearer ${patToken}` }
        })
        projectId = projectRes.json()[0]?.id || 'test-project-id'

        console.log('Orders test setup completed')
    } catch (error) {
        console.error('Failed to start test environment:', error)
        throw error
    }
}, 30000)

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

describe('Orders Integration Tests', () => {
    describe('Basic Order Evaluation', () => {
        test('evaluates valid order successfully', async () => {
            const orderData = createValidOrder()

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(200)
            const body = res.json()

            // Check response structure
            expect(body).toHaveProperty('order_id')
            expect(body).toHaveProperty('risk_score')
            expect(body).toHaveProperty('action')
            expect(body).toHaveProperty('tags')
            expect(body).toHaveProperty('reason_codes')
            expect(body).toHaveProperty('customer_dedupe')
            expect(body).toHaveProperty('address_dedupe')
            expect(body).toHaveProperty('validations')
            expect(body).toHaveProperty('rules_evaluation')
            expect(body).toHaveProperty('request_id')

            // Valid order should have reasonable risk score and approve/hold action
            expect(body.risk_score).toBeLessThanOrEqual(100)
            expect(body.risk_score).toBeGreaterThanOrEqual(0)
            expect(['approve', 'hold', 'block']).toContain(body.action)
        })

        test('handles missing required fields', async () => {
            const invalidOrder = {
                order_id: 'ORDER-INVALID-1',
                // Missing customer
                shipping_address: {
                    line1: '123 Main Street',
                    city: 'Anytown',
                    postal_code: '10001',
                    country: 'US'
                },
                total_amount: 99.99,
                currency: 'USD'
            }

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: invalidOrder
            })

            expect(res.statusCode).toBe(400)
        })

        test('validates currency format', async () => {
            const orderData = createValidOrder({
                currency: 'invalid' // Should be 3 letters
            })

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(400)
        })

        test('handles different payment methods', async () => {
            const paymentMethods = ['card', 'cod', 'bank_transfer']

            for (const paymentMethod of paymentMethods) {
                const orderData = createValidOrder({ payment_method: paymentMethod })

                const res = await app.inject({
                    method: 'POST',
                    url: '/v1/orders/evaluate',
                    headers: { authorization: `Bearer ${patToken}` },
                    payload: orderData
                })

                expect(res.statusCode).toBe(200)
                const body = res.json()
                expect(body.action).toBeDefined()
            }
        })
    })

    describe('Risk Scoring and Actions', () => {
        test('assigns high risk to duplicate orders', async () => {
            const orderData = createValidOrder({
                order_id: 'DUPLICATE-TEST-ORDER-1'
            })

            // First order
            const res1 = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res1.statusCode).toBe(200)
            const body1 = res1.json()

            // Second order with same order_id (should be treated as duplicate)
            const res2 = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData // Same order data including same order_id
            })

            expect(res2.statusCode).toBe(200)
            const body2 = res2.json()

            // Second order should have higher risk due to duplicate detection
            expect(body2.risk_score).toBeGreaterThan(body1.risk_score)
            expect(body2.tags).toContain('duplicate_order')
            expect(body2.reason_codes).toContain('ORDER_DUPLICATE_DETECTED')
        })

        test('assigns high risk to PO Box addresses', async () => {
            const orderData = createValidOrder({
                shipping_address: {
                    line1: 'PO Box 123',
                    city: 'Anytown',
                    postal_code: '12345',
                    country: 'US'
                }
            })

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(200)
            const body = res.json()

            expect(body.tags).toContain('po_box_detected')
            expect(body.reason_codes).toContain('ORDER_PO_BOX_BLOCK')
        })

        test('handles high-value orders', async () => {
            const orderData = createValidOrder({
                total_amount: 15000.00
            })

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(200)
            const body = res.json()

            expect(body.tags).toContain('high_value_order')
            expect(body.reason_codes).toContain('ORDER_HIGH_VALUE')
        })

        test('increases risk for COD payment method', async () => {
            const orderData = createValidOrder({
                payment_method: 'cod'
            })

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(200)
            const body = res.json()

            expect(body.tags).toContain('cod_order')
            expect(body.reason_codes).toContain('ORDER_COD_RISK')
        })

        test('assigns very high risk to combined high-risk factors', async () => {
            const orderData = createHighRiskOrder()

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(200)
            const body = res.json()

            // Should have multiple high-risk indicators
            expect(body.risk_score).toBeGreaterThan(50)
            expect(['hold', 'block']).toContain(body.action)
            expect(body.tags.length).toBeGreaterThan(0)
        })
    })

    describe('Email and Phone Validation', () => {
        test('validates email format', async () => {
            const invalidEmails = [
                'invalid-email',
                '@domain.com',
                'user@',
                'user..double.dot@domain.com'
            ]

            for (const email of invalidEmails) {
                const orderData = createValidOrder({
                    customer: {
                        ...createValidOrder().customer,
                        email
                    }
                })

                const res = await app.inject({
                    method: 'POST',
                    url: '/v1/orders/evaluate',
                    headers: { authorization: `Bearer ${patToken}` },
                    payload: orderData
                })

                expect(res.statusCode).toBe(200)
                const body = res.json()

                expect(body.validations.email.valid).toBe(false)
            }
        })

        test('detects disposable emails', async () => {
            const orderData = createValidOrder({
                customer: {
                    ...createValidOrder().customer,
                    email: 'user@10minutemail.com'
                }
            })

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(200)
            const body = res.json()

            expect(body.tags).toContain('disposable_email')
            expect(body.reason_codes).toContain('ORDER_DISPOSABLE_EMAIL')
        })

        test('validates phone number format', async () => {
            const invalidPhones = ['123', '+123', '1234567890123456', 'abc123def']

            for (const phone of invalidPhones) {
                const orderData = createValidOrder({
                    customer: {
                        ...createValidOrder().customer,
                        phone
                    }
                })

                const res = await app.inject({
                    method: 'POST',
                    url: '/v1/orders/evaluate',
                    headers: { authorization: `Bearer ${patToken}` },
                    payload: orderData
                })

                expect(res.statusCode).toBe(200)
                const body = res.json()

                expect(body.validations.phone.valid).toBe(false)
            }
        })

        test('handles missing email and phone gracefully', async () => {
            const orderData = createValidOrder({
                customer: {
                    first_name: 'John',
                    last_name: 'Doe'
                    // No email or phone
                }
            })

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(200)
            const body = res.json()

            // Should not fail, just have neutral validation results
            expect(body.validations.email.valid).toBe(true)
            expect(body.validations.phone.valid).toBe(true)
        })
    })

    describe('Address Validation and Deduplication', () => {
        test('validates address format and geocoding', async () => {
            const orderData = createValidOrder({
                shipping_address: {
                    line1: '123 Main Street',
                    city: 'New York',
                    state: 'NY',
                    postal_code: '10001',
                    country: 'US'
                }
            })

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(200)
            const body = res.json()

            expect(body.validations.address).toHaveProperty('valid')
            expect(body.validations.address).toHaveProperty('po_box')
            expect(body.validations.address).toHaveProperty('postal_city_match')
            expect(body.validations.address).toHaveProperty('in_bounds')
            expect(body.validations.address).toHaveProperty('reason_codes')
        })

        test('detects postal code mismatches', async () => {
            const orderData = createValidOrder({
                shipping_address: {
                    line1: '123 Main Street',
                    city: 'Los Angeles', // CA city
                    state: 'NY',        // NY state
                    postal_code: '10001', // NY postal code
                    country: 'US'
                }
            })

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(200)
            const body = res.json()

            expect(body.validations.address.postal_city_match).toBe(false)
            expect(body.reason_codes).toContain('ORDER_ADDRESS_MISMATCH')
        })

        test('handles address deduplication', async () => {
            // First order
            const order1 = createValidOrder({
                shipping_address: {
                    line1: '456 Oak Avenue',
                    city: 'Chicago',
                    state: 'IL',
                    postal_code: '60601',
                    country: 'US'
                }
            })

            const res1 = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: order1
            })

            expect(res1.statusCode).toBe(200)

            // Similar order (should trigger dedupe)
            const order2 = createValidOrder({
                shipping_address: {
                    line1: '456 Oak Ave', // Slightly different format
                    city: 'Chicago',
                    state: 'IL',
                    postal_code: '60601',
                    country: 'US'
                }
            })

            const res2 = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: order2
            })

            expect(res2.statusCode).toBe(200)
            const body2 = res2.json()

            // Should have address dedupe matches
            expect(body2.address_dedupe.matches.length).toBeGreaterThan(0)
            expect(body2.tags).toContain('potential_duplicate_address')
            expect(body2.reason_codes).toContain('ORDER_ADDRESS_DEDUPE_MATCH')
        })
    })

    describe('Customer Deduplication', () => {
        test('detects duplicate customers', async () => {
            // First order
            const order1 = createValidOrder({
                customer: {
                    email: 'duplicate@test.com',
                    phone: '+1555123456',
                    first_name: 'Jane',
                    last_name: 'Smith'
                }
            })

            const res1 = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: order1
            })

            expect(res1.statusCode).toBe(200)

            // Similar customer (should trigger dedupe)
            const order2 = createValidOrder({
                customer: {
                    email: 'duplicate@test.com', // Same email
                    phone: '+1555123456',        // Same phone
                    first_name: 'Jane',          // Same name
                    last_name: 'Smith'
                }
            })

            const res2 = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: order2
            })

            expect(res2.statusCode).toBe(200)
            const body2 = res2.json()

            // Should have customer dedupe matches
            expect(body2.customer_dedupe.matches.length).toBeGreaterThan(0)
            expect(body2.tags).toContain('potential_duplicate_customer')
            expect(body2.reason_codes).toContain('ORDER_CUSTOMER_DEDUPE_MATCH')
        })
    })

    describe('Rules Integration', () => {
        test('integrates with rules evaluation when available', async () => {
            const orderData = createValidOrder()

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(200)
            const body = res.json()

            // Should have rules evaluation section
            expect(body.rules_evaluation).toBeDefined()
            expect(body.rules_evaluation).toHaveProperty('triggered_rules')
            expect(body.rules_evaluation).toHaveProperty('final_decision')

            // Final decision should exist (even if empty)
            expect(body.rules_evaluation.final_decision).toBeDefined()
        })

        test('handles orders with rules that trigger blocking actions', async () => {
            // Test order that would potentially trigger rules
            const orderData = createValidOrder({
                customer: {
                    ...createValidOrder().customer,
                    email: 'user@suspicious-domain.com'
                }
            })

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(200)
            const body = res.json()

            // Order should still be evaluated even if rules evaluation has issues
            expect(body.action).toBeDefined()
            expect(body.risk_score).toBeDefined()
        })
    })

    describe('Authentication and Authorization', () => {
        test('requires valid authentication', async () => {
            const orderData = createValidOrder()

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: 'Bearer invalid-token' },
                payload: orderData
            })

            expect(res.statusCode).toBe(401)
        })

        test('works with valid PAT token', async () => {
            const orderData = createValidOrder()

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(200)
        })

        test('handles missing authorization header', async () => {
            const orderData = createValidOrder()

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                payload: orderData
            })

            expect(res.statusCode).toBe(401)
        })
    })

    describe('Edge Cases and Error Handling', () => {
        test('handles extremely large order amounts', async () => {
            const orderData = createValidOrder({
                total_amount: 999999999.99
            })

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(200)
            const body = res.json()

            expect(body.risk_score).toBeLessThanOrEqual(100)
            expect(['hold', 'block']).toContain(body.action)
        })

        test('handles empty optional fields', async () => {
            const orderData = {
                order_id: 'ORDER-EMPTY-FIELDS',
                customer: {
                    email: 'test@example.com',
                    first_name: '',
                    last_name: '',
                    phone: ''
                },
                shipping_address: {
                    line1: '123 Main Street',
                    city: 'Anytown',
                    state: '',
                    postal_code: '12345',
                    country: 'US',
                    line2: ''
                },
                total_amount: 50.00,
                currency: 'USD'
            }

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(200)
            const body = res.json()
            expect(body.action).toBeDefined()
        })

        test('handles special characters in order data', async () => {
            const orderData = createValidOrder({
                customer: {
                    email: 'test+special@example.com',
                    first_name: 'José',
                    last_name: "O'Connor",
                    phone: '+1234567890'
                },
                shipping_address: {
                    line1: '123 Main St. #5',
                    city: 'São Paulo',
                    state: 'SP',
                    postal_code: '12345-678',
                    country: 'BR'
                }
            })

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: orderData
            })

            expect(res.statusCode).toBe(200)
            const body = res.json()
            expect(body.order_id).toBeDefined()
        })

        test('handles concurrent order processing', async () => {
            const orderData = createValidOrder({
                order_id: 'CONCURRENT-TEST-ORDER'
            })

            // Make multiple concurrent requests
            const promises = Array(5).fill(0).map(() =>
                app.inject({
                    method: 'POST',
                    url: '/v1/orders/evaluate',
                    headers: { authorization: `Bearer ${patToken}` },
                    payload: orderData
                })
            )

            const results = await Promise.all(promises)

            // All should succeed
            results.forEach(res => {
                expect(res.statusCode).toBe(200)
            })

            // All should have the same risk assessment
            const bodies = results.map(res => res.json())
            const firstRiskScore = bodies[0].risk_score

            bodies.forEach(body => {
                expect(body.risk_score).toBe(firstRiskScore)
            })
        })
    })

    describe('Performance and Response Time', () => {
        test('responds within acceptable time for valid orders', async () => {
            const startTime = Date.now()

            const res = await app.inject({
                method: 'POST',
                url: '/v1/orders/evaluate',
                headers: { authorization: `Bearer ${patToken}` },
                payload: createValidOrder()
            })

            const responseTime = Date.now() - startTime

            expect(res.statusCode).toBe(200)
            expect(responseTime).toBeLessThan(5000) // Should respond within 5 seconds
        })

        test('handles bulk order evaluation efficiently', async () => {
            const orders = Array(10).fill(0).map((_, i) =>
                createValidOrder({ order_id: `BULK-TEST-${i}` })
            )

            const startTime = Date.now()

            const promises = orders.map(order =>
                app.inject({
                    method: 'POST',
                    url: '/v1/orders/evaluate',
                    headers: { authorization: `Bearer ${patToken}` },
                    payload: order
                })
            )

            const results = await Promise.all(promises)
            const totalTime = Date.now() - startTime

            // All should succeed
            results.forEach(res => {
                expect(res.statusCode).toBe(200)
            })

            // Should handle bulk requests efficiently
            expect(totalTime).toBeLessThan(30000) // 30 seconds for 10 orders
        })
    })
})
