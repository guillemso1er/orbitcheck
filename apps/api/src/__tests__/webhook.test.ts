// const jwtModule = require('jsonwebtoken');
// console.log('[debug] is jwt.verify mocked at test level?', typeof jwtModule.verify, 'isMock=', !!jwtModule.verify._isMockFunction);
// if (jwtModule.default) {
//   console.log('[debug] is jwt.default.verify mocked?', typeof jwtModule.default.verify, 'isMock=', !!jwtModule.default.verify?._isMockFunction);
// }

import type { FastifyInstance } from 'fastify';
import fetch from 'node-fetch';
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
        verifyPAT: jest.fn(async (request_: unknown) => {
            // Default: succeed and set ids
            request_.user_id = 'test_user';
            request_.project_id = 'test_project';
        }),
    };
});

// Cast the fetch mock for convenience
const fetchMock = fetch as unknown as jest.Mock;

const MOCK_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdF91c2VyIn0.ignore';

describe('Webhook Test Routes (JWT Auth)', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        await setupBeforeAll();
        app = await createApp();
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

function expectStatus(res: request.Response, expected: number) : void {
    if (res.statusCode !== expected) {
        console.log('FAILED status:', res.statusCode);
        console.log('Response body:', res.body);
        console.log('Response headers:', res.headers);
    }
    expect(res.statusCode).toBe(expected);
}