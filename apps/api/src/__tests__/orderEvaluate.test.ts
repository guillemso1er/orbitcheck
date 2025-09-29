import { FastifyInstance } from 'fastify'; // Import the type for safety
import request from 'supertest';
import { createApp, mockAddressValidator, mockPool, setupBeforeAll } from './testSetup';

describe('Order Evaluation Endpoints', () => {
    let app: FastifyInstance;

    // Create the app instance once before all tests in this suite run
    beforeAll(async () => {
        await setupBeforeAll();   // Set up all global mocks and environment
        app = await createApp();    // Correctly await the async app creation
        await app.ready();        // Wait for the app to be fully loaded
    });

    // Close the app instance once after all tests in this suite are finished
    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    // Before each individual test, reset all mocks to a clean, default state
    beforeEach(() => {
        jest.clearAllMocks();

        // Default mock implementations for a "low-risk" order scenario
        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();

            // Mock authentication to succeed
            if (upperQuery.includes('API_KEYS')) {
                return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
            }
            // Mock postal code validation to succeed
            if (upperQuery.startsWith('SELECT 1 FROM GEONAMES_POSTAL')) {
                return Promise.resolve({ rows: [{ '?column?': 1 }] });
            }
            // Mock logging
            if (upperQuery.startsWith('INSERT INTO LOGS')) {
                return Promise.resolve({ rows: [], rowCount: 1 });
            }
            // Default to finding no duplicate orders
            if (upperQuery.startsWith('SELECT ID FROM ORDERS')) {
                return Promise.resolve({ rows: [] });
            }
            // Default empty response for any other query
            return Promise.resolve({ rows: [] });
        });

        // Default mock for address validation to succeed
        mockAddressValidator.normalizeAddress.mockResolvedValue({
            line1: '123 Main St',
            city: 'New York',
            postal_code: '10001',
            country: 'US',
        });
        mockAddressValidator.detectPoBox.mockReturnValue(false);
    });

    describe('POST /v1/orders/evaluate', () => {
        it('should approve a low-risk order', async () => {
            // The default mock setup in beforeEach already creates a "perfect" low-risk scenario.
            // No specific overrides are needed for this test case.
            const res = await request(app.server)
                .post('/v1/orders/evaluate') // FIX: Changed path to plural 'orders'
                .set('Authorization', 'Bearer valid_key')
                .send({
                    order_id: 'order-123',
                    customer: { email: 'test@example.com', first_name: 'John', last_name: 'Doe' },
                    shipping_address: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' },
                    total_amount: 100,
                    currency: 'USD',
                    payment_method: 'card',
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.action).toBe('approve');
            expect(res.body.risk_score).toBe(0);
        });

        it('should place a high-risk order (PO Box) on hold', async () => {
            // Override the address validator mock specifically for this test
            mockAddressValidator.detectPoBox.mockReturnValue(true);

            const res = await request(app.server)
                .post('/v1/orders/evaluate') // FIX: Changed path to plural 'orders'
                .set('Authorization', 'Bearer valid_key')
                .send({
                    order_id: 'order-po-box',
                    customer: { email: 'test@example.com' },
                    shipping_address: { line1: 'PO Box 123', city: 'New York', postal_code: '10001', country: 'US' },
                    total_amount: 100,
                    currency: 'USD',
                    payment_method: 'cod', // Cash on delivery adds risk
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.action).toBe('hold');
            expect(res.body.risk_score).toBe(50); // Assuming 30 (po_box) + 20 (cod)
            expect(res.body.reason_codes).toContain('order.po_box_block');
        });

        it('should place a duplicate order on hold', async () => {
            // Override the database mock ONLY to find a duplicate order_id for this test
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();

                // Specific override for this test: find a duplicate order
                if (upperQuery.startsWith('SELECT ID FROM ORDERS')) {
                    return Promise.resolve({ rows: [{ id: 'existing_order' }] });
                }
                // We must still handle the other queries that run during the request
                if (upperQuery.includes('API_KEYS')) {
                    return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
                }
                if (upperQuery.startsWith('SELECT 1 FROM GEONAMES_POSTAL')) {
                    return Promise.resolve({ rows: [{ '?column?': 1 }] });
                }
                if (upperQuery.startsWith('INSERT INTO LOGS')) {
                    return Promise.resolve({ rows: [], rowCount: 1 });
                }
                if (upperQuery.startsWith('INSERT INTO ORDERS')) {
                    return Promise.resolve({ rows: [], rowCount: 0 });
                }
                return Promise.resolve({ rows: [] }); // Default for others
            });

            const res = await request(app.server)
                .post('/v1/orders/evaluate') // FIX: Changed path to plural 'orders'
                .set('Authorization', 'Bearer valid_key')
                .send({
                    order_id: 'duplicate-123',
                    customer: { email: 'test@example.com' },
                    shipping_address: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' },
                    total_amount: 100,
                    currency: 'USD',
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.action).toBe('hold');
            expect(res.body.risk_score).toBe(50); // Assuming 50 from duplicate order
            expect(res.body.reason_codes).toContain('order.duplicate_detected');
        });
    });
});