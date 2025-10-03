// Import the mocked jwt module directly
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
// Import the mocked fetch directly
import fetch from 'node-fetch';
import request from 'supertest';

import * as hooks from '../hooks';
import { createApp, mockPool, setupBeforeAll } from './testSetup';

// --- Tell Jest to mock the modules ---
jest.mock('node-fetch');
jest.mock('jsonwebtoken'); // <-- This is correct
// ------------------------------------

// Cast mocks to their types once for convenience
const fetchMock = fetch as unknown as jest.Mock;
const mockedJwtVerify = jwt.verify as jest.Mock;
const MOCK_TOKEN = 'mock_jwt_token';

describe('Webhook Test Routes (JWT Auth)', () => {
    let app: FastifyInstance;

    // Create the app once for all tests in this suite
    beforeAll(async () => {
        await setupBeforeAll();
        app = await createApp();
        // The problematic app.addHook('preHandler', ...) has been removed.
        await app.ready();
    });

    // Close the app once after all tests are done
    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    // Before each test, reset all mocks to a clean default state
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

        // Spy on the logEvent function.
        jest.spyOn(hooks, 'logEvent').mockImplementation(jest.fn().mockResolvedValue(undefined));

        // Define default behavior for the mocked jwt.verify function.
        mockedJwtVerify.mockImplementation(() => ({ user_id: 'test_user', project_id: 'test_project' }));

        // --- CORRECTED DATABASE MOCK ---
        // This mock is now robust and handles the specific queries from verifyJWT.
        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();

            // Handle the user lookup from verifyJWT
            if (upperQuery.startsWith('SELECT ID FROM USERS')) {
                return Promise.resolve({ rows: [{ id: 'test_user' }] });
            }

            // Handle the project lookup from verifyJWT
            if (upperQuery.startsWith('SELECT P.ID AS PROJECT_ID FROM PROJECTS')) {
                return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
            }

            // A default for any other queries if needed
            return Promise.resolve({ rows: [] });
        });
    });

    // After each test, restore any spies to their original implementations
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should successfully test a webhook with validation payload', async () => {
        const res = await request(app.server)
            .post('/webhooks/test')
            .set('Authorization', `Bearer ${MOCK_TOKEN}`) // <-- CHANGE HERE
            .send({
                url: 'https://example.com/webhook',
                payload_type: 'validation'
            });

        expect(res.statusCode).toBe(200);
        expect(fetchMock).toHaveBeenCalledWith('https://example.com/webhook', expect.any(Object));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
            event: 'validation_result',
            type: 'email'
        });
        expect(res.body.sent_to).toBe('https://example.com/webhook');
        expect(hooks.logEvent).toHaveBeenCalledWith('test_project', 'webhook_test', '/webhooks/test', expect.any(Object), 200, expect.any(Object), expect.any(Object));
    });

    it('should handle custom payload successfully', async () => {
        const res = await request(app.server)
            .post('/webhooks/test')
            .set('Authorization', `Bearer ${MOCK_TOKEN}`) // <-- CHANGE HERE
            .send({
                url: 'https://example.com/webhook',
                payload_type: 'custom',
                custom_payload: { event: 'custom_event', data: 'test' }
            });

        expect(res.statusCode).toBe(200);
        const call = fetchMock.mock.calls[0][1];
        expect(JSON.parse(call.body)).toMatchObject({
            event: 'custom_event',
            data: 'test',
            project_id: 'test_project'
        });
        expect(res.body.payload.event).toBe('custom_event');
        expect(hooks.logEvent).toHaveBeenCalled();
    });

    it('should reject invalid URL', async () => {
        const res = await request(app.server)
            .post('/webhooks/test')
            .set('Authorization', `Bearer ${MOCK_TOKEN}`) // <-- CHANGE HERE
            .send({
                url: 'ftp://example.com',
                payload_type: 'validation'
            });

        expect(res.statusCode).toBe(400);
        expect(res.body.error.code).toBe('invalid_url');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(hooks.logEvent).not.toHaveBeenCalled();
    });

    it('should reject missing custom payload for custom type', async () => {
        const res = await request(app.server)
            .post('/webhooks/test')
            .set('Authorization', `Bearer ${MOCK_TOKEN}`) // <-- CHANGE HERE
            .send({
                url: 'https://example.com/webhook',
                payload_type: 'custom'
            });

        expect(res.statusCode).toBe(400);
        expect(res.body.error.code).toBe('missing_payload');
    });

    it('should handle fetch error', async () => {
        // Override the default successful mock with a failure for this specific test
        fetchMock.mockRejectedValue(new Error('Network error'));

        const res = await request(app.server)
            .post('/webhooks/test')
            .set('Authorization', `Bearer ${MOCK_TOKEN}`) // <-- CHANGE HERE
            .send({
                url: 'https://example.com/webhook',
                payload_type: 'validation'
            });

        expect(res.statusCode).toBe(500);
        expect(res.body.error.code).toBe('send_failed');
        expect(hooks.logEvent).toHaveBeenCalled();
    });

    it('should reject without a valid JWT', async () => {
        // Override the default successful JWT mock with a failure for this test
        mockedJwtVerify.mockImplementation(() => {
            throw new Error('Invalid token');
        });

        const res = await request(app.server)
            .post('/webhooks/test')
            .set('Authorization', 'Bearer invalid_key')
            .send({
                url: 'https://example.com/webhook',
                payload_type: 'validation'
            });

        expect(res.statusCode).toBe(401);
        expect(res.body.error.code).toBe('invalid_token');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});