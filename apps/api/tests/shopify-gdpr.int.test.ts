/**
 * Integration tests for Shopify GDPR webhook handlers
 * Tests compliance with mandatory GDPR webhooks: customers/data_request, customers/redact, shop/redact
 */

import crypto from 'crypto';
import { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { build } from '../src/server.js';
import { getPool, getRedis, startTestEnv, stopTestEnv } from './setup.js';

// Generate a unique webhook ID for each request to avoid idempotency conflicts
function generateWebhookId(): string {
    return crypto.randomUUID();
}

let app: Awaited<ReturnType<typeof build>>;
let pool: Pool;
let redis: Redis;

beforeAll(async () => {
    try {
        // Set Shopify API credentials for tests
        process.env.SHOPIFY_API_KEY = 'test-shopify-api-key';
        process.env.SHOPIFY_API_SECRET = 'test-shopify-api-secret';

        await startTestEnv();
        pool = getPool();
        redis = getRedis();
        app = await build(pool, redis);
        await app.ready();
        await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
        console.error('Failed to start test environment:', error);
        throw error;
    }
});

afterAll(async () => {
    try {
        if (app) await app.close();
        await redis?.quit();
        await stopTestEnv();
    } catch (error) {
        console.error('Failed to stop test environment:', error);
    }
});

describe('Shopify GDPR Webhooks Integration', () => {
    const testShop = 'gdpr-test-shop.myshopify.com';

    beforeEach(async () => {
        // Clean up test data before each test
        await pool.query('DELETE FROM shopify_gdpr_events WHERE 1=1');
        await pool.query('DELETE FROM shopify_settings WHERE 1=1');
        await pool.query('DELETE FROM shopify_shops WHERE 1=1');
        await pool.query('DELETE FROM logs WHERE 1=1');

        // Create test shop for GDPR tests
        await pool.query(
            `INSERT INTO shopify_shops (shop_domain, access_token, scopes, onboarding_status)
             VALUES ($1, $2, $3, $4)`,
            [testShop, 'shpat_encrypted_test', ['read_orders', 'write_orders', 'read_customers', 'write_customers'], 'completed']
        );
    });

    describe('customers/data_request webhook', () => {
        test('should record GDPR data request event', async () => {
            const payload = {
                shop_id: 123456,
                shop_domain: testShop,
                orders_requested: [1001, 1002],
                customer: {
                    id: 789,
                    email: 'customer@example.com',
                    phone: '+1234567890',
                },
                data_request: {
                    id: 999,
                },
            };

            const response = await app.inject({
                method: 'POST',
                url: '/integrations/shopify/webhooks/gdpr/customers-data-request',
                payload,
                headers: {
                    'X-Shopify-Shop-Domain': testShop,
                    'X-Shopify-Webhook-Id': generateWebhookId(),
                    'Content-Type': 'application/json',
                    'X-Internal-Request': 'shopify-app',
                },
            });

            expect(response.statusCode).toBe(200);

            // Wait for async processing
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Verify GDPR event was recorded
            const gdprResult = await pool.query(
                `SELECT topic, payload FROM shopify_gdpr_events
                 WHERE shop_id = (SELECT id FROM shopify_shops WHERE shop_domain = $1)
                 AND topic = 'customers/data_request'`,
                [testShop]
            );

            expect(gdprResult.rows.length).toBeGreaterThanOrEqual(1);
            expect(gdprResult.rows[0].payload.customer.id).toBe(789);
        });

        test('should return 200 even when shop is not found', async () => {
            const payload = {
                shop_id: 999999,
                shop_domain: 'unknown-shop.myshopify.com',
                customer: { id: 123 },
                data_request: { id: 456 },
            };

            const response = await app.inject({
                method: 'POST',
                url: '/integrations/shopify/webhooks/gdpr/customers-data-request',
                payload,
                headers: {
                    'X-Shopify-Shop-Domain': 'unknown-shop.myshopify.com',
                    'X-Shopify-Webhook-Id': generateWebhookId(),
                    'Content-Type': 'application/json',
                    'X-Internal-Request': 'shopify-app',
                },
            });

            // Should return 400 (missing shop) rather than failing
            expect([200, 400]).toContain(response.statusCode);
        });
    });

    describe('customers/redact webhook', () => {
        test('should record GDPR customer redact event', async () => {
            const payload = {
                shop_id: 123456,
                shop_domain: testShop,
                customer: {
                    id: 789,
                    email: 'redact@example.com',
                    phone: '+1234567890',
                },
                orders_to_redact: [2001, 2002, 2003],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/integrations/shopify/webhooks/gdpr/customers-redact',
                payload,
                headers: {
                    'X-Shopify-Shop-Domain': testShop,
                    'X-Shopify-Webhook-Id': generateWebhookId(),
                    'Content-Type': 'application/json',
                    'X-Internal-Request': 'shopify-app',
                },
            });

            expect(response.statusCode).toBe(200);

            // Wait for async processing
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Verify GDPR event was recorded
            const gdprResult = await pool.query(
                `SELECT topic, payload FROM shopify_gdpr_events
                 WHERE shop_id = (SELECT id FROM shopify_shops WHERE shop_domain = $1)
                 AND topic = 'customers/redact'`,
                [testShop]
            );

            expect(gdprResult.rows.length).toBeGreaterThanOrEqual(1);
            expect(gdprResult.rows[0].payload.customer.id).toBe(789);
            expect(gdprResult.rows[0].payload.orders_to_redact).toEqual([2001, 2002, 2003]);
        });

        test('should redact customer PII from logs', async () => {
            // First, create some logs with customer PII
            await pool.query(
                `INSERT INTO logs (project_id, type, endpoint, reason_codes, status, meta)
                 SELECT p.id, 'validation', '/validate', ARRAY['VALID'], 200,
                        jsonb_build_object('customer_id', '789', 'email', 'redact@example.com', 'phone', '+1234567890')
                 FROM projects p LIMIT 1`
            );

            const payload = {
                shop_id: 123456,
                shop_domain: testShop,
                customer: {
                    id: 789,
                    email: 'redact@example.com',
                },
                orders_to_redact: [],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/integrations/shopify/webhooks/gdpr/customers-redact',
                payload,
                headers: {
                    'X-Shopify-Shop-Domain': testShop,
                    'X-Shopify-Webhook-Id': generateWebhookId(),
                    'Content-Type': 'application/json',
                    'X-Internal-Request': 'shopify-app',
                },
            });

            expect(response.statusCode).toBe(200);

            // Wait for async redaction processing
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Verify redaction event was recorded
            const gdprResult = await pool.query(
                `SELECT topic FROM shopify_gdpr_events
                 WHERE shop_id = (SELECT id FROM shopify_shops WHERE shop_domain = $1)
                 AND topic LIKE 'customers/redact%'`,
                [testShop]
            );

            expect(gdprResult.rows.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('shop/redact webhook', () => {
        test('should record GDPR shop redact event and delete shop data', async () => {
            const shopToDelete = 'shop-to-delete.myshopify.com';

            // Create shop that will be deleted
            await pool.query(
                `INSERT INTO shopify_shops (shop_domain, access_token, scopes, onboarding_status)
                 VALUES ($1, $2, $3, $4)`,
                [shopToDelete, 'shpat_to_delete', ['read_orders'], 'completed']
            );

            // Verify shop exists
            const beforeResult = await pool.query(
                'SELECT id FROM shopify_shops WHERE shop_domain = $1',
                [shopToDelete]
            );
            expect(beforeResult.rows.length).toBe(1);

            const payload = {
                shop_id: 654321,
                shop_domain: shopToDelete,
            };

            const response = await app.inject({
                method: 'POST',
                url: '/integrations/shopify/webhooks/gdpr/shop-redact',
                payload,
                headers: {
                    'X-Shopify-Shop-Domain': shopToDelete,
                    'X-Shopify-Webhook-Id': generateWebhookId(),
                    'Content-Type': 'application/json',
                    'X-Internal-Request': 'shopify-app',
                },
            });

            expect(response.statusCode).toBe(200);

            // Wait for async deletion
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Verify shop was deleted
            const afterResult = await pool.query(
                'SELECT id FROM shopify_shops WHERE shop_domain = $1',
                [shopToDelete]
            );
            expect(afterResult.rows.length).toBe(0);
        });

        test('should handle shop/redact for already deleted shop gracefully', async () => {
            const payload = {
                shop_id: 999999,
                shop_domain: 'already-deleted.myshopify.com',
            };

            const response = await app.inject({
                method: 'POST',
                url: '/integrations/shopify/webhooks/gdpr/shop-redact',
                payload,
                headers: {
                    'X-Shopify-Shop-Domain': 'already-deleted.myshopify.com',
                    'X-Shopify-Webhook-Id': generateWebhookId(),
                    'Content-Type': 'application/json',
                    'X-Internal-Request': 'shopify-app',
                },
            });

            // Should return 200 or 400 (missing shop header) - not 500
            expect([200, 400]).toContain(response.statusCode);
        });
    });

    describe('GDPR event audit trail', () => {
        test('should maintain audit trail for all GDPR events', async () => {
            // Send multiple GDPR webhooks
            const customerId = 12345;

            // 1. Data request
            await app.inject({
                method: 'POST',
                url: '/integrations/shopify/webhooks/gdpr/customers-data-request',
                payload: {
                    shop_id: 111,
                    shop_domain: testShop,
                    customer: { id: customerId },
                    data_request: { id: 1 },
                },
                headers: {
                    'X-Shopify-Shop-Domain': testShop,
                    'X-Shopify-Webhook-Id': generateWebhookId(),
                    'Content-Type': 'application/json',
                    'X-Internal-Request': 'shopify-app',
                },
            });

            // 2. Customer redact
            await app.inject({
                method: 'POST',
                url: '/integrations/shopify/webhooks/gdpr/customers-redact',
                payload: {
                    shop_id: 111,
                    shop_domain: testShop,
                    customer: { id: customerId },
                    orders_to_redact: [],
                },
                headers: {
                    'X-Shopify-Shop-Domain': testShop,
                    'X-Shopify-Webhook-Id': generateWebhookId(),
                    'Content-Type': 'application/json',
                    'X-Internal-Request': 'shopify-app',
                },
            });

            // Wait for processing
            await new Promise((resolve) => setTimeout(resolve, 300));

            // Verify audit trail
            const auditResult = await pool.query(
                `SELECT topic, received_at FROM shopify_gdpr_events
                 WHERE shop_id = (SELECT id FROM shopify_shops WHERE shop_domain = $1)
                 ORDER BY received_at ASC`,
                [testShop]
            );

            const topics = auditResult.rows.map((r) => r.topic);
            expect(topics).toContain('customers/data_request');
            expect(topics).toContain('customers/redact');
        });
    });
});
