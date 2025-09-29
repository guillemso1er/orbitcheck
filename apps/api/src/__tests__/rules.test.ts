import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'; // Import the type for safety
import request from 'supertest';
import { createApp, mockPool, setupBeforeAll } from './testSetup';

describe('Rules Endpoints', () => {
    let app: FastifyInstance;

    // Create the Fastify app instance once before all tests in this suite run
    beforeAll(async () => {
        await setupBeforeAll(); // Set up global mocks and environment
        app = await createApp();  // Correctly await the async function

        app.addHook('preHandler', async (req: FastifyRequest, rep: FastifyReply) => {
          if (req.url.startsWith('/v1/rules')) {
            const authHeader = req.headers.authorization;
            if (authHeader === 'Bearer valid_key') {
              (req as any).project_id = 'test_project';
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
            const res = await request(app.server)
                .get('/v1/rules')
                .set('Authorization', 'Bearer valid_key');

            expect(res.statusCode).toBe(200);
            expect(res.body.rules.length).toBeGreaterThan(0);
            expect(res.body.rules[0].id).toBe('email_format');
        });
    });

    describe('GET /v1/rules/catalog', () => {
        it('should return the reason code catalog', async () => {
            const res = await request(app.server)
                .get('/v1/rules/catalog')
                .set('Authorization', 'Bearer valid_key');

            expect(res.statusCode).toBe(200);
            expect(res.body.reason_codes.length).toBeGreaterThan(0);
            expect(res.body.reason_codes[0].code).toBe('email.invalid_format');
            expect(res.body.reason_codes[0].severity).toBe('low');
        });
    });

    describe('POST /v1/rules/register', () => {
        it('should register custom rules successfully', async () => {
            const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => { });

            const res = await request(app.server)
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

            expect(res.statusCode).toBe(200);
            expect(mockConsoleLog).toHaveBeenCalledWith(
              expect.stringContaining('Rules registered for project test_project:'),
              expect.any(Array)
            );
            expect(res.body.registered_rules).toEqual(['custom_rule_1']);
            expect(res.body.message).toBe('Rules registered successfully');

            mockConsoleLog.mockRestore();
        });

        it('should handle empty rules array', async () => {
            const res = await request(app.server)
                .post('/v1/rules/register')
                .set('Authorization', 'Bearer valid_key')
                .send({ rules: [] });

            expect(res.statusCode).toBe(200);
            expect(res.body.registered_rules).toEqual([]);
        });
    });
});