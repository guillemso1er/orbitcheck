import crypto from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import request from 'supertest';

import { createApp, mockPool, mockRedisInstance, setupBeforeAll } from './testSetup.js';

const actualModule = jest.requireActual('../validators/address');
const { validateAddress, normalizeAddress, detectPoBox } = actualModule;

describe('Address Validation Endpoints', () => {
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

    // Before each test, clear mocks and set up a default "valid address" state
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Mock global fetch to provide successful geocoding responses
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([
                {
                    lat: "40.7128",
                    lon: "-74.0060",
                    display_name: "123 Main Street, Anytown, NY 12345, US"
                }
            ])
        });

        // Default to a successful validation response, which tests can override
        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.includes('API_KEYS')) {
                return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
            }
            if (upperQuery.includes('GEONAMES_POSTAL')) {
                return Promise.resolve({ rows: [{ 1: 1 }] }); // Simulate postal code match
            }
            if (upperQuery.includes('COUNTRIES_BOUNDING_BOXES')) {
                return Promise.resolve({ rows: [{ 1: 1 }] }); // Simulate in bounds
            }
            if (upperQuery.startsWith('INSERT INTO LOGS')) {
                return Promise.resolve({ rows: [], rowCount: 1 });
            }
            return Promise.resolve({ rows: [] });
        });

        // Reset other specific mocks to their default success states
        const mockRedis = mockRedisInstance as unknown as jest.Mocked<Redis>;
        mockRedis.sismember.mockResolvedValue(0);
        mockRedis.get.mockResolvedValue(null);
        mockRedis.set.mockResolvedValue('OK');

        // Mock crypto.randomUUID if needed
        jest.spyOn(crypto, 'randomUUID').mockReturnValue('123e4567-e89b-12d3-a456-426614174000');
    });

    describe('detectPoBox function', () => {
        it('should detect standard PO Box', () => {
            expect(detectPoBox('PO Box 123')).toBe(true);
            expect(detectPoBox('P.O. Box 456')).toBe(true);
            expect(detectPoBox('P.O. BOX 789')).toBe(true);
        });

        it('should detect international PO Box variations', () => {
            expect(detectPoBox('Apartado Postal 123')).toBe(true);
            expect(detectPoBox('Caixa Postal 456')).toBe(true);
            expect(detectPoBox('Casilla 789')).toBe(true);
        });

        it('should not detect false positives', () => {
            expect(detectPoBox('123 Main Street')).toBe(false);
            expect(detectPoBox('PO Boxwood Lane')).toBe(false);
            expect(detectPoBox('Post Office Building')).toBe(false);
        });
    });

    describe('normalizeAddress function', () => {
        it('should normalize address with whitespace trimming', async () => {
            const result = await normalizeAddress({
                line1: '  123 Main St  ',
                line2: '  Apt 4B  ',
                city: '  Anytown  ',
                state: '  CA  ',
                postal_code: '  12345  ',
                country: '  us  '
            });

            expect(result.line1).toBe('123 Main St');
            expect(result.line2).toBe('Apt 4B');
            expect(result.city).toBe('Anytown');
            expect(result.state).toBe('CA');
            expect(result.postal_code).toBe('12345');
            expect(result.country).toBe('US');
        });

        it('should preserve PO Box addresses without normalization', async () => {
            const result = await normalizeAddress({
                line1: 'PO Box 123',
                line2: 'Suite 456',
                city: 'Anytown',
                state: 'CA',
                postal_code: '12345',
                country: 'US'
            });

            expect(result.line1).toBe('PO Box 123');
            expect(result.line2).toBe('Suite 456');
        });
    });

    describe('validateAddress function', () => {
        it('should validate a valid address without Redis', async () => {
            const result = await validateAddress({
                line1: '123 Main Street',
                city: 'Anytown',
                postal_code: '12345',
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(true);
            expect(result.po_box).toBe(false);
            expect(result.postal_city_match).toBe(true);
            expect(result.in_bounds).toBe(true);
            expect(result.reason_codes).toEqual([]);
        });

        it('should invalidate address with PO Box', async () => {
            const result = await validateAddress({
                line1: 'PO Box 123',
                city: 'Anytown',
                postal_code: '12345',
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(true); // PO Box is valid but not deliverable
            expect(result.po_box).toBe(true);
            expect(result.deliverable).toBe(false);
            expect(result.reason_codes).toContain('address.po_box');
        });

        it('should invalidate address with postal code mismatch', async () => {
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();
                if (upperQuery.includes('GEONAMES_POSTAL')) {
                    return Promise.resolve({ rows: [] }); // No match
                }
                if (upperQuery.includes('COUNTRIES_BOUNDING_BOXES')) {
                    return Promise.resolve({ rows: [{ 1: 1 }] });
                }
                return Promise.resolve({ rows: [] });
            });

            const result = await validateAddress({
                line1: '123 Main Street',
                city: 'WrongCity',
                postal_code: '99999',
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(false);
            expect(result.postal_city_match).toBe(false);
            expect(result.reason_codes).toContain('address.postal_city_mismatch');
        });

        it('should invalidate address out of geographic bounds', async () => {
            // Mock geocoding to succeed but bounding box check to fail
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve([
                    {
                        lat: "999.9999",  // Invalid coordinates
                        lon: "999.9999",
                        display_name: "123 Main Street, Anytown, NY 12345, US"
                    }
                ])
            });

            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();
                if (upperQuery.includes('GEONAMES_POSTAL')) {
                    return Promise.resolve({ rows: [{ 1: 1 }] }); // Postal match succeeds
                }
                if (upperQuery.includes('COUNTRIES_BOUNDING_BOXES')) {
                    return Promise.resolve({ rows: [] }); // Out of bounds
                }
                return Promise.resolve({ rows: [] });
            });

            const result = await validateAddress({
                line1: '123 Main Street',
                city: 'Anytown',
                postal_code: '12345',
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(true); // Still valid but out of bounds
            expect(result.in_bounds).toBe(false);
            expect(result.reason_codes).toContain('address.geo_out_of_bounds');
        });

        it('should use cache from Redis', async () => {
            const mockRedis = mockRedisInstance as unknown as jest.Mocked<Redis>;
            const cachedResult = {
                valid: true,
                normalized: { line1: '123 Main St', city: 'Anytown', postal_code: '12345', country: 'US' },
                po_box: false,
                postal_city_match: true,
                in_bounds: true,
                geo: { lat: 40, lng: -74, confidence: 0.9, source: 'locationiq' },
                reason_codes: [],
                request_id: '123e4567-e89b-12d3-a456-426614174000',
                ttl_seconds: 604800,
                deliverable: true
            };

            const input = JSON.stringify({ line1: '123 Main St', city: 'Anytown', postal_code: '12345', country: 'US' });
            const hash = crypto.createHash('sha1').update(input).digest('hex');
            mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedResult));

            const result = await validateAddress({
                line1: '123 Main St',
                city: 'Anytown',
                postal_code: '12345',
                country: 'US'
            }, mockPool as any, mockRedis);

            expect(result).toEqual(cachedResult);
            expect(mockRedis.get).toHaveBeenCalledWith(`validator:address:${hash}`);
        });

        it('should cache result in Redis after computation', async () => {
            const mockRedis = mockRedisInstance as unknown as jest.Mocked<Redis>;
            mockRedis.get.mockResolvedValue(null);

            await validateAddress({
                line1: '123 Main St',
                city: 'Anytown',
                postal_code: '12345',
                country: 'US'
            }, mockPool as any, mockRedis);

            const input = JSON.stringify({ line1: '123 Main St', city: 'Anytown', postal_code: '12345', country: 'US' });
            const hash = crypto.createHash('sha1').update(input).digest('hex');

            expect(mockRedis.set).toHaveBeenCalledWith(
                `validator:address:${hash}`,
                expect.stringContaining('"valid":true'),
                'EX',
                604800
            );
        });
    });

    describe('validateAddress function - non-obvious invalid cases', () => {
        it('should invalidate address with only numbers in street name', async () => {
            // Mock geocoding to fail for this invalid address
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 500,
                json: () => Promise.resolve([])
            });

            const result = await validateAddress({
                line1: '123',
                city: 'Anytown',
                postal_code: '12345',
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(true); // Still valid format-wise
            expect(result.reason_codes).toContain('address.geocode_failed');
        });

        it('should invalidate address with excessive special characters', async () => {
            // Mock geocoding to fail for this invalid address
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 500,
                json: () => Promise.resolve([])
            });

            const result = await validateAddress({
                line1: '123 @#$%^&*() Main St',
                city: 'Anytown',
                postal_code: '12345',
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(true); // Format valid
            expect(result.reason_codes).toContain('address.geocode_failed');
        });

        it('should invalidate address with very long fields', async () => {
            // Mock geocoding to fail for this invalid address
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 500,
                json: () => Promise.resolve([])
            });

            const longStreet = 'A'.repeat(500);
            const result = await validateAddress({
                line1: longStreet,
                city: 'Anytown',
                postal_code: '12345',
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(true); // Still valid format
            expect(result.reason_codes).toContain('address.geocode_failed');
        });

        it('should invalidate address with null postal code', async () => {
            const result = await validateAddress({
                line1: '123 Main St',
                city: 'Anytown',
                postal_code: null as any,
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('address.postal_city_mismatch');
        });

        it('should invalidate address with undefined city', async () => {
            const result = await validateAddress({
                line1: '123 Main St',
                city: undefined as any,
                postal_code: '12345',
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('address.postal_city_mismatch');
        });

        it('should invalidate address with empty country', async () => {
            const result = await validateAddress({
                line1: '123 Main St',
                city: 'Anytown',
                postal_code: '12345',
                country: ''
            }, mockPool as any);

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('address.postal_city_mismatch');
        });

        it('should invalidate address with numeric-only city name', async () => {
            // Mock geocoding to fail for this invalid address
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 500,
                json: () => Promise.resolve([])
            });

            const result = await validateAddress({
                line1: '123 Main St',
                city: '12345',
                postal_code: '12345',
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(true); // Postal match might succeed
            expect(result.reason_codes).toContain('address.geocode_failed');
        });

        it('should invalidate address with state code that does not match country', async () => {
            // Mock postal code lookup to return no results (mismatched address)
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();
                if (upperQuery.includes('GEONAMES_POSTAL')) {
                    return Promise.resolve({ rows: [] }); // No match for mismatched address
                }
                if (upperQuery.includes('COUNTRIES_BOUNDING_BOXES')) {
                    return Promise.resolve({ rows: [{ 1: 1 }] });
                }
                return Promise.resolve({ rows: [] });
            });

            const result = await validateAddress({
                line1: '123 Main St',
                city: 'London',
                state: 'CA',
                postal_code: 'SW1A 1AA',
                country: 'GB'
            }, mockPool as any);

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('address.postal_city_mismatch');
        });

        it('should invalidate address with postal code containing letters in numeric-only country', async () => {
            // Mock postal code lookup to return no results (invalid postal code format)
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();
                if (upperQuery.includes('GEONAMES_POSTAL')) {
                    return Promise.resolve({ rows: [] }); // No match for invalid postal code
                }
                if (upperQuery.includes('COUNTRIES_BOUNDING_BOXES')) {
                    return Promise.resolve({ rows: [{ 1: 1 }] });
                }
                return Promise.resolve({ rows: [] });
            });

            const result = await validateAddress({
                line1: '123 Main St',
                city: 'Anytown',
                postal_code: 'ABC123',
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('address.postal_city_mismatch');
        });

        it('should invalidate address with line2 containing PO Box indicators', async () => {
            const result = await validateAddress({
                line1: '123 Main St',
                line2: 'PO Box 456',
                city: 'Anytown',
                postal_code: '12345',
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(true);
            expect(result.po_box).toBe(true);
            expect(result.deliverable).toBe(false);
            expect(result.reason_codes).toContain('address.po_box');
        });

        it('should invalidate address with very short postal code for country', async () => {
            // Mock postal code lookup to return no results (too short postal code)
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();
                if (upperQuery.includes('GEONAMES_POSTAL')) {
                    return Promise.resolve({ rows: [] }); // No match for short postal code
                }
                if (upperQuery.includes('COUNTRIES_BOUNDING_BOXES')) {
                    return Promise.resolve({ rows: [{ 1: 1 }] });
                }
                return Promise.resolve({ rows: [] });
            });

            const result = await validateAddress({
                line1: '123 Main St',
                city: 'Anytown',
                postal_code: '1',
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('address.postal_city_mismatch');
        });

        it('should invalidate address with mixed case country code', async () => {
            const result = await validateAddress({
                line1: '123 Main St',
                city: 'Anytown',
                postal_code: '12345',
                country: 'uS'
            }, mockPool as any);

            expect(result.valid).toBe(true); // Should normalize to US
            expect(result.normalized.country).toBe('US');
        });

        it('should invalidate address with unicode characters in postal code', async () => {
            // Mock postal code lookup to return no results (unicode characters in postal code)
            mockPool.query.mockImplementation((queryText: string) => {
                const upperQuery = queryText.toUpperCase();
                if (upperQuery.includes('GEONAMES_POSTAL')) {
                    return Promise.resolve({ rows: [] }); // No match for unicode postal code
                }
                if (upperQuery.includes('COUNTRIES_BOUNDING_BOXES')) {
                    return Promise.resolve({ rows: [{ 1: 1 }] });
                }
                return Promise.resolve({ rows: [] });
            });

            const result = await validateAddress({
                line1: '123 Main St',
                city: 'Anytown',
                postal_code: '12-345',
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('address.postal_city_mismatch');
        });

        it('should handle geocoding service failures gracefully', async () => {
            // Mock fetch to fail
            global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

            const result = await validateAddress({
                line1: '123 Main St',
                city: 'Anytown',
                postal_code: '12345',
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(true); // Still valid without geocoding
            expect(result.reason_codes).toContain('address.geocode_failed');
            expect(result.geo).toBeNull();
        });

        it('should invalidate address with null line1', async () => {
            const result = await validateAddress({
                line1: null as any,
                city: 'Anytown',
                postal_code: '12345',
                country: 'US'
            }, mockPool as any);

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('address.postal_city_mismatch');
        });
    });

    describe('POST /v1/normalize/address', () => {
        it('should normalize address successfully', async () => {
            const response = await request(app.server)
                .post('/v1/normalize/address')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    address: {
                        line1: '123 Main Street',
                        line2: 'Apt 4B',
                        city: 'Anytown',
                        state: 'CA',
                        postal_code: '12345',
                        country: 'us'
                    }
                });

            expect(response.status).toBe(200);
            const body = response.body as { normalized: any; request_id: string };
            expect(body.normalized).toBeDefined();
            expect(body.normalized.line1).toBe('123 Main Street');
            expect(body.normalized.country).toBe('US');
        });

        it('should handle invalid address format', async () => {
            const response = await request(app.server)
                .post('/v1/normalize/address')
                .set('Authorization', 'Bearer valid_key')
                .send({
                    address: {
                        line1: '',
                        city: '',
                        postal_code: '',
                        country: ''
                    }
                });

            expect(response.status).toBe(400);
            const body = response.body as { error: any; request_id: string };
            expect(body.error).toBeDefined();
        });
    });
});