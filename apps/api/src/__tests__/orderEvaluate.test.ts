import request from 'supertest';
import { createApp, mockPool, mockValidateAddress, mockValidateEmail, mockValidatePhone, setupBeforeAll } from './testSetup';
import { FastifyInstance } from 'fastify';
import { validateEmail } from '../validators/email';
import { validatePhone } from '../validators/phone';
import { validateAddress } from '../validators/address';

describe('Order Evaluation Endpoints', () => {
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

    describe('POST /v1/orders/evaluate', () => {
        it('should evaluate order with full validators and rules', async () => {
            // Mock validators to return expected values
            const mockEmail = { valid: true, reason_codes: [], disposable: false, normalized: 'test@example.com', mx_found: true };
            const mockPhone = { valid: true, reason_codes: [], country: 'US', e164: '+15551234567' };
            const mockAddress = { valid: true, reason_codes: [], po_box: false, postal_city_match: true, in_bounds: true, geo: { lat: 40, lng: -74 } };
            validateEmail.mockResolvedValue(mockEmail);
            validatePhone.mockResolvedValue(mockPhone);
            validateAddress.mockResolvedValue(mockAddress);
            const mockPoolQuery = mockPool.query as any;
            mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // No customer matches
            mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // No address matches
            mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // No order match
            mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 }); // Insert order

            const res = await request(app.server)
                .post('/v1/orders/evaluate')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    order_id: 'test-order-1',
                    customer: { email: 'test@example.com', phone: '+15551234567', first_name: 'John', last_name: 'Doe' },
                    shipping_address: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' },
                    total_amount: 500,
                    currency: 'USD',
                    payment_method: 'card'
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.risk_score).toBe(0);
            expect(res.body.action).toBe('approve');
            expect(res.body.customer_dedupe.matches.length).toBe(0);
            expect(res.body.address_dedupe.matches.length).toBe(0);
            expect(res.body.validations.email.disposable).toBe(false);
            expect(res.body.validations.address.in_bounds).toBe(true);
        });

        it('should flag high risk for COD + disposable + mismatch', async () => {
            // Mock for high risk case
            const mockEmail = { valid: true, reason_codes: [], disposable: true, normalized: 'disposable@throwaway.com', mx_found: true };
            const mockPhone = { valid: true, reason_codes: [], country: 'MX', e164: '+15551234567' };
            const mockAddress = { valid: true, reason_codes: [], po_box: false, postal_city_match: true, in_bounds: true, geo: { lat: 40, lng: -74 } };
            validateEmail.mockResolvedValue(mockEmail);
            validatePhone.mockResolvedValue(mockPhone);
            validateAddress.mockResolvedValue(mockAddress);
            const mockPoolQuery = mockPool.query as any;
            mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // No customer matches
            mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // No address matches
            mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // No order match
            mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 }); // Insert order

            const res = await request(app.server)
                .post('/v1/orders/evaluate')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    order_id: 'test-order-2',
                    customer: { email: 'disposable@throwaway.com', phone: '+15551234567', first_name: 'John', last_name: 'Doe' },
                    shipping_address: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' },
                    total_amount: 500,
                    currency: 'USD',
                    payment_method: 'cod'
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.risk_score).toBe(95);
            expect(res.body.action).toBe('block');
            expect(res.body.tags).toContain('disposable_email');
            expect(res.body.tags).toContain('high_risk_rto');
        });

        it('should handle PO box and out-of-bounds geo', async () => {
            // Mock for PO box and out-of-bounds
            const mockEmail = { valid: true, reason_codes: [], disposable: false, normalized: 'test@example.com', mx_found: true };
            const mockPhone = { valid: true, reason_codes: [], country: 'US', e164: '+15551234567' };
            const mockAddress = { valid: false, reason_codes: ['address.po_box', 'address.geo_out_of_bounds'], po_box: true, postal_city_match: true, in_bounds: false, geo: { lat: 90, lng: 180 } };
            validateEmail.mockResolvedValue(mockEmail);
            validatePhone.mockResolvedValue(mockPhone);
            validateAddress.mockResolvedValue(mockAddress);
            const mockPoolQuery = mockPool.query as any;
            mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // No customer matches
            mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // No address matches
            mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // No order match
            mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 }); // Insert order

            const res = await request(app.server)
                .post('/v1/orders/evaluate')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    order_id: 'test-order-3',
                    customer: { email: 'test@example.com', phone: '+15551234567', first_name: 'John', last_name: 'Doe' },
                    shipping_address: { line1: 'P.O. Box 123', city: 'New York', postal_code: '10001', country: 'US' },
                    total_amount: 500,
                    currency: 'USD',
                    payment_method: 'card'
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.risk_score).toBe(100);
            expect(res.body.action).toBe('block');
            expect(res.body.tags).toContain('po_box_detected');
            expect(res.body.tags).toContain('virtual_address');
        });
      });
    });