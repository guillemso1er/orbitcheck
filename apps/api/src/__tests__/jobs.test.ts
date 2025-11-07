import crypto from 'node:crypto';

import type { FastifyInstance } from 'fastify'; // Import the type for safety
import request from 'supertest';

import { createApp, mockPool, mockRedisInstance, setupBeforeAll } from './testSetup.js';

describe('Jobs Endpoints', () => {
    let app: FastifyInstance;

    // Create the app instance once before any tests in this suite run
    beforeAll(async () => {
        await setupBeforeAll(); // Set up all global mocks
        app = await createApp();  // Await the async function

        // Add proper authentication hooks
        const { authenticateRequest, applyRateLimitingAndIdempotency } = await import('../web.js');
        app.addHook('preHandler', async (request, rep) => {
            await authenticateRequest(request, rep, mockPool as any);
            await applyRateLimitingAndIdempotency(request, rep, mockRedisInstance as any);
        });

        await app.ready();      // Wait for the app to be ready
    });

    // Close the app instance once after all tests in this suite are finished
    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    // Before each test, clear mocks and set up a default state
    beforeEach(() => {
        jest.clearAllMocks();

        // Default mock implementations for API key auth and logging
        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.includes('API_KEYS')) {
                return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
            }
            if (upperQuery.startsWith('INSERT INTO LOGS')) {
                return Promise.resolve({ rows: [], rowCount: 1 });
            }
            if (upperQuery.includes('SELECT') && upperQuery.includes('JOBS')) {
                return Promise.resolve({
                    rows: [{
                        id: 'job-123',
                        status: 'completed',
                        input_data: JSON.stringify({ type: 'email', data: ['test@example.com'] }),
                        result_data: JSON.stringify([{ valid: true, email: 'test@example.com' }]),
                        error_message: null,
                        total_items: 1,
                        processed_items: 1,
                        result_url: 'https://example.com/results/job-123.json',
                        created_at: new Date('2023-01-01T00:00:00Z'),
                        updated_at: new Date('2023-01-01T00:01:00Z')
                    }]
                });
            }
            return Promise.resolve({ rows: [] });
        });

        // Mock crypto.randomUUID if needed
        jest.spyOn(crypto, 'randomUUID').mockReturnValue('123e4567-e89b-12d3-a456-426614174000');
    });

    describe('GET /v1/jobs/:id', () => {
        it('should return job status for completed job', async () => {
            const response = await request(app.server)
                .get('/v1/jobs/job-123')
                .set('Authorization', 'Bearer valid_key');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('job_id', 'job-123');
            expect(response.body).toHaveProperty('status', 'completed');
            expect(response.body).toHaveProperty('progress');
            expect(response.body.progress).toHaveProperty('total', 1);
            expect(response.body.progress).toHaveProperty('processed', 1);
            expect(response.body.progress).toHaveProperty('percentage', 100);
            expect(response.body).toHaveProperty('result_url', 'https://example.com/results/job-123.json');
            expect(response.body).toHaveProperty('error', null);
            expect(response.body).toHaveProperty('created_at');
            expect(response.body).toHaveProperty('updated_at');
            expect(response.body).toHaveProperty('request_id');
            expect(response.body).toHaveProperty('result_data');
        });

        it('should return job status for pending job', async () => {
            // Clear all mocks first
            jest.clearAllMocks();

            // Set up comprehensive mocks for this test
            mockPool.query
                // First call: API key lookup for authentication
                .mockResolvedValueOnce({
                    rows: [{
                        id: 'test_key_id',
                        project_id: 'test_project',
                        encrypted_key: '0123456789abcdef0123456789abcdef:test_encrypted_key'
                    }]
                })
                // Second call: API key usage update
                .mockResolvedValueOnce({ rows: [] })
                // Third call: Job lookup - this should return pending job
                .mockResolvedValueOnce({
                    rows: [{
                        id: 'job-456',
                        status: 'pending',
                        input_data: JSON.stringify({ type: 'email', data: ['test@example.com'] }),
                        result_data: null,
                        error_message: null,
                        total_items: 1,
                        processed_items: 0,
                        result_url: null,
                        created_at: new Date('2023-01-01T00:00:00Z'),
                        updated_at: new Date('2023-01-01T00:00:00Z')
                    }]
                });

            const response = await request(app.server)
                .get('/v1/jobs/job-456')
                .set('Authorization', 'Bearer ok_test_key_1234567890abcdef');

            expect(response.status).toBe(200);
            expect(response.body.status).toBe('pending');
            expect(response.body.progress).toBeNull();
            expect(response.body.result_url).toBeNull();
        });

        it('should return job status for processing job', async () => {
            // Clear all mocks first
            jest.clearAllMocks();

            // Set up comprehensive mocks for this test
            mockPool.query
                // First call: API key lookup for authentication
                .mockResolvedValueOnce({
                    rows: [{
                        id: 'test_key_id',
                        project_id: 'test_project',
                        encrypted_key: '0123456789abcdef0123456789abcdef:test_encrypted_key'
                    }]
                })
                // Second call: API key usage update
                .mockResolvedValueOnce({ rows: [] })
                // Third call: Job lookup - this should return processing job
                .mockResolvedValueOnce({
                    rows: [{
                        id: 'job-processing',
                        status: 'processing',
                        input_data: JSON.stringify({ type: 'email', data: ['test@example.com'] }),
                        result_data: null,
                        error_message: null,
                        total_items: 10,
                        processed_items: 5,
                        result_url: null,
                        created_at: new Date('2023-01-01T00:00:00Z'),
                        updated_at: new Date('2023-01-01T00:00:30Z')
                    }]
                });

            const response = await request(app.server)
                .get('/v1/jobs/job-processing')
                .set('Authorization', 'Bearer ok_test_key_1234567890abcdef');

            expect(response.status).toBe(200);
            expect(response.body.status).toBe('processing');
            expect(response.body.progress).toBeDefined();
            expect(response.body.progress.total).toBe(10);
            expect(response.body.progress.processed).toBe(5);
            expect(response.body.progress.percentage).toBe(50);
        });

        it('should return job status for failed job', async () => {
            // Clear all mocks first
            jest.clearAllMocks();

            // Set up comprehensive mocks for this test
            mockPool.query
                // First call: API key lookup for authentication
                .mockResolvedValueOnce({
                    rows: [{
                        id: 'test_key_id',
                        project_id: 'test_project',
                        encrypted_key: '0123456789abcdef0123456789abcdef:test_encrypted_key'
                    }]
                })
                // Second call: API key usage update
                .mockResolvedValueOnce({ rows: [] })
                // Third call: Job lookup - this should return failed job
                .mockResolvedValueOnce({
                    rows: [{
                        id: 'job-fail',
                        status: 'failed',
                        input_data: JSON.stringify({ type: 'email', data: ['test@example.com'] }),
                        result_data: null,
                        error_message: 'Processing failed',
                        total_items: 1,
                        processed_items: 0,
                        result_url: null,
                        created_at: new Date('2023-01-01T00:00:00Z'),
                        updated_at: new Date('2023-01-01T00:00:05Z')
                    }]
                });

            const response = await request(app.server)
                .get('/v1/jobs/job-fail')
                .set('Authorization', 'Bearer ok_test_key_1234567890abcdef');

            expect(response.status).toBe(200);
            expect(response.body.status).toBe('failed');
            expect(response.body.error).toBe('Processing failed');
        });

        it('should return 404 for non-existent job', async () => {
            // Clear all mocks first
            jest.clearAllMocks();

            // Set up comprehensive mocks for this test
            mockPool.query
                // First call: API key lookup for authentication
                .mockResolvedValueOnce({
                    rows: [{
                        id: 'test_key_id',
                        project_id: 'test_project',
                        encrypted_key: '0123456789abcdef0123456789abcdef:test_encrypted_key'
                    }]
                })
                // Second call: API key usage update
                .mockResolvedValueOnce({ rows: [] })
                // Third call: Job lookup - this should return empty (no job found)
                .mockResolvedValueOnce({ rows: [] });

            const response = await request(app.server)
                .get('/v1/jobs/non-existent')
                .set('Authorization', 'Bearer ok_test_key_1234567890abcdef');

            expect(response.status).toBe(404);
            expect(response.body.error.code).toBe('not_found');
            expect(response.body.error.message).toBe('Job not found');
        });
    });
});