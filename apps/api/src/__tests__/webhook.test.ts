jest.mock('@orbitcheck/contracts', () => ({
    DASHBOARD_ROUTES: {
        REGISTER_NEW_USER: '/auth/register',
        USER_LOGIN: '/auth/login',
        USER_LOGOUT: '/auth/logout',
    },
    MGMT_V1_ROUTES: {
        API_KEYS: {
            CREATE_API_KEY: '/v1/api-keys',
            LIST_API_KEYS: '/v1/api-keys',
            REVOKE_API_KEY: '/v1/api-keys/:id',
        },
        WEBHOOKS: {
            LIST_WEBHOOKS: '/v1/webhooks',
            CREATE_WEBHOOK: '/v1/webhooks',
            DELETE_WEBHOOK: '/v1/webhooks/:id',
            TEST_WEBHOOK: '/v1/webhooks/test',
        },
        DATA: {
            ERASE_USER_DATA: '/v1/data/erase',
            GET_EVENT_LOGS: '/v1/data/logs',
            GET_USAGE_STATISTICS: '/v1/data/usage',
        },
        RULES: {
            GET_AVAILABLE_RULES: '/v1/rules',
            GET_ERROR_CODE_CATALOG: '/v1/rules/error-codes',
            GET_REASON_CODE_CATALOG: '/v1/rules/catalog',
            REGISTER_CUSTOM_RULES: '/v1/rules/register',
            TEST_RULES_AGAINST_PAYLOAD: '/v1/rules/test',
        },
        SETTINGS: {
            GET_TENANT_SETTINGS: '/v1/settings',
            UPDATE_TENANT_SETTINGS: '/v1/settings',
        },
        LOGS: {
            DELETE_LOG_ENTRY: '/v1/logs/:id',
        },
        BILLING: {
            CREATE_STRIPE_CHECKOUT_SESSION: '/v1/billing/checkout',
            CREATE_STRIPE_CUSTOMER_PORTAL_SESSION: '/v1/billing/portal',
        },
    },
    API_V1_ROUTES: {
        BATCH: {
            BATCH_VALIDATE_DATA: '/v1/batch/validate',
            BATCH_DEDUPLICATE_DATA: '/v1/batch/dedupe',
        },
        JOBS: {
            GET_JOB_STATUS: '/v1/jobs/:id',
        },
        NORMALIZE: {
            NORMALIZE_ADDRESS_CHEAP: '/v1/normalize/address',
        },
        VALIDATE: {
            VALIDATE_EMAIL_ADDRESS: '/v1/validate/email',
            VALIDATE_PHONE_NUMBER: '/v1/validate/phone',
            VALIDATE_ADDRESS: '/v1/validate/address',
            VALIDATE_NAME: '/v1/validate/name',
            VALIDATE_TAX_ID: '/v1/validate/tax-id',
        },
        VERIFY: {
            VERIFY_PHONE_OTP: '/v1/verify/phone',
        },
        DEDUPE: {
            DEDUPLICATE_ADDRESS: '/v1/dedupe/address',
            DEDUPLICATE_CUSTOMER: '/v1/dedupe/customer',
            MERGE_DEDUPLICATED_RECORDS: '/v1/dedupe/merge',
        },
        ORDERS: {
            EVALUATE_ORDER_FOR_RISK_AND_RULES: '/v1/orders/evaluate',
        },
    },
}));

jest.mock('dotenv');

import type { FastifyInstance } from 'fastify';
import request from 'supertest';

import * as hooks from '../hooks.js';
import { verifyPAT } from '../routes/auth.js';
import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

// --- Tell Jest to mock the modules ---
jest.mock('node-fetch');

jest.mock('jsonwebtoken');

jest.mock('../routes/auth', () => {
    const actual = jest.requireActual('../routes/auth');
    return {
        ...actual,
        verifyPAT: jest.fn(async (request_: any) => {
            // Default: succeed and set ids
            request_.user_id = 'test_user';
            request_.project_id = 'test_project';
        }),
    };
});

// Cast the fetch mock for convenience
const fetchMock = fetch as unknown as jest.Mock;

