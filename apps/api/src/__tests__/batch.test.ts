import crypto from 'node:crypto';

import type { FastifyInstance } from 'fastify'; // Import the type for safety
import request from 'supertest';

import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

describe('Batch Endpoints', () => {
    let app: FastifyInstance;

    // Create the app instance once before any tests in this suite run
    beforeAll(async () => {
        await setupBeforeAll(); // Set up all global mocks
        app = await createApp();  // Await the async function
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
            if (upperQuery.includes('INSERT INTO JOBS')) {
                return Promise.resolve({ rows: [{ id: 'job-123' }] });
            }
            return Promise.resolve({ rows: [] });
        });

        // Mock crypto.randomUUID if needed
        jest.spyOn(crypto, 'randomUUID').mockReturnValue('123e4567-e89b-12d3-a456-426614174000');
    });

    describe('POST /v1/batch/validate', () => {
        it('should accept batch validation request with email type', async () => {
            const response = await request(app.server)
                .post('/v1/batch/validate')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    type: 'email',
                    data: ['test1@example.com', 'test2@example.com']
                });

            expect(response.status).toBe(202);
            expect(response.body).toHaveProperty('job_id');
            expect(response.body).toHaveProperty('status', 'pending');
            expect(response.body).toHaveProperty('request_id');
        });

        it('should accept batch validation request with phone type', async () => {
            const response = await request(app.server)
                .post('/v1/batch/validate')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    type: 'phone',
                    data: ['+1234567890', '+0987654321']
                });

            expect(response.status).toBe(202);
            expect(response.body).toHaveProperty('job_id');
            expect(response.body.status).toBe('pending');
        });

        it('should accept batch validation request with address type', async () => {
            const response = await request(app.server)
                .post('/v1/batch/validate')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    type: 'address',
                    data: ['123 Main St', '456 Oak Ave']
                });

            expect(response.status).toBe(202);
            expect(response.body.status).toBe('pending');
        });

        it('should accept batch validation request with tax-id type', async () => {
            const response = await request(app.server)
                .post('/v1/batch/validate')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    type: 'tax-id',
                    data: ['123-45-6789', '987-65-4321']
                });

            expect(response.status).toBe(202);
            expect(response.body.status).toBe('pending');
        });

        it('should reject request with empty data array', async () => {
            const response = await request(app.server)
                .post('/v1/batch/validate')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    type: 'email',
                    data: []
                });

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should reject request with too many items', async () => {
            const largeData = new Array(10001).fill('test@example.com');
            const response = await request(app.server)
                .post('/v1/batch/validate')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    type: 'email',
                    data: largeData
                });

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should reject request with invalid type', async () => {
            const response = await request(app.server)
                .post('/v1/batch/validate')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    type: 'invalid',
                    data: ['test@example.com']
                });

            expect(response.status).toBe(400);
        });
    });

    describe('POST /v1/batch/dedupe', () => {
        it('should accept batch deduplication request with customers type', async () => {
            const response = await request(app.server)
                .post('/v1/batch/dedupe')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    type: 'customers',
                    data: [
                        { name: 'John Doe', email: 'john@example.com' },
                        { name: 'Jane Smith', email: 'jane@example.com' }
                    ]
                });

            expect(response.status).toBe(202);
            expect(response.body).toHaveProperty('job_id');
            expect(response.body.status).toBe('pending');
        });

        it('should accept batch deduplication request with addresses type', async () => {
            const response = await request(app.server)
                .post('/v1/batch/dedupe')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    type: 'addresses',
                    data: [
                        '123 Main St, City, State',
                        '456 Oak Ave, City, State'
                    ]
                });

            expect(response.status).toBe(202);
            expect(response.body.status).toBe('pending');
        });

        it('should reject request with empty data array', async () => {
            const response = await request(app.server)
                .post('/v1/batch/dedupe')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    type: 'customers',
                    data: []
                });

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should reject request with too many items', async () => {
            const largeData = new Array(10001).fill({ name: 'Test', email: 'test@example.com' });
            const response = await request(app.server)
                .post('/v1/batch/dedupe')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    type: 'customers',
                    data: largeData
                });

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('INVALID_INPUT');
        });
    });
});