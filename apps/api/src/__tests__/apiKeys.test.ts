import * as crypto from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

// Mock the JWT library (the crypto mock is now handled globally)
jest.mock('jsonwebtoken');

// Create typed mocks for JWT and crypto
const mockedJwtVerify = jwt.verify as jest.Mock;
const mockedRandomBytes = crypto.randomBytes as jest.Mock;
const mockedCreateHash = crypto.createHash as jest.Mock;

describe('API Keys Routes (JWT Auth)', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        await setupBeforeAll();
        app = await createApp();

        app.addHook('preHandler', async (request_, reply) => {
            if (request_.url.startsWith('/api/keys')) {
                try {
                    if (!request_.headers.authorization?.startsWith('Bearer ')) {
                        return reply.status(401).send({ error: { code: 'missing_token', message: 'Authorization header is missing or invalid.' } });
                    }
                    const token = request_.headers.authorization.split(' ')[1];
                    mockedJwtVerify(token);
                    (request_ as any).project_id = 'test_project';
                    return;
                } catch {
                    return reply.status(401).send({ error: { code: 'invalid_token', message: 'The provided token is invalid.' } });
                }
            } else {
                return
            }
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
        mockedJwtVerify.mockImplementation(() => ({ user_id: 'test_user' }));
        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.includes('SELECT ID FROM USERS')) {
                return Promise.resolve({ rows: [{ id: 'test_user' }] });
            }
            if (upperQuery.includes('SELECT P.ID AS PROJECT_ID FROM PROJECTS P WHERE P.USER_ID')) {
                return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
            }
            if (upperQuery.includes('SELECT ID, PREFIX, NAME, STATUS, CREATED_AT, LAST_USED_AT FROM API_KEYS')) {
                return Promise.resolve({ rows: [{ id: 'key_1', prefix: 'ok_abcd', name: 'Test Key', status: 'active', created_at: new Date().toISOString(), last_used_at: null }] });
            }
            if (upperQuery.includes('INSERT INTO API_KEYS')) {
                return Promise.resolve({ rows: [{ id: 'new_key_id', created_at: new Date().toISOString() }] });
            }
            if (upperQuery.includes('UPDATE API_KEYS SET STATUS')) {
                return Promise.resolve({ rowCount: 1 });
            }
            return Promise.resolve({ rows: [] });
        });
    });


    it('should reject API keys list with an invalid JWT', async () => {
        mockedJwtVerify.mockImplementation(() => {
            throw new Error('Invalid token');
        });

        const response = await request(app.server)
            .get('/api/keys')
            .set('Authorization', 'Bearer invalid_key');

        expect(response.status).toBe(401);
        const body = response.body as { error: { code: string } };
        expect(body.error.code).toBe('invalid_token');
    });


    it('should list API keys with valid JWT', async () => {
        const response = await request(app.server)
            .get('/api/keys')
            .set('Authorization', 'Bearer valid_jwt_token');

        expect(response.status).toBe(200);
        const body = response.body as { data: { prefix: string }[] };
        expect(body.data.length).toBe(1);
        expect(body.data[0].prefix).toBe('ok_abcd');
    });


    it('should create a new API key with valid JWT', async () => {
        // --- THE FIX IS HERE ---
        // Dynamically require the mocked module *inside the test* to get the mocked version.
        const crypto = await import('node:crypto');
        const mockedRandomBytes = crypto.randomBytes as jest.Mock;
        const mockedCreateHash = crypto.createHash as jest.Mock;

        const hexString = '74657374' + '00'.repeat(28); // 'test....'
        const buffer = Buffer.from(hexString, 'hex');

        // This will now work correctly because mockedRandomBytes is a guaranteed mock function.
        mockedRandomBytes.mockImplementation((size: number, callback: (err: Error | null, buf: Buffer) => void) => {
            callback(null, buffer);
        });

        const mockHash = {
            update: jest.fn().mockReturnThis(),
            digest: jest.fn().mockReturnValue('test_hash'),
        };
        mockedCreateHash.mockReturnValue(mockHash);

        const response = await request(app.server)
            .post('/api/keys')
            .set('Authorization', 'Bearer valid_jwt_token')
            .send({ name: 'New Test Key' });

        expect(response.status).toBe(201);
        const body = response.body as { prefix: string; full_key: string; status: string };
        expect(body.prefix).toBe('ok_746');
        expect(body.full_key.startsWith('ok_74657374')).toBe(true);
        expect(body.status).toBe('active');
    });
});