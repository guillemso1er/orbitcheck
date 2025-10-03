import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'; // Import the type for safety
import request from 'supertest';

import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

describe('Rules Endpoints', () => {
    let app: FastifyInstance;

    // Create the Fastify app instance once before all tests in this suite run
    beforeAll(async () => {
        await setupBeforeAll(); // Set up global mocks and environment
        app = await createApp();  // Correctly await the async function

        app.addHook('preHandler', async (request_: FastifyRequest, rep: FastifyReply) => {
            if (request_.url.startsWith('/v1/rules')) {
                const authHeader = request_.headers.authorization;
                if (authHeader === 'Bearer valid_key') {
                    (request_ as any).project_id = 'test_project';
                }
            }
        });

        await app.ready();      // Wait for all plugins to be loaded
    });

    // Close the app instance once after all tests are finished
    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    // Before each test, clear mocks to ensure a clean slate
    beforeEach(() => {
        jest.clearAllMocks();

        // Although these endpoints are mostly static, they likely still pass through
        // an authentication hook. We need to mock the API key check to succeed.
        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.includes('API_KEYS')) {
                return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
            }
            return Promise.resolve({ rows: [] });
        });
    });

    describe('GET /v1/rules', () => {
        it('should return a list of rules', async () => {
            const response = await request(app.server)
                .get('/v1/rules')
                .set('Authorization', 'Bearer valid_key');

            expect(response.status).toBe(200);
            const body = response.body as { rules: { id: string }[] };
            expect(body.rules.length).toBeGreaterThan(0);
            expect(body.rules[0].id).toBe('email_format');
        });
    });

    describe('GET /v1/rules/catalog', () => {
        it('should return the reason code catalog', async () => {
            const response = await request(app.server)
                .get('/v1/rules/catalog')
                .set('Authorization', 'Bearer valid_key');

            expect(response.status).toBe(200);
            const body = response.body as { reason_codes: { code: string; severity: string }[] };
            expect(body.reason_codes.length).toBeGreaterThan(0);
            expect(body.reason_codes[0].code).toBe('address.po_box');
            expect(body.reason_codes[0].severity).toBe('high');
        });
    });

    describe('POST /v1/rules/register', () => {
        it('should register custom rules successfully', async () => {
            const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => { });

            const response = await request(app.server)
                .post('/v1/rules/register')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    rules: [
                        {
                            id: 'custom_rule_1',
                            name: 'Custom Rule',
                            description: 'Test custom rule',
                            reason_code: 'custom.invalid',
                            severity: 'medium',
                            enabled: true
                        }
                    ]
                });

            expect(response.status).toBe(200);
            const body = response.body as { registered_rules: string[]; message: string };
            expect(mockConsoleLog).toHaveBeenCalledWith(
                expect.stringContaining('Rules registered for project test_project:'),
                expect.any(Array)
            );
            expect(body.registered_rules).toEqual(['custom_rule_1']);
            expect(body.message).toBe('Rules registered successfully');

            mockConsoleLog.mockRestore();
        });

        it('should handle empty rules array', async () => {
            const response = await request(app.server)
                .post('/v1/rules/register')
                .set('Authorization', 'Bearer valid_key')
                .send({ rules: [] });

            expect(response.status).toBe(200);
            const body = response.body as { registered_rules: string[] };
            expect(body.registered_rules).toEqual([]);
        });
    });
});