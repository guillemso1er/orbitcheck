import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'; // Import the type for safety
import request from 'supertest';

import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

describe('Rules Endpoints', () => {
    let app: FastifyInstance;

    // Create the Fastify app instance once before all tests in this suite run
    beforeAll(async () => {
        await setupBeforeAll(); // Set up global mocks and environment
        app = await createApp();  // Correctly await the async function

        app.addHook('preHandler', async (request_: FastifyRequest, _rep: FastifyReply) => {
            if (request_.url.startsWith('/v1/rules')) {
                const authHeader = request_.headers.authorization;
                if (authHeader === 'Bearer valid_key') {
                    (request_ as { project_id: string }).project_id = 'test_project';
                }
            }
        });

        await app.ready();      // Wait for all plugins to be loaded
        return;
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
            if (upperQuery.includes('SELECT * FROM RULES')) {
                return Promise.resolve({ rows: [] });
            }
            if (upperQuery.includes('INSERT INTO RULES')) {
                return Promise.resolve({ rows: [{ id: 'test_rule_id' }] });
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
            const response = await request(app.server)
                .post('/v1/rules/register')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    rules: [
                        {
                            name: 'Custom Rule',
                            description: 'Test custom rule',
                            logic: 'email.valid == true',
                            severity: 'medium',
                            enabled: true
                        }
                    ]
                });

            expect(response.status).toBe(201);
            const body = response.body as { registered_rules: string[]; message: string; request_id: string };
            expect(body.registered_rules).toHaveLength(1);
            expect(body.registered_rules[0]).toBe('test_rule_id');
            expect(body.message).toBe('Rules registered successfully');
            expect(body.request_id).toBeDefined();
        });

        it('should handle empty rules array', async () => {
            const response = await request(app.server)
                .post('/v1/rules/register')
                .set('Authorization', 'Bearer valid_key')
                .send({ rules: [] });

            expect(response.status).toBe(400);
            const body = response.body as { error: string; request_id: string };
            expect(body.error).toContain('Invalid rules array');
        });
    });
    describe('POST /v1/rules/test', () => {
        it('should test rules against payload and return results', async () => {
            const testPayload = {
                email: 'test@example.com',
                name: 'John Doe',
                address: {
                    line1: '123 Main St',
                    city: 'Anytown',
                    postal_code: '12345',
                    country: 'US'
                },
                phone: '+1-555-123-4567',
                tax_id: '123-45-6789'
            };

            const response = await request(app.server)
                .post('/v1/rules/test')
                .set('Authorization', 'Bearer valid_key')
                .send(testPayload);

            expect(response.status).toBe(200);
            const body = response.body as { results: any; request_id: string };
            expect(body.results).toBeDefined();
            expect(typeof body.results).toBe('object');
            expect(body.request_id).toBeDefined();
        });

        it('should handle empty payload', async () => {
            const response = await request(app.server)
                .post('/v1/rules/test')
                .set('Authorization', 'Bearer valid_key')
                .send({});

            expect(response.status).toBe(200);
            const body = response.body as { results: any; request_id: string };
            expect(body.results).toBeDefined();
            expect(typeof body.results).toBe('object');
        });

        it('should handle partial payload', async () => {
            const partialPayload = {
                email: 'test@example.com'
            };

            const response = await request(app.server)
                .post('/v1/rules/test')
                .set('Authorization', 'Bearer valid_key')
                .send(partialPayload);

            expect(response.status).toBe(200);
            const body = response.body as { results: any; request_id: string };
            expect(body.results).toBeDefined();
            expect(typeof body.results).toBe('object');
        });
    });

    describe('GET /v1/rules/error-codes', () => {
        it('should return error code catalog', async () => {
            const response = await request(app.server)
                .get('/v1/rules/error-codes')
                .set('Authorization', 'Bearer valid_key');

            expect(response.status).toBe(200);
            const body = response.body as { error_codes: any[]; request_id: string };
            expect(body.error_codes).toBeDefined();
            expect(Array.isArray(body.error_codes)).toBe(true);
            expect(body.request_id).toBeDefined();
        });
    });
});