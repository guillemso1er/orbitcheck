import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { createApp, mockPool, setupBeforeAll } from './testSetup';

describe('Dedupe Merge Endpoint', () => {
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

    it('should merge customer records successfully', async () => {
        // Mock pool to simulate merge
        mockPool.query.mockImplementation((query) => {
            if (query.includes('UPDATE customers')) {
                return Promise.resolve({ rows: [], rowCount: 2 });
            }
            return Promise.resolve({ rows: [] });
        });

        const res = await request(app.server)
            .post('/v1/dedupe/merge')
            .set('Authorization', 'Bearer valid_key')
            .send({
                type: 'customer',
                ids: ['uuid1', 'uuid2'],
                canonical_id: 'canonical-uuid'
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.merged_count).toBe(2);
        expect(res.body.canonical_id).toBe('canonical-uuid');
    });

    it('should merge address records successfully', async () => {
        // Mock pool for address merge
        mockPool.query.mockImplementation((query) => {
            if (query.includes('UPDATE addresses')) {
                return Promise.resolve({ rows: [], rowCount: 2 });
            }
            return Promise.resolve({ rows: [] });
        });

        const res = await request(app.server)
            .post('/v1/dedupe/merge')
            .set('Authorization', 'Bearer valid_key')
            .send({
                type: 'address',
                ids: ['uuid3', 'uuid4'],
                canonical_id: 'canonical-uuid-addr'
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.merged_count).toBe(2);
        expect(res.body.canonical_id).toBe('canonical-uuid-addr');
    });

    it('should return error for invalid IDs', async () => {
        mockPool.query.mockImplementation((query) => {
            if (query.includes('SELECT id FROM')) {
                return Promise.resolve({ rows: [{ id: 'valid' }] }); // Only one ID found
            }
            return Promise.resolve({ rows: [] });
        });

        const res = await request(app.server)
            .post('/v1/dedupe/merge')
            .set('Authorization', 'Bearer valid_key')
            .send({
                type: 'customer',
                ids: ['invalid-uuid'],
                canonical_id: 'invalid-canonical'
            });

        expect(res.statusCode).toBe(400);
        expect(res.body.error.code).toBe('invalid_ids');
    });
}