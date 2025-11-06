import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import request from 'supertest';

import { mockPool, mockRedisInstance, mockSession, setupBeforeAll } from './testSetup.js';

describe('Health Routes', () => {
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

        // Register health routes manually since they're not in createApp
        const { registerHealthRoutes } = await import('../routes/health.js');
        await registerHealthRoutes(app, mockPool as any, mockRedisInstance as any);

        await app.ready();
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /status', () => {
        it('should return healthy status', async () => {
            const response = await request(app.server)
                .get('/v1/status');

            expect(response.status).toBe(200);
            const body = response.body as { status: string; version: string; timestamp: string };
            expect(body.status).toBe('healthy');
            expect(body.version).toBeDefined();
            expect(body.timestamp).toBeDefined();
            expect(typeof body.timestamp).toBe('string');
        });
    });

    describe('GET /health', () => {
        it('should return health check response', async () => {
            const response = await request(app.server)
                .get('/health')
                .set('Authorization', 'Bearer valid_key');

            expect(response.status).toBe(200);
            const body = response.body as { status: string };
            expect(body.status).toBe('ok');
        });
    });

    describe('GET /ready', () => {
        it('should return readiness check when both database and redis are healthy', async () => {
            // Mock successful database and redis checks
            mockPool.query.mockResolvedValue({ rows: [{ result: 1 }] });
            mockRedisInstance.ping.mockResolvedValue('PONG');

            const response = await request(app.server)
                .get('/ready')
                .set('Authorization', 'Bearer valid_key');

            expect(response.status).toBe(200);
            const body = response.body as { ready: boolean; checks: { database: boolean; redis: boolean } };
            expect(body.ready).toBe(true);
            expect(body.checks.database).toBe(true);
            expect(body.checks.redis).toBe(true);
        });

        it('should return not ready when database fails', async () => {
            // Mock failed database check
            mockPool.query.mockRejectedValue(new Error('Database connection failed'));
            mockRedisInstance.ping.mockResolvedValue('PONG');

            const response = await request(app.server)
                .get('/ready');

            expect(response.status).toBe(200);
            const body = response.body as { ready: boolean; checks: { database: boolean; redis: boolean } };
            expect(body.ready).toBe(false);
            expect(body.checks.database).toBe(false);
            expect(body.checks.redis).toBe(true);
        });

        it('should return not ready when redis fails', async () => {
            // Mock successful database but failed redis check
            mockPool.query.mockResolvedValue({ rows: [{ result: 1 }] });
            mockRedisInstance.ping.mockRejectedValue(new Error('Redis connection failed'));

            const response = await request(app.server)
                .get('/ready');

            expect(response.status).toBe(200);
            const body = response.body as { ready: boolean; checks: { database: boolean; redis: boolean } };
            expect(body.ready).toBe(false);
            expect(body.checks.database).toBe(true);
            expect(body.checks.redis).toBe(false);
        });

        it('should return not ready when both database and redis fail', async () => {
            // Mock both failing
            mockPool.query.mockRejectedValue(new Error('Database connection failed'));
            mockRedisInstance.ping.mockRejectedValue(new Error('Redis connection failed'));

            const response = await request(app.server)
                .get('/ready');

            expect(response.status).toBe(200);
            const body = response.body as { ready: boolean; checks: { database: boolean; redis: boolean } };
            expect(body.ready).toBe(false);
            expect(body.checks.database).toBe(false);
            expect(body.checks.redis).toBe(false);
        });
    });
});