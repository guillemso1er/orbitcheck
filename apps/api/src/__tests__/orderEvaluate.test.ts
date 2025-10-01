import request from 'supertest';
// FIX: Import the mock handler variables, but not the functions from their original source
import { FastifyInstance } from 'fastify';
import { createApp, mockPool, mockValidateAddress, mockValidateEmail, mockValidatePhone, setupBeforeAll } from './testSetup';



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

        mockValidateEmail.mockResolvedValue({ valid: true, reason_codes: [], disposable: false, normalized: 'test@example.com', mx_found: true });
        mockValidatePhone.mockResolvedValue({ valid: true, reason_codes: [], country: 'US', e14: '+15551234567' });
        mockValidateAddress.mockResolvedValue({
            valid: true, reason_codes: [], po_box: false, postal_city_match: true, in_bounds: true, geo: { lat: 40, lng: -74 },
            normalized: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' }
        });
        mockPool.query.mockImplementation((queryText: string) => {
            if (queryText.toUpperCase().startsWith('INSERT')) {
                return Promise.resolve({ rowCount: 1, rows: [] });
            }
            return Promise.resolve({ rows: [] });
        });
    });

    describe('POST /v1/orders/evaluate', () => {
        it('should detect customer dedupe via exact email match', async () => {
            // FIX: Make the mock comprehensive for this test's execution path
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();
                if (upperQuery.includes('CUSTOMERS') && upperQuery.includes('NORMALIZED_EMAIL')) {
                    return Promise.resolve({
                        rows: [{
                            id: 'cust-1', email: 'test@example.com', phone: null, first_name: 'John', last_name: 'Doe',
                            similarity_score: 1.0, match_type: 'exact_email'
                        }]
                    });
                }
                if (upperQuery.startsWith('INSERT')) { return Promise.resolve({ rowCount: 1, rows: [] }); }
                // Return empty for all other SELECT queries
                return Promise.resolve({ rows: [] });
            });

            const res = await request(app.server).post('/v1/orders/evaluate').set('Authorization', 'Bearer valid_key')
                .send({
                    order_id: 'test-order-4',
                    customer: { email: 'test@example.com', phone: '+15551234567', first_name: 'John', last_name: 'Doe' },
                    shipping_address: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' },
                    total_amount: 500, currency: 'USD', payment_method: 'card'
                });

            console.log('Exact Email Match Response Body:', JSON.stringify(res.body, null, 2));
            expect(res.statusCode).toBe(200);
            expect(res.body.customer_dedupe.matches).toHaveLength(1);
            expect(res.body.customer_dedupe.matches[0].match_type).toBe('exact_email');
            expect(res.body.risk_score).toBe(20);
        });

        it('should detect customer dedupe via fuzzy name match', async () => {
            // FIX: Make the mock handle the entire execution path for this specific test.
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();

                // 1. When the email query runs, return NO matches.
                if (upperQuery.includes('NORMALIZED_EMAIL')) {
                    return Promise.resolve({ rows: [] });
                }

                // 2. When the similarity query runs, return the fuzzy match.
                if (upperQuery.includes('CUSTOMERS') && upperQuery.includes('SIMILARITY')) {
                    return Promise.resolve({
                        rows: [{
                            id: 'cust-2', email: null, phone: null, first_name: 'Jon', last_name: 'Doh',
                            similarity_score: 0.9
                        }]
                    });
                }

                if (upperQuery.startsWith('INSERT')) { return Promise.resolve({ rowCount: 1, rows: [] }); }

                // 3. Default to no matches for any other query.
                return Promise.resolve({ rows: [] });
            });

            const res = await request(app.server).post('/v1/orders/evaluate').set('Authorization', 'Bearer valid_key')
                .send({
                    order_id: 'test-order-5',
                    customer: { email: 'unique@example.com', phone: '+15551234567', first_name: 'John', last_name: 'Doe' },
                    shipping_address: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' },
                    total_amount: 500, currency: 'USD', payment_method: 'card'
                });

            console.log('Fuzzy Name Match Response Body:', JSON.stringify(res.body, null, 2));
            expect(res.statusCode).toBe(200);
            expect(res.body.customer_dedupe.matches).toHaveLength(1);
            expect(res.body.customer_dedupe.matches[0].match_type).toBe('fuzzy_name'); // This will now pass
            expect(res.body.risk_score).toBe(20);
        });

        it('should detect address dedupe via exact hash match', async () => {
            // FIX: Make the mock comprehensive for this test's execution path
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();
                if (upperQuery.includes('ADDRESSES') && upperQuery.includes('ADDRESS_HASH')) {
                    return Promise.resolve({
                        rows: [{
                            id: 'addr-1', line1: '123 Main St', city: 'New York',
                            similarity_score: 1.0, match_type: 'exact_address'
                        }]
                    });
                }
                if (upperQuery.startsWith('INSERT')) { return Promise.resolve({ rowCount: 1, rows: [] }); }
                // Return empty for all other SELECT queries
                return Promise.resolve({ rows: [] });
            });

            const res = await request(app.server).post('/v1/orders/evaluate').set('Authorization', 'Bearer valid_key')
                .send({
                    order_id: 'test-order-6',
                    customer: { email: 'test@example.com', phone: '+15551234567', first_name: 'John', last_name: 'Doe' },
                    shipping_address: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' },
                    total_amount: 500, currency: 'USD', payment_method: 'card'
                });

            console.log('Address Hash Match Response Body:', JSON.stringify(res.body, null, 2));
            expect(res.statusCode).toBe(200);
            expect(res.body.address_dedupe.matches).toHaveLength(1);
            expect(res.body.address_dedupe.matches[0].match_type).toBe('exact_address');
            expect(res.body.risk_score).toBe(15);
        });


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



        it('should detect duplicate order', async () => {
            const mockEmail = { valid: true, reason_codes: [], disposable: false, normalized: 'test@example.com', mx_found: true };
            const mockPhone = { valid: true, reason_codes: [], country: 'US', e164: '+15551234567' };
            const mockAddress = {
                valid: true, reason_codes: [], po_box: false, postal_city_match: true, in_bounds: true, geo: { lat: 40, lng: -74 },
                normalized: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' }
            };

            mockValidateEmail.mockResolvedValue(mockEmail);
            mockValidatePhone.mockResolvedValue(mockPhone);
            mockValidateAddress.mockResolvedValue(mockAddress);

            // Mock duplicate order
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();
                if (upperQuery.includes('API_KEYS')) {
                    return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
                }
                if (upperQuery.includes('ORDERS') && upperQuery.includes('ORDER_ID')) {
                    return Promise.resolve({ rows: [{ id: 'order-1' }] });
                }
                if (upperQuery.startsWith('INSERT INTO LOGS') || upperQuery.startsWith('INSERT INTO ORDERS')) {
                    return Promise.resolve({ rows: [], rowCount: 1 });
                }
                return Promise.resolve({ rows: [] });
            });

            const res = await request(app.server)
                .post('/v1/orders/evaluate')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    order_id: 'duplicate-order',
                    customer: { email: 'test@example.com', phone: '+15551234567', first_name: 'John', last_name: 'Doe' },
                    shipping_address: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' },
                    total_amount: 500,
                    currency: 'USD',
                    payment_method: 'card'
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.risk_score).toBe(50);
            expect(res.body.tags).toContain('duplicate_order');
            expect(res.body.action).toBe('hold');
        });

        it('should apply high value risk', async () => {
            const mockEmail = { valid: true, reason_codes: [], disposable: false, normalized: 'test@example.com', mx_found: true };
            const mockPhone = { valid: true, reason_codes: [], country: 'US', e164: '+15551234567' };
            const mockAddress = {
                valid: true, reason_codes: [], po_box: false, postal_city_match: true, in_bounds: true, geo: { lat: 40, lng: -74 },
                normalized: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' }
            };

            mockValidateEmail.mockResolvedValue(mockEmail);
            mockValidatePhone.mockResolvedValue(mockPhone);
            mockValidateAddress.mockResolvedValue(mockAddress);

            const res = await request(app.server)
                .post('/v1/orders/evaluate')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    order_id: 'high-value-order',
                    customer: { email: 'test@example.com', phone: '+15551234567', first_name: 'John', last_name: 'Doe' },
                    shipping_address: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' },
                    total_amount: 1500,
                    currency: 'USD',
                    payment_method: 'card'
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.risk_score).toBe(15);
            expect(res.body.tags).toContain('high_value_order');
        });

        it('should handle invalid email validation', async () => {
            const mockEmail = { valid: false, reason_codes: ['email.invalid_format'], disposable: false, normalized: 'invalid-email', mx_found: false };
            const mockPhone = { valid: true, reason_codes: [], country: 'US', e164: '+15551234567' };
            const mockAddress = {
                valid: true, reason_codes: [], po_box: false, postal_city_match: true, in_bounds: true, geo: { lat: 40, lng: -74 },
                normalized: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' }
            };

            mockValidateEmail.mockResolvedValue(mockEmail);
            mockValidatePhone.mockResolvedValue(mockPhone);
            mockValidateAddress.mockResolvedValue(mockAddress);

            const res = await request(app.server)
                .post('/v1/orders/evaluate')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    order_id: 'invalid-email-order',
                    customer: { email: 'invalid-email', phone: '+15551234567', first_name: 'John', last_name: 'Doe' },
                    shipping_address: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' },
                    total_amount: 500,
                    currency: 'USD',
                    payment_method: 'card'
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.risk_score).toBe(25);
            expect(res.body.validations.email.valid).toBe(false);
            expect(res.body.validations.email.reason_codes).toContain('email.invalid_format');
            expect(res.body.reason_codes).toContain('email.invalid_format');
        });

        it('should handle geocode failure', async () => {
            const mockEmail = { valid: true, reason_codes: [], disposable: false, normalized: 'test@example.com', mx_found: true };
            const mockPhone = { valid: true, reason_codes: [], country: 'US', e164: '+15551234567' };
            const mockAddress = {
                valid: true, reason_codes: [], po_box: false, postal_city_match: true, in_bounds: true, geo: null,
                normalized: { line1: 'Invalid Address', city: 'Unknown', postal_code: '00000', country: 'US' }
            };

            mockValidateEmail.mockResolvedValue(mockEmail);
            mockValidatePhone.mockResolvedValue(mockPhone);
            mockValidateAddress.mockResolvedValue(mockAddress);

            const res = await request(app.server)
                .post('/v1/orders/evaluate')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    order_id: 'geocode-fail-order',
                    customer: { email: 'test@example.com', phone: '+15551234567', first_name: 'John', last_name: 'Doe' },
                    shipping_address: { line1: 'Invalid Address', city: 'Unknown', postal_code: '00000', country: 'US' },
                    total_amount: 500,
                    currency: 'USD',
                    payment_method: 'card'
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.risk_score).toBe(20);
            expect(res.body.reason_codes).toContain('order.geocode_failed');
        });

        it('should handle server error', async () => {
            mockPool.query.mockRejectedValueOnce(new Error('Database error'));

            const res = await request(app.server)
                .post('/v1/orders/evaluate')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    order_id: 'error-order',
                    customer: { email: 'test@example.com' },
                    shipping_address: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' },
                    total_amount: 500,
                    currency: 'USD',
                    payment_method: 'card'
                });

            expect(res.statusCode).toBe(500);
            expect(res.body.error).toBeDefined();
        });
    });
});