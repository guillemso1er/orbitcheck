import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import request from 'supertest';

import { mockPool, mockRedisInstance, mockSession, setupBeforeAll } from './testSetup.js';

describe('Normalize Routes', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        await setupBeforeAll();
        app = Fastify({ logger: false });

        // Add mock session to request
        app.decorateRequest('session', {
            getter() {
                return mockSession;
            },
            setter(value: any) {
                Object.assign(mockSession, value);
            }
        });

        app.addHook('preHandler', async (request_, _rep) => {
            if (request_.url.startsWith('/v1/normalize')) {
                const authHeader = request_.headers.authorization;
                if (authHeader === 'Bearer valid_key') {
                    (request_ as { project_id: string }).project_id = 'test_project';
                }
            }
        });

        // Register routes using the unified registerRoutes from web.ts
        const { registerRoutes } = await import('../web.js');
        registerRoutes(app, mockPool as any, mockRedisInstance as any);

        // Add input sanitization middleware to match production setup
        const { inputSanitizationHook } = await import('../middleware/inputSanitization.js');
        app.addHook('preValidation', inputSanitizationHook);

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
            if (upperQuery.includes('API_KEYS')) {
                return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
            }
            return Promise.resolve({ rows: [] });
        });
    });

    describe('POST /v1/normalize/address', () => {
        it('should normalize address successfully', async () => {
            const addressPayload = {
                address: {
                    line1: '123 Main Street',
                    line2: 'Apt 4B',
                    city: 'Anytown',
                    state: 'CA',
                    postal_code: '12345',
                    country: 'us'
                }
            };

            const response = await request(app.server)
                .post('/v1/normalize/address')
                .set('Authorization', 'Bearer valid_key')
                .send(addressPayload);

            expect(response.status).toBe(200);
            const body = response.body as { normalized: any; request_id: string };
            expect(body.normalized).toBeDefined();
            expect(body.normalized.line1).toBe('123 Main Street');
            expect(body.normalized.line2).toBe('Apt 4B');
            expect(body.normalized.city).toBe('Anytown');
            expect(body.normalized.state).toBe('CA');
            expect(body.normalized.postal_code).toBe('12345');
            expect(body.normalized.country).toBe('US'); // Should be uppercased
            expect(body.request_id).toBeDefined();
        });

        it('should handle address with missing optional fields', async () => {
            const minimalAddress = {
                address: {
                    line1: '123 Main St',
                    city: 'Anytown',
                    postal_code: '12345',
                    country: 'US'
                }
            };

            const response = await request(app.server)
                .post('/v1/normalize/address')
                .set('Authorization', 'Bearer valid_key')
                .send(minimalAddress);

            expect(response.status).toBe(200);
            const body = response.body as { normalized: any; request_id: string };
            expect(body.normalized.line1).toBe('123 Main St');
            expect(body.normalized.line2).toBe('');
            expect(body.normalized.city).toBe('Anytown');
            expect(body.normalized.state).toBe('');
            expect(body.normalized.postal_code).toBe('12345');
            expect(body.normalized.country).toBe('US');
        });

        it('should trim whitespace from all fields', async () => {
            const addressWithSpaces = {
                address: {
                    line1: '  123 Main St  ',
                    line2: '  Apt 4B  ',
                    city: '  Anytown  ',
                    state: '  CA  ',
                    postal_code: '  12345  ',
                    country: '  us  '
                }
            };

            const response = await request(app.server)
                .post('/v1/normalize/address')
                .set('Authorization', 'Bearer valid_key')
                .send(addressWithSpaces);

            if (response.status !== 200) {
                console.log('Response status:', response.status);
                console.log('Response body:', response.body);
                console.log('Request payload:', addressWithSpaces);
            }

            expect(response.status).toBe(200);
            const body = response.body as { normalized: any; request_id: string };
            expect(body.normalized.line1).toBe('123 Main St');
            expect(body.normalized.line2).toBe('Apt 4B');
            expect(body.normalized.city).toBe('Anytown');
            expect(body.normalized.state).toBe('CA');
            expect(body.normalized.postal_code).toBe('12345');
            expect(body.normalized.country).toBe('US');
        });
    });
});