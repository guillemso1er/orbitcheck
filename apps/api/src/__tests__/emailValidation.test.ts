import { FastifyInstance } from 'fastify'; // Import the type for safety
import request from 'supertest';
import { createApp, hapi, mockDns, mockPool, mockRedisInstance, mockValidateEmail, setupBeforeAll } from './testSetup';

describe('Email Validation Endpoints', () => {
    let app: FastifyInstance;

    // Create the app instance once before any tests in this suite run
    beforeAll(async () => {
        await setupBeforeAll(); // Set up all global mocks
        app = await createApp();  // Await the async function
        await app.ready();      // Wait for the app to be ready
    });

    // Close the app instance once after all tests in this suite are finished
    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    // Before each test, clear mocks and set up a default "valid email" state
    beforeEach(() => {
        jest.clearAllMocks();

        // Default to a successful validation response, which tests can override
        mockValidateEmail.mockResolvedValue({
            valid: true,
            normalized: 'test@example.com',
            disposable: false,
            mx_found: true,
            reason_codes: [],
        });

        // Default mock implementations for API key auth and logging
        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.includes('API_KEYS')) {
                return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
            }
            if (upperQuery.startsWith('INSERT INTO LOGS')) {
                return Promise.resolve({ rows: [], rowCount: 1 });
            }
            return Promise.resolve({ rows: [] });
        });

        // Reset other specific mocks to their default success states
        mockRedisInstance.sismember.mockResolvedValue(0);
        hapi.isEmailValid.mockReturnValue(true);
        mockDns.resolveMx.mockResolvedValue([{ exchange: 'mx.example.com' }]);
    });

    describe('POST /v1/validate/email', () => {
        it('should validate a valid email using default success mocks', async () => {
            // This test relies entirely on the default setup in beforeEach
            const res = await request(app.server)
                .post('/v1/validate/email')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'test@example.com' });

            expect(res.statusCode).toBe(200);
            expect(res.body.valid).toBe(true);
            expect(res.body.disposable).toBe(false);
            expect(res.body.mx_found).toBe(true);
        });

        it('should reject disposable email when Redis finds a match', async () => {
            // Override Redis mock to simulate finding a disposable domain
            mockRedisInstance.sismember.mockImplementation((setName: string, domain: string) =>
                Promise.resolve(domain === 'disposable.com' ? 1 : 0)
            );

            // Also override the main validator mock to return a disposable result
            mockValidateEmail.mockResolvedValue({
                valid: false,
                normalized: 'test@disposable.com',
                disposable: true,
                mx_found: true,
                reason_codes: ['email.disposable_domain'],
            });

            const res = await request(app.server)
                .post('/v1/validate/email')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'test@disposable.com' });

            expect(res.statusCode).toBe(200);
            expect(res.body.valid).toBe(false);
            expect(res.body.disposable).toBe(true);
            expect(res.body.reason_codes).toContain('email.disposable_domain');
        });

        it('should handle invalid format when validator returns false', async () => {
            // Override the format checker mock to return false
            hapi.isEmailValid.mockReturnValue(false);

            // Also override the main validator mock to return an invalid format result
            mockValidateEmail.mockResolvedValue({
                valid: false,
                normalized: 'invalid-email',
                disposable: false,
                mx_found: false,
                reason_codes: ['email.invalid_format'],
            });

            const res = await request(app.server)
                .post('/v1/validate/email')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'invalid-email' });

            expect(res.statusCode).toBe(200);
            expect(res.body.valid).toBe(false);
            expect(res.body.reason_codes).toContain('email.invalid_format');
        });
    });
});