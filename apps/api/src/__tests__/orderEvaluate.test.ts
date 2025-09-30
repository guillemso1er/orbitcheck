import request from 'supertest';
// FIX: Import the mock handler variables, but not the functions from their original source
import { FastifyInstance } from 'fastify';
import { createApp, mockPool, mockValidateAddress, mockValidateEmail, mockValidatePhone, setupBeforeAll } from './testSetup';

// FIX: These imports are no longer needed as we will use the mock variables from testSetup
// import { validateEmail } from '../validators/email';
// import { validatePhone } from '../validators/phone';
// import { validateAddress } from '../validators/address';

describe('Order Evaluation Endpoints', () => {
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

        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.includes('API_KEYS')) {
                return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
            }
            if (upperQuery.startsWith('INSERT INTO LOGS') || upperQuery.startsWith('INSERT INTO ORDERS')) {
                return Promise.resolve({ rows: [], rowCount: 1 });
            }
            return Promise.resolve({ rows: [] });
        });
    });

    describe('POST /v1/orders/evaluate', () => {
        it('should evaluate order with full validators and rules', async () => {
            const mockEmail = { valid: true, reason_codes: [], disposable: false, normalized: 'test@example.com', mx_found: true };
            const mockPhone = { valid: true, reason_codes: [], country: 'US', e164: '+15551234567' };
            const mockAddress = {
                valid: true, reason_codes: [], po_box: false, postal_city_match: true, in_bounds: true, geo: { lat: 40, lng: -74 },
                normalized: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' }
            };

            // FIX: Use the imported mock variables directly
            mockValidateEmail.mockResolvedValue(mockEmail);
            mockValidatePhone.mockResolvedValue(mockPhone);
            mockValidateAddress.mockResolvedValue(mockAddress);

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
        });

        it('should flag high risk for COD + disposable + mismatch', async () => {
            const mockEmail = { valid: true, reason_codes: [], disposable: true, normalized: 'disposable@throwaway.com', mx_found: true };
            const mockPhone = { valid: true, reason_codes: [], country: 'MX', e164: '+15551234567' };
            const mockAddress = {
                valid: true, reason_codes: [], po_box: false, postal_city_match: true, in_bounds: true, geo: { lat: 40, lng: -74 },
                normalized: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' }
            };

            // FIX: Use the imported mock variables directly
            mockValidateEmail.mockResolvedValue(mockEmail);
            mockValidatePhone.mockResolvedValue(mockPhone);
            mockValidateAddress.mockResolvedValue(mockAddress);

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
        });

        it('should handle PO box and out-of-bounds geo', async () => {
            const mockEmail = { valid: true, reason_codes: [], disposable: false, normalized: 'test@example.com', mx_found: true };
            const mockPhone = { valid: true, reason_codes: [], country: 'US', e164: '+15551234567' };
            const mockAddress = {
                valid: false, reason_codes: ['address.po_box', 'address.geo_out_of_bounds'], po_box: true, postal_city_match: true, in_bounds: false, geo: { lat: 90, lng: 180 },
                normalized: { line1: 'P.O. Box 123', city: 'New York', postal_code: '10001', country: 'US' }
            };

            // FIX: Use the imported mock variables directly
            mockValidateEmail.mockResolvedValue(mockEmail);
            mockValidatePhone.mockResolvedValue(mockPhone);
            mockValidateAddress.mockResolvedValue(mockAddress);

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
        });
    });
});