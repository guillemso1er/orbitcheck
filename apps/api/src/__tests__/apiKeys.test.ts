// apps/api/src/__tests__/apiKeys.test.ts

import * as nodeCrypto from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

// Mock the JWT library
jest.mock('jsonwebtoken');

// Mock crypto before importing
jest.mock('node:crypto');

// Create typed mocks for JWT
const mockedJwtVerify = jwt.verify as jest.Mock;

describe('API Keys Routes (JWT Auth)', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        await setupBeforeAll();
        app = await createApp();

        app.addHook('preHandler', async (request_, reply) => {
            if (request_.url.startsWith('/v1/api-keys')) {
                try {
                    if (!request_.headers.authorization?.startsWith('Bearer ')) {
                        return await reply.status(401).send({ error: { code: 'missing_token', message: 'Authorization header is missing or invalid.' } });
                    }
                    const token = request_.headers.authorization.split(' ')[1];
                    const payload = mockedJwtVerify(token);
                    // FIX: Set both project_id AND user_id on the request
                    (request_ as { project_id: string; user_id: string }).project_id = 'test_project';
                    (request_ as { project_id: string; user_id: string }).user_id = payload.user_id || 'test_user';
                    return undefined;
                } catch {
                    return reply.status(401).send({ error: { code: 'invalid_token', message: 'The provided token is invalid.' } });
                }
            } else {
                return undefined
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

        // Mock crypto functions
        (nodeCrypto.randomBytes as jest.Mock).mockImplementation((size, callback) => {
            if (size === 32) {
                const hexString = '74657374' + '00'.repeat(28); // 'test....'
                const buffer = Buffer.from(hexString, 'hex');
                if (callback) {
                    callback(null, buffer);
                } else {
                    return buffer; // Support both callback and sync usage
                }
            } else if (size === 16) {
                const ivBuffer = Buffer.from('1234567890123456'); // 16 bytes for IV
                if (callback) {
                    callback(null, ivBuffer);
                } else {
                    return ivBuffer;
                }
            } else {
                const buffer = Buffer.alloc(size);
                if (callback) {
                    callback(null, buffer);
                } else {
                    return buffer;
                }
            }
        });

        (nodeCrypto.createHash as jest.Mock).mockImplementation(() => ({
            update: jest.fn().mockReturnThis(),
            digest: jest.fn().mockReturnValue('test_hash'),
        }));

        (nodeCrypto.createCipheriv as jest.Mock).mockImplementation(() => ({
            update: jest.fn().mockReturnValue('encrypted_'),
            final: jest.fn().mockReturnValue('final')
        }));

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
            if (upperQuery.includes('INSERT INTO PERSONAL_ACCESS_TOKENS')) {
                return Promise.resolve({ rows: [{ id: 'pat_id' }] });
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
            .get('/v1/api-keys')
            .set('Authorization', 'Bearer invalid_key');

        expect(response.status).toBe(401);
        const body = response.body as { error: { code: string } };
        expect(body.error.code).toBe('invalid_token');
    });

    it('should list API keys with valid JWT', async () => {
        const response = await request(app.server)
            .get('/v1/api-keys')
            .set('Authorization', 'Bearer valid_jwt_token');

        expect(response.status).toBe(200);
        const body = response.body as { data: { prefix: string }[] };
        expect(body.data.length).toBe(1);
        expect(body.data[0].prefix).toBe('ok_abcd');
    });

    it('should create a new API key with valid JWT', async () => {
        const response = await request(app.server)
            .post('/v1/api-keys')
            .set('Authorization', 'Bearer valid_jwt_token')
            .send({ name: 'New Test Key' });

        expect(response.status).toBe(201);
        const body = response.body as { prefix: string; full_key: string; status: string };
        expect(body.prefix).toBe('ok_746');
        expect(body.full_key.startsWith('ok_74657374')).toBe(true);
        expect(body.status).toBe('active');
    });
});