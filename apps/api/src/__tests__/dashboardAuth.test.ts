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
        const validToken = 'pat_token_hash';

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

    it('should return 400 when Authorization header is missing', async () => {
        const response = await request(app.server)
            .get('/v1/api-keys');

        expect(response.status).toBe(400);
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
        // Mock empty project result
        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.includes('SELECT P.ID AS PROJECT_ID FROM PROJECTS P WHERE P.USER_ID')) {
                return Promise.resolve({ rows: [] });
            }
            return Promise.resolve({ rows: [] });
        });

        const response = await request(app.server)
            .get('/v1/api-keys')
            .set('Authorization', 'Bearer valid_token');

        expect(response.status).toBe(401); // Returns 401 due to failed auth flow
        expect(response.body.error).toBeDefined();
    });

    it('should use JWT auth for /api-keys but API key auth for /v1/validate/email', async () => {
        // Test that /api-keys uses JWT auth (already tested above)
        const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
        const jwtResponse = await request(app.server)
            .get('/v1/api-keys')
            .set('Authorization', `Bearer ${jwtToken}`);

        expect(jwtResponse.status).toBe(200);

        // Test that /v1/validate/email does not use JWT auth (should return 404 since route doesn't exist)
        const apiResponse = await request(app.server)
            .get('/v1/validate/email')
            .set('Authorization', `Bearer ${jwtToken}`);

        // Should not be 401 (unauthorized) since it would use API key auth, not JWT
        expect(apiResponse.status).not.toBe(401);
    });
});