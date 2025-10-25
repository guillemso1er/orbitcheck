import type { FastifyInstance } from 'fastify';
import request from 'supertest';

import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

describe('Billing Routes', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        await setupBeforeAll();
        app = await createApp();

        app.addHook('preHandler', async (request_, _rep) => {
            if (request_.url.startsWith('/v1/billing')) {
                const authHeader = request_.headers.authorization;
                if (authHeader === 'Bearer valid_key') {
                    (request_ as { user_id: string }).user_id = 'test_user';
                    (request_ as { project_id: string }).project_id = 'test_project';
                }
            }
        });

        await app.ready();
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    beforeEach(() => {
        jest.clearAllMocks();

        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.includes('SELECT ID FROM USERS WHERE ID = $1')) {
                return Promise.resolve({ rows: [{ id: 'test_user' }] });
            }
            if (upperQuery.includes('SELECT STRIPE_CUSTOMER_ID FROM ACCOUNTS WHERE USER_ID = $1')) {
                return Promise.resolve({ rows: [{ stripe_customer_id: 'cus_test' }] });
            }
            if (upperQuery.includes('SELECT ID, STRIPE_CUSTOMER_ID')) {
                return Promise.resolve({
                    rows: [{
                        id: 'account_1',
                        stripe_customer_id: 'cus_test',
                        plan_tier: 'basic',
                        included_validations: 1000,
                        included_stores: 5
                    }]
                });
            }
            if (upperQuery.includes('SELECT COUNT(*) AS STORE_COUNT')) {
                return Promise.resolve({ rows: [{ store_count: '3' }] });
            }
            return Promise.resolve({ rows: [] });
        });
    });

    describe('POST /v1/billing/checkout', () => {
        it('should create Stripe checkout session successfully', async () => {
            // Mock Stripe
            const mockSession = {
                id: 'cs_test_123',
                url: 'https://checkout.stripe.com/test'
            };

            const stripeMock = {
                checkout: {
                    sessions: {
                        create: jest.fn().mockResolvedValue(mockSession)
                    }
                }
            };

            // Mock the stripe import
            jest.doMock('stripe', () => {
                return jest.fn().mockImplementation(() => stripeMock);
            });

            const response = await request(app.server)
                .post('/v1/billing/checkout')
                .set('Authorization', 'Bearer valid_key');

            expect(response.status).toBe(200);
            const body = response.body as { session_url: string; session_id: string; request_id: string };
            expect(body.session_url).toBeDefined();
            expect(body.session_id).toBeDefined();
            expect(body.request_id).toBeDefined();
        });

        it('should handle account not found', async () => {
            mockPool.query.mockImplementationOnce((queryText: string) => {
                if (queryText.includes('SELECT ID, STRIPE_CUSTOMER_ID')) {
                    return Promise.resolve({ rows: [] });
                }
                return Promise.resolve({ rows: [] });
            });

            const response = await request(app.server)
                .post('/v1/billing/checkout')
                .set('Authorization', 'Bearer valid_key');

            expect(response.status).toBe(400);
            const body = response.body as { error: { code: string } };
            expect(body.error.code).toBe('not_found');
        });
    });

    describe('POST /v1/billing/portal', () => {
        it('should create Stripe customer portal session successfully', async () => {
            // Mock Stripe
            const mockSession = {
                url: 'https://billing.stripe.com/test'
            };

            const stripeMock = {
                billingPortal: {
                    sessions: {
                        create: jest.fn().mockResolvedValue(mockSession)
                    }
                }
            };

            // Mock the stripe import
            jest.doMock('stripe', () => {
                return jest.fn().mockImplementation(() => stripeMock);
            });

            const response = await request(app.server)
                .post('/v1/billing/portal')
                .set('Authorization', 'Bearer valid_key');

            expect(response.status).toBe(200);
            const body = response.body as { portal_url: string; request_id: string };
            expect(body.portal_url).toBeDefined();
            expect(body.request_id).toBeDefined();
        });

        it('should handle no billing account found', async () => {
            mockPool.query.mockImplementationOnce((queryText: string) => {
                if (queryText.includes('SELECT STRIPE_CUSTOMER_ID FROM ACCOUNTS')) {
                    return Promise.resolve({ rows: [] });
                }
                return Promise.resolve({ rows: [] });
            });

            const response = await request(app.server)
                .post('/v1/billing/portal')
                .set('Authorization', 'Bearer valid_key');

            expect(response.status).toBe(400);
            const body = response.body as { error: { code: string } };
            expect(body.error.code).toBe('not_found');
        });
    });
});