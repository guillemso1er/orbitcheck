import request from 'supertest';
import { createApp, mockPool, setupBeforeAll } from './testSetup';
// Import the mocked module directly. It's already a mock.
import * as crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

describe('API Keys Routes (JWT Auth)', () => {
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

        // The 'verify' function is ALREADY a mock. We just need to define its behavior.
        // We cast it to jest.Mock to get TypeScript autocompletion and type safety.
        (jwt.verify as jest.Mock).mockImplementation(() => ({ user_id: 'test_user' }));

        // Default mock for database queries to succeed
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
            if (upperQuery.includes('API_KEYS')) {
                return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
            }
            return Promise.resolve({ rows: [] });
        });
    });

    it('should list API keys with valid JWT', async () => {
        const res = await request(app.server)
            .get('/api-keys')
            .set('Authorization', 'Bearer valid_jwt_token');

        expect(res.statusCode).toBe(200);
        expect(res.body.data.length).toBe(1);
        expect(res.body.data[0].prefix).toBe('ok_abcd');
    });

    it('should reject API keys list with an invalid JWT', async () => {
        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();

            if (upperQuery.includes('SELECT ID FROM USERS')) {
                return Promise.resolve({ rows: [] });
            }
            if (upperQuery.includes('SELECT P\\.ID AS PROJECT_ID FROM PROJECTS')) {
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
            if (upperQuery.includes('API_KEYS')) {
                return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
            }
            return Promise.resolve({ rows: [] });
        });

        const res = await request(app.server)
            .get('/api-keys')
            .set('Authorization', 'Bearer invalid_jwt_token');

        expect(res.statusCode).toBe(401);
        expect(res.body.error.code).toBe('invalid_token');
    });

    it('should create a new API key with valid JWT', async () => {
        // Mock crypto for deterministic key generation
        const hexString = '74657374' + '00'.repeat(28); // 'test' in hex + padding for 64 hex chars
        const buffer = Buffer.from(hexString, 'hex');
        (crypto.randomBytes as jest.Mock).mockReturnValue(buffer);

        const mockHash = {
            update: jest.fn().mockReturnThis(),
            digest: jest.fn().mockReturnValue('test_hash'),
        };
        (crypto.createHash as jest.Mock).mockReturnValue(mockHash as any);

        const res = await request(app.server)
            .post('/api-keys')
            .set('Authorization', 'Bearer valid_jwt_token')
            .send({ name: 'New Test Key' });

        expect(res.statusCode).toBe(201);
        expect(res.body.prefix).toBe('ok_746');
        expect(res.body.full_key.startsWith('ok_746')).toBe(true);
        expect(res.body.status).toBe('active');
    });
});