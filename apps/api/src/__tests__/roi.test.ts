import type { FastifyInstance } from 'fastify';
import request from 'supertest';

import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

describe('ROI Estimate Endpoint', () => {
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
        // Mock API key validation
        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.includes('API_KEYS')) {
                return Promise.resolve({
                    rows: [{ id: 'test-api-key-id', name: 'test-key', project_id: 'test-project-id' }]
                });
            }
            if (upperQuery.includes('LOGS')) {
                return Promise.resolve({ rows: [] });
            }
            return Promise.resolve({ rows: [] });
        });
    });

    it('returns ROI estimate for 1000 orders with defaults', async () => {
        const response = await request(app.server)
            .post('/v1/roi/estimate')
            .set('X-API-Key', 'ok_test_123')
            .send({ orders_per_month: 1000 });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('inputs');
        expect(response.body).toHaveProperty('estimates');
        expect(response.body).toHaveProperty('meta');

        expect(response.body.inputs.orders_per_month).toBe(1000);
        expect(response.body.inputs.issue_rate).toBe(0.021);
        expect(response.body.inputs.carrier_fee_share).toBe(0.5);
        expect(response.body.inputs.avg_correction_fee).toBe(23.75);
        expect(response.body.inputs.reship_share).toBe(0.1);
        expect(response.body.inputs.reship_cost).toBe(10);
        expect(response.body.inputs.prevention_rate).toBe(0.5);
        expect(response.body.inputs.currency).toBe('USD');

        expect(response.body.estimates.issues_per_month).toBe(21);
        expect(response.body.estimates.loss_per_issue).toBe(12.88); // 0.5 * 23.75 + 0.1 * 10 = 11.875 + 1 = 12.875, rounded to 12.88
        expect(response.body.estimates.baseline_loss_per_month).toBe(270.38); // 21 * 12.875
        expect(response.body.estimates.savings_per_month).toBe(135.19); // 270.375 * 0.5

        expect(response.body.meta.model_version).toBe('roi-v1');
        expect(response.body.meta.request_id).toBeDefined();
    });

    it('accepts custom parameters', async () => {
        const response = await request(app.server)
            .post('/v1/roi/estimate')
            .set('X-API-Key', 'ok_test_123')
            .send({
                orders_per_month: 5000,
                issue_rate: 0.03,
                currency: 'EUR'
            });

        expect(response.status).toBe(200);
        expect(response.body.inputs.orders_per_month).toBe(5000);
        expect(response.body.inputs.issue_rate).toBe(0.03);
        expect(response.body.inputs.currency).toBe('EUR');
        expect(response.body.estimates.savings_per_month).toBeGreaterThan(135.19); // Should be higher with more orders and higher issue rate
    });

    it('returns 400 for missing orders_per_month', async () => {
        const response = await request(app.server)
            .post('/v1/roi/estimate')
            .set('X-API-Key', 'ok_test_123')
            .send({});

        expect(response.status).toBe(400);
    });

    it('returns 400 for negative orders_per_month', async () => {
        const response = await request(app.server)
            .post('/v1/roi/estimate')
            .set('X-API-Key', 'ok_test_123')
            .send({ orders_per_month: -100 });

        expect(response.status).toBe(400);
    });
});