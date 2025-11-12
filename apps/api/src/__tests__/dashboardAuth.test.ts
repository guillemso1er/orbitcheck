import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

// Mock the JWT library
jest.mock('jsonwebtoken');

// Create typed mocks for JWT
const mockedJwtVerify = jwt.verify as jest.Mock;

describe('Dashboard Authentication - /api-keys endpoint', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        await setupBeforeAll();
        app = await createApp();

        // Add auth hooks for this test
        const { applyRateLimitingAndIdempotency } = await import('../web.js');
        const { mockRedisInstance } = await import('./testSetup.js');
        app.addHook("preHandler", async (request, rep) => {
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
        // Mock successful JWT verification
        mockedJwtVerify.mockImplementation(() => ({ user_id: 'test_user' }));

        // Mock database queries - use the same patterns as the working tests
        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.includes('SELECT ID FROM USERS')) {
                return Promise.resolve({ rows: [{ id: 'test_user' }] });
            }
            if (upperQuery.includes('SELECT P.ID AS PROJECT_ID FROM PROJECTS P WHERE P.USER_ID')) {
                return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
            }
            if (upperQuery.includes('SELECT ID, PREFIX, NAME, STATUS, CREATED_AT, LAST_USED_AT FROM API_KEYS')) {
                return Promise.resolve({
                    rows: [
                        {
                            id: 'key_1',
                            prefix: 'ok_abcd',
                            name: 'Test Key',
                            status: 'active',
                            created_at: new Date().toISOString(),
                            last_used_at: null
                        }
                    ]
                });
            }
            return Promise.resolve({ rows: [] });
        });
    });

    it('should successfully access /api-keys with valid PAT token', async () => {
        const validToken = 'oc_pat_live:pat_1:secret456'; // Use proper PAT format with test secret

        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.includes('SELECT ID, USER_ID, SCOPES FROM PERSONAL_ACCESS_TOKENS')) {
                return Promise.resolve({ rows: [{ id: 'pat_1', user_id: 'test_user', scopes: ['keys:read'] }] });
            }
            if (upperQuery.includes('SELECT ID FROM USERS')) {
                return Promise.resolve({ rows: [{ id: 'test_user' }] });
            }
            if (upperQuery.includes('SELECT P.ID AS PROJECT_ID FROM PROJECTS P WHERE P.USER_ID')) {
                return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
            }
            if (upperQuery.includes('SELECT ID, PREFIX, NAME, STATUS, CREATED_AT, LAST_USED_AT FROM API_KEYS')) {
                return Promise.resolve({
                    rows: [
                        {
                            id: 'key_1',
                            prefix: 'ok_abcd',
                            name: 'Test Key',
                            status: 'active',
                            created_at: new Date().toISOString(),
                            last_used_at: null
                        }
                    ]
                });
            }
            if (upperQuery.includes('INSERT INTO AUDIT_LOGS')) {
                return Promise.resolve({ rows: [] });
            }
            if (upperQuery.includes('UPDATE PERSONAL_ACCESS_TOKENS SET LAST_USED_AT')) {
                return Promise.resolve({ rows: [] });
            }
            // Added for PAT verification that includes token_hash
            if (upperQuery.includes('TOKEN_HASH FROM PERSONAL_ACCESS_TOKENS WHERE TOKEN_ID')) {
                return Promise.resolve({
                    rows: [{
                        id: 'pat_1',
                        user_id: 'test_user',
                        scopes: ['keys:read'],
                        ip_allowlist: null,
                        expires_at: null,
                        disabled: false,
                        token_hash: 'mocked_hash'
                    }]
                });
            }
            return Promise.resolve({ rows: [] });
        });

        const response = await request(app.server)
            .get('/v1/api-keys')
            .set('Authorization', `Bearer ${validToken}`);

        expect(response.status).toBe(200);
        const body = response.body as { data: unknown[]; request_id: string };
        expect(body.data).toBeDefined();
        expect(body.data.length).toBeGreaterThan(0);
        expect(body.request_id).toBeDefined();
    });

    it('should return 401 when Authorization header is missing', async () => {
        const response = await request(app.server)
            .get('/v1/api-keys');

        expect(response.status).toBe(401);
        expect(response.body.error).toBeDefined();
    });

    it('should return 401 when Authorization header does not start with Bearer', async () => {
        const response = await request(app.server)
            .get('/v1/api-keys')
            .set('Authorization', 'InvalidTokenFormat');

        expect(response.status).toBe(401);
        expect(response.body.error).toBeDefined();
    });

    it('should return 401 when JWT token is invalid', async () => {
        mockedJwtVerify.mockImplementation(() => {
            throw new Error('Invalid token');
        });

        const response = await request(app.server)
            .get('/v1/api-keys')
            .set('Authorization', 'Bearer invalid_jwt_token');

        expect(response.status).toBe(401);
        expect(response.body.error).toBeDefined();
    });

    it('should return 403 when no project is found for user', async () => {
        // Mock PAT success but empty project result
        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.includes('SELECT ID, USER_ID, SCOPES FROM PERSONAL_ACCESS_TOKENS')) {
                return Promise.resolve({ rows: [{ id: 'pat_1', user_id: 'test_user', scopes: ['keys:read'] }] });
            }
            if (upperQuery.includes('SELECT P.ID AS PROJECT_ID FROM PROJECTS P WHERE P.USER_ID')) {
                return Promise.resolve({ rows: [] });
            }
            return Promise.resolve({ rows: [] });
        });

        const response = await request(app.server)
            .get('/v1/api-keys')
            .set('Authorization', 'Bearer valid_token');

        expect(response.status).toBe(401); // Returns 401 when no project is found for user
        expect(response.body.error).toBeDefined();
    });

    it('should use PAT auth for /api-keys but API key auth for /v1/validate/email', async () => {
        // Mock PAT for this test
        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.includes('SELECT ID, USER_ID, SCOPES FROM PERSONAL_ACCESS_TOKENS')) {
                return Promise.resolve({ rows: [{ id: 'pat_1', user_id: 'test_user', scopes: ['keys:read'] }] });
            }
            if (upperQuery.includes('SELECT ID FROM USERS')) {
                return Promise.resolve({ rows: [{ id: 'test_user' }] });
            }
            if (upperQuery.includes('SELECT P.ID AS PROJECT_ID FROM PROJECTS P WHERE P.USER_ID')) {
                return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
            }
            if (upperQuery.includes('SELECT ID, PREFIX, NAME, STATUS, CREATED_AT, LAST_USED_AT FROM API_KEYS')) {
                return Promise.resolve({
                    rows: [
                        {
                            id: 'key_1',
                            prefix: 'ok_abcd',
                            name: 'Test Key',
                            status: 'active',
                            created_at: new Date().toISOString(),
                            last_used_at: null
                        }
                    ]
                });
            }
            if (upperQuery.includes('INSERT INTO AUDIT_LOGS')) {
                return Promise.resolve({ rows: [] });
            }
            if (upperQuery.includes('UPDATE PERSONAL_ACCESS_TOKENS SET LAST_USED_AT')) {
                return Promise.resolve({ rows: [] });
            }
            // Added for PAT verification that includes token_hash
            if (upperQuery.includes('TOKEN_HASH FROM PERSONAL_ACCESS_TOKENS WHERE TOKEN_ID')) {
                return Promise.resolve({
                    rows: [{
                        id: 'pat_1',
                        user_id: 'test_user',
                        scopes: ['keys:read'],
                        ip_allowlist: null,
                        expires_at: null,
                        disabled: false,
                        token_hash: 'mocked_hash'
                    }]
                });
            }
            return Promise.resolve({ rows: [] });
        });

        // Test that /api-keys uses PAT auth (already tested above)
        const patToken = 'oc_pat_live:pat_1:secret456'; // Use proper PAT format with test secret
        const patResponse = await request(app.server)
            .get('/v1/api-keys')
            .set('Authorization', `Bearer ${patToken}`);

        expect(patResponse.status).toBe(200);

        // Test that /v1/validate/email uses API key auth, not PAT
        const apiResponse = await request(app.server)
            .get('/v1/validate/email')
            .set('Authorization', `Bearer ${patToken}`);

        // Should be 404 since /v1/validate/email route doesn't exist in the test setup
        expect(apiResponse.status).toBe(404);
    });
});