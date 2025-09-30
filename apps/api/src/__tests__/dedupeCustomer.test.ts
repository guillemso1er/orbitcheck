import request from 'supertest';
import { createApp, mockPool, setupBeforeAll } from './testSetup';
import { FastifyInstance } from 'fastify'; // Import the type for safety

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

            const res = await request(app.server)
                .post('/v1/dedupe/customer')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'test@example.com', first_name: 'John', last_name: 'Doe' });

            expect(res.statusCode).toBe(200);
            expect(res.body.matches.length).toBe(1);
            expect(res.body.suggested_action).toBe('merge_with');
        });

        it('should suggest review for fuzzy name match', async () => {
            // Override the mock to return a fuzzy name match
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();

                // Specific case for this test: find a fuzzy name match
                if (upperQuery.includes("SIMILARITY((FIRST_NAME || ' ' || LAST_NAME), $1) > 0.85")) {
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

            const res = await request(app.server)
                .post('/v1/dedupe/customer')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'new@example.com', first_name: 'John', last_name: 'Doe' });

            expect(res.statusCode).toBe(200);
            expect(res.body.suggested_action).toBe('review');
        });

        it('should suggest create_new if no matches are found', async () => {
            // No override needed. The default mock set up in beforeEach correctly
            // handles this case by returning no matches.
            const res = await request(app.server)
                .post('/v1/dedupe/customer')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'unique@example.com', first_name: 'Jane', last_name: 'Smith' });

            expect(res.statusCode).toBe(200);
            expect(res.body.matches.length).toBe(0);
            expect(res.body.suggested_action).toBe('create_new');
        });
    });
});