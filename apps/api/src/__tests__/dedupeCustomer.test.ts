import type { FastifyInstance } from 'fastify'; // Import the type for safety
import request from 'supertest';

import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

describe('Customer Deduplication Endpoints', () => {
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

    // Before each test, just clear mocks and set up a default state
    beforeEach(() => {
        jest.clearAllMocks();

        // Set up a default "happy path" mock for dependencies.
        // This mock assumes authentication succeeds and finds no duplicates by default.
        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();

            // Mock the authentication query to always succeed
            if (upperQuery.includes('API_KEYS')) {
                return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
            }

            // Mock the logging query
            if (upperQuery.startsWith('INSERT INTO LOGS')) {
                return Promise.resolve({ rows: [], rowCount: 1 });
            }

            // Default behavior for any other query: return no results.
            // This is perfect for the "create new" test case.
            return Promise.resolve({ rows: [] });
        });
    });

    describe('POST /v1/dedupe/customer', () => {
        it('should find exact email match', async () => {
            // For this specific test, override the mock to return an email match
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();

                // Specific case for this test: find a customer by normalized_email
                if (upperQuery.includes('NORMALIZED_EMAIL = $1')) {
                    return Promise.resolve({
                        rows: [{ id: 'uuid-1', email: 'test@example.com', first_name: 'John', last_name: 'Doe' }]
                    });
                }

                // Also handle the auth query that runs during the request
                if (upperQuery.includes('API_KEYS')) {
                    return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
                }

                return Promise.resolve({ rows: [] });
            });

            const response = await request(app.server)
                .post('/v1/dedupe/customer')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'test@example.com', first_name: 'John', last_name: 'Doe' });

            expect(response.status).toBe(200);
            const body = response.body as { matches: unknown[]; suggested_action: string };
            expect(body.matches.length).toBe(1);
            expect(body.suggested_action).toBe('merge_with');
        });

        it('should find exact phone match', async () => {
            // Override for phone match
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();

                if (upperQuery.includes('NORMALIZED_PHONE = $1')) {
                    return Promise.resolve({
                        rows: [{ id: 'uuid-phone', email: null, phone: '+15551234567', first_name: 'Jane', last_name: 'Smith' }]
                    });
                }

                if (upperQuery.includes('API_KEYS')) {
                    return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
                }

                return Promise.resolve({ rows: [] });
            });

            const response = await request(app.server)
                .post('/v1/dedupe/customer')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'unique@example.com', phone: '+15551234567', first_name: 'John', last_name: 'Doe' });

            expect(response.status).toBe(200);
            const body = response.body as { matches: { match_type: string }[]; suggested_action: string };
            expect(body.matches.length).toBe(1);
            expect((body.matches[0] as { match_type: string }).match_type).toBe('exact_phone');
            expect(body.suggested_action).toBe('merge_with');
        });

        it('should suggest review for fuzzy name match', async () => {
            // Override the mock to return a fuzzy name match
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();

                // Specific case for this test: find a fuzzy name match
                if (upperQuery.includes("SIMILARITY((COALESCE(FIRST_NAME, '') || ' ' || COALESCE(LAST_NAME, '')), $1) > $3")) {
                    return Promise.resolve({
                        rows: [{ id: 'uuid-2', first_name: 'Jon', last_name: 'Doe', name_score: 0.9 }]
                    });
                }

                // Also handle the auth query
                if (upperQuery.includes('API_KEYS')) {
                    return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
                }

                return Promise.resolve({ rows: [] });
            });

            const response = await request(app.server)
                .post('/v1/dedupe/customer')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'new@example.com', first_name: 'John', last_name: 'Doe' });

            expect(response.status).toBe(200);
            const body = response.body as { suggested_action: string };
            expect(body.suggested_action).toBe('review');
        });

        it('should suggest create_new if no matches are found', async () => {
            // No override needed. The default mock set up in beforeEach correctly
            // handles this case by returning no matches.
            const response = await request(app.server)
                .post('/v1/dedupe/customer')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'unique@example.com', first_name: 'Jane', last_name: 'Smith' });

            expect(response.status).toBe(200);
            const body = response.body as { matches: unknown[]; suggested_action: string };
            expect(body.matches.length).toBe(0);
            expect(body.suggested_action).toBe('create_new');
        });
    });

    describe('POST /v1/dedupe/address', () => {
        beforeEach(() => {
            jest.clearAllMocks();
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();
                if (upperQuery.includes('API_KEYS')) {
                    return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
                }
                if (upperQuery.startsWith('INSERT INTO LOGS')) {
                    return Promise.resolve({ rows: [], rowCount: 1 });
                }
                return Promise.resolve({ rows: [] });
            });
        });

        it('should find exact address hash match', async () => {
            // Mock normalizeAddress to return a normalized address
            const mockNormalize = jest.fn().mockResolvedValue({
                line1: '123 Main St',
                city: 'New York',
                postal_code: '10001',
                country: 'US'
            });
            jest.doMock('../validators/address', () => ({ normalizeAddress: mockNormalize }));

            // Reload the route if needed, but since it's already loaded, mock the query
            mockPool.query.mockImplementationOnce((queryText: string) => {
                if (queryText.includes('address_hash')) {
                    return Promise.resolve({
                        rows: [{ id: 'addr-1', line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' }]
                    });
                }
                return Promise.resolve({ rows: [] });
            });

            const response = await request(app.server)
                .post('/v1/dedupe/address')
                .set('Authorization', 'Bearer valid_key')
                .send({ line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' });

            expect(response.status).toBe(200);
            const body = response.body as { matches: unknown[]; suggested_action: string };
            expect(body.matches.length).toBe(1);
            expect(body.suggested_action).toBe('merge_with');
        });

        it('should find exact postal match', async () => {
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();
                if (upperQuery.includes('API_KEYS')) {
                    return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
                }
                if (queryText.includes('postal_code') && queryText.includes('lower(city)')) {
                    return Promise.resolve({
                        rows: [{ id: 'addr-postal', line1: 'Different St', city: 'New York', postal_code: '10001', country: 'US' }]
                    });
                }
                return Promise.resolve({ rows: [] });
            });

            const response = await request(app.server)
                .post('/v1/dedupe/address')
                .set('Authorization', 'Bearer valid_key')
                .send({ line1: 'Different Address', city: 'New York', postal_code: '10001', country: 'US' });

            expect(response.status).toBe(200);
            const body = response.body as { matches: { match_type: string }[]; suggested_action: string };
            expect(body.matches.length).toBe(1);
            expect((body.matches[0] as { match_type: string }).match_type).toBe('exact_postal');
            expect(body.suggested_action).toBe('merge_with');
        });

        it('should suggest review for fuzzy address match', async () => {
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();
                if (upperQuery.includes('API_KEYS')) {
                    return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
                }
                if (queryText.includes('greatest(similarity')) {
                    return Promise.resolve({
                        rows: [{ id: 'addr-fuzzy', line1: '123 Maine St', city: 'New Yrok', score: 0.9 }]
                    });
                }
                return Promise.resolve({ rows: [] });
            });

            const response = await request(app.server)
                .post('/v1/dedupe/address')
                .set('Authorization', 'Bearer valid_key')
                .send({ line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' });

            expect(response.status).toBe(200);
            const body = response.body as { suggested_action: string; matches: { similarity_score: number }[] };
            expect(body.suggested_action).toBe('review');
            expect((body.matches[0] as { similarity_score: number }).similarity_score).toBe(0.9);
        });

        it('should suggest create_new if no address matches', async () => {
            const response = await request(app.server)
                .post('/v1/dedupe/address')
                .set('Authorization', 'Bearer valid_key')
                .send({ line1: 'Unique Address', city: 'Unique City', postal_code: '99999', country: 'US' });

            expect(response.status).toBe(200);
            const body = response.body as { matches: unknown[]; suggested_action: string };
            expect(body.matches.length).toBe(0);
            expect(body.suggested_action).toBe('create_new');
        });
    });
});