const MOCK_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdF91c2VyIn0.ignore';

describe('Webhook Management Routes', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        await setupBeforeAll();
        app = await createApp();

        // Add auth hooks for this test
        const { authenticateRequest, applyRateLimitingAndIdempotency } = await import('../web.js');
        const { mockPool, mockRedisInstance } = await import('./testSetup.js');
        app.addHook("preHandler", async (request, rep) => {
            await authenticateRequest(request, rep, mockPool as any);
            await applyRateLimitingAndIdempotency(request, rep, mockRedisInstance as any);
            return;
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

        jest.spyOn(hooks, 'logEvent').mockImplementation(jest.fn().mockResolvedValue(undefined));

        mockPool.query.mockImplementation((queryText: string, values: unknown[]) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.startsWith('SELECT ID FROM USERS WHERE ID = $1') && values[0] === 'test_user') {
                return Promise.resolve({ rows: [{ id: 'test_user' }] });
            }
            if (upperQuery.startsWith('SELECT P.ID AS PROJECT_ID FROM PROJECTS P WHERE P.USER_ID = $1') && values[0] === 'test_user') {
                return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
            }
            return Promise.resolve({ rows: [] });
        });
    });

    it('should list webhooks successfully', async () => {
        const mockWebhooks = [
            {
                id: 'webhook-1',
                url: 'https://example.com/webhook1',
                events: ['validation_result'],
                status: 'active',
                created_at: '2023-01-01T00:00:00Z',
                last_fired_at: null
            }
        ];

        mockPool.query.mockResolvedValueOnce({ rows: mockWebhooks });

        const res = await request(app.server)
            .get('/v1/webhooks')
            .set('Authorization', `Bearer ${MOCK_JWT}`);

        expectStatus(res, 200);
        expect(res.body.data).toEqual(mockWebhooks);
        expect(hooks.logEvent).toHaveBeenCalled();
    });

    it('should create webhook successfully', async () => {
        const mockWebhook = {
            id: 'webhook-1',
            url: 'https://example.com/webhook',
            events: ['validation_result'],
            secret: 'mock-secret',
            status: 'active',
            created_at: '2023-01-01T00:00:00Z'
        };

        mockPool.query.mockResolvedValueOnce({ rows: [mockWebhook] });

        const res = await request(app.server)
            .post('/v1/webhooks')
            .set('Authorization', `Bearer ${MOCK_JWT}`)
            .send({
                url: 'https://example.com/webhook',
                events: ['validation_result']
            });

        expectStatus(res, 201);
        expect(res.body.id).toBe('webhook-1');
        expect(res.body.url).toBe('https://example.com/webhook');
        expect(res.body.events).toEqual(['validation_result']);
        expect(hooks.logEvent).toHaveBeenCalled();
    });

    it('should reject create webhook with invalid URL', async () => {
        const res = await request(app.server)
            .post('/v1/webhooks')
            .set('Authorization', `Bearer ${MOCK_JWT}`)
            .send({
                url: 'ftp://example.com',
                events: ['validation_result']
            });

        expectStatus(res, 400);
        expect(res.body.error.code).toBe('invalid_url');
    });

    it('should reject create webhook with invalid events', async () => {
        const res = await request(app.server)
            .post('/v1/webhooks')
            .set('Authorization', `Bearer ${MOCK_JWT}`)
            .send({
                url: 'https://example.com/webhook',
                events: ['invalid_event']
            });

        expectStatus(res, 400);
        expect(res.body.error.code).toBe('invalid_type');
    });

    it('should delete webhook successfully', async () => {
        mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'webhook-1', status: 'deleted' }] });

        const res = await request(app.server)
            .delete('/v1/webhooks/webhook-1')
            .set('Authorization', `Bearer ${MOCK_JWT}`);

        expectStatus(res, 200);
        expect(res.body.id).toBe('webhook-1');
        expect(res.body.status).toBe('deleted');
        expect(hooks.logEvent).toHaveBeenCalled();
    });

    it('should return 404 when deleting non-existent webhook', async () => {
        mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

        const res = await request(app.server)
            .delete('/v1/webhooks/non-existent')
            .set('Authorization', `Bearer ${MOCK_JWT}`);

        expectStatus(res, 404);
        expect(res.body.error.code).toBe('not_found');
    });
});

describe('Webhook Test Routes (JWT Auth)', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        await setupBeforeAll();
        app = await createApp();

        // Add auth hooks for this test
        const { authenticateRequest, applyRateLimitingAndIdempotency } = await import('../web.js');
        const { mockPool, mockRedisInstance } = await import('./testSetup.js');
        app.addHook("preHandler", async (request, rep) => {
            await authenticateRequest(request, rep, mockPool as any);
            await applyRateLimitingAndIdempotency(request, rep, mockRedisInstance as any);
            return;
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

        // Default mock for successful fetch requests
        fetchMock.mockResolvedValue({
            status: 200,
            statusText: 'OK',
            headers: new Map([['content-type', 'application/json']]),
            text: jest.fn().mockResolvedValue('{"status": "ok"}'),
            json: jest.fn().mockResolvedValue({ status: 'ok' }),
        });

        jest.spyOn(hooks, 'logEvent').mockImplementation(jest.fn().mockResolvedValue(undefined));



        mockPool.query.mockImplementation((queryText: string, values: unknown[]) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.startsWith('SELECT ID FROM USERS WHERE ID = $1') && values[0] === 'test_user') {
                return Promise.resolve({ rows: [{ id: 'test_user' }] });
            }
            if (upperQuery.startsWith('SELECT P.ID AS PROJECT_ID FROM PROJECTS P WHERE P.USER_ID = $1') && values[0] === 'test_user') {
                return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
            }
            return Promise.resolve({ rows: [] });
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should successfully test a webhook with validation payload', async () => {
        const res = await request(app.server)
            .post('/v1/webhooks/test')
            .set('Authorization', `Bearer ${MOCK_JWT}`)
            .send({
                url: 'https://example.com/webhook',
                payload_type: 'validation'
            });

        expectStatus(res, 200);
        expect(fetchMock).toHaveBeenCalledWith('https://example.com/webhook', expect.any(Object));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
            event: 'validation_result',
            type: 'email'
        });
        expect(res.body.sent_to).toBe('https://example.com/webhook');
        expect(hooks.logEvent).toHaveBeenCalled();
    });

    it('should handle custom payload successfully', async () => {
        const res = await request(app.server)
            .post('/v1/webhooks/test')
            .set('Authorization', `Bearer ${MOCK_JWT}`)
            .send({
                url: 'https://example.com/webhook',
                payload_type: 'custom',
                custom_payload: { event: 'custom_event', data: 'test' }
            });

        expectStatus(res, 200);
        const call = fetchMock.mock.calls[0][1];
        expect(JSON.parse(call.body)).toMatchObject({
            event: 'custom_event',
            data: 'test'
        });
    });

    it('should reject invalid URL', async () => {
        const res = await request(app.server)
            .post('/v1/webhooks/test')
            .set('Authorization', `Bearer ${MOCK_JWT}`)
            .send({
                url: 'ftp://example.com',
                payload_type: 'validation'
            });

        expectStatus(res, 400);
        expect(res.body.error.code).toBe('invalid_url');
    });

    it('should reject missing custom payload for custom type', async () => {
        const res = await request(app.server)
            .post('/v1/webhooks/test')
            .set('Authorization', `Bearer ${MOCK_JWT}`)
            .send({
                url: 'https://example.com/webhook',
                payload_type: 'custom'
            });

        expectStatus(res, 400);
        expect(res.body.error.code).toBe('missing_payload');
    });

    it('should handle fetch error', async () => {
        fetchMock.mockRejectedValue(new Error('Network error'));

        const res = await request(app.server)
            .post('/v1/webhooks/test')
            .set('Authorization', `Bearer ${MOCK_JWT}`)
            .send({
                url: 'https://example.com/webhook',
                payload_type: 'validation'
            });

        expectStatus(res, 502);
        expect(res.body.error.code).toBe('send_failed');
    });

    it('should reject without a valid JWT', async () => {
        // Override the successful mock with a failure for this specific test
        (verifyPAT as jest.Mock).mockImplementationOnce(async (_request, rep) => {
            return rep.status(401).send({ error: { code: 'invalid_token', message: 'Invalid or expired token' } });
        });


        const res = await request(app.server)
            .post('/v1/webhooks/test')
            .set('Authorization', `Bearer ${MOCK_JWT}`)
            .send({
                url: 'https://example.com/webhook',
                payload_type: 'validation'
            });

        expectStatus(res, 401);
        expect(res.body.error.code).toBe('invalid_token');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('Webhook Event Sending', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        await setupBeforeAll();
        app = await createApp();

        // Add auth hooks for this test
        const { authenticateRequest, applyRateLimitingAndIdempotency } = await import('../web.js');
        const { mockPool, mockRedisInstance } = await import('./testSetup.js');
        app.addHook("preHandler", async (request, rep) => {
            await authenticateRequest(request, rep, mockPool as any);
            await applyRateLimitingAndIdempotency(request, rep, mockRedisInstance as any);
            return;
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

        // Default mock for successful fetch requests
        fetchMock.mockResolvedValue({
            status: 200,
            statusText: 'OK',
            headers: new Map([['content-type', 'application/json']]),
            text: jest.fn().mockResolvedValue('{"status": "ok"}'),
            json: jest.fn().mockResolvedValue({ status: 'ok' }),
        });

        mockPool.query.mockImplementation((queryText: string, values: unknown[]) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.startsWith('INSERT INTO LOGS')) {
                return Promise.resolve({ rowCount: 1 });
            }
            if (upperQuery.startsWith('SELECT ID FROM USERS WHERE ID = $1') && values[0] === 'test_user') {
                return Promise.resolve({ rows: [{ id: 'test_user' }] });
            }
            if (upperQuery.startsWith('SELECT P.ID AS PROJECT_ID FROM PROJECTS P WHERE P.USER_ID = $1') && values[0] === 'test_user') {
                return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
            }
            if (upperQuery.startsWith('SELECT ID, URL, SECRET FROM WEBHOOKS WHERE PROJECT_ID = $1 AND STATUS = $2 AND $3 = ANY(EVENTS)')) {
                // Mock webhook query
                return Promise.resolve({ rows: [{ id: 'webhook-1', url: 'https://example.com/webhook', secret: 'test-secret' }] });
            }
            if (upperQuery.startsWith('UPDATE WEBHOOKS SET LAST_FIRED_AT = NOW() WHERE ID = $1')) {
                return Promise.resolve({ rowCount: 1 });
            }
            return Promise.resolve({ rows: [] });
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should send webhook when validation event is logged', async () => {
        // Call logEvent directly
        await hooks.logEvent('test_project', 'validation', '/v1/validate/email', [], 200, { domain: 'example.com' }, mockPool as any);

        // Wait for async operations
        await new Promise(resolve => setImmediate(resolve));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const call = fetchMock.mock.calls[0];
        expect(call[0]).toBe('https://example.com/webhook');
        expect(call[1].method).toBe('POST');
        expect(call[1].headers['X-OrbiCheck-Signature']).toMatch(/^sha256=[a-f0-9]+$/);

        const payload = JSON.parse(call[1].body as string);
        expect(payload).toMatchObject({
            project_id: 'test_project',
            event: 'validation_result',
            endpoint: '/v1/validate/email',
            reason_codes: [],
            status: 200,
            domain: 'example.com'
        });
    });

    it('should not send webhook for unsupported event types', async () => {
        await hooks.logEvent('test_project', 'verification', '/v1/verify/phone', [], 200, {}, mockPool as any);

        await new Promise(resolve => setImmediate(resolve));

        expect(fetchMock).not.toHaveBeenCalled();
    });
});

function expectStatus(res: request.Response, expected: number): void {
    if (res.statusCode !== expected) {
        console.log('FAILED status:', res.statusCode);
        console.log('Response body:', res.body);
        console.log('Response headers:', res.headers);
    }
    expect(res.statusCode).toBe(expected);
}