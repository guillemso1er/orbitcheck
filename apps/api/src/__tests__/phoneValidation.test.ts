import request from 'supertest';
// Import the necessary setup functions and mock instances
import { createApp, libphone, mockPool, mockRedisInstance, mockTwilioInstance, mockValidatePhone, setupBeforeAll } from './testSetup';
// Import the Fastify type for better code quality
import { FastifyInstance } from 'fastify';
const { validatePhone } = jest.requireActual('../validators/phone');
import crypto from 'crypto';

describe('Phone Validation Endpoints', () => {
    let app: FastifyInstance;

    // Set up the app once before all tests in this suite run
    beforeAll(async () => {
        await setupBeforeAll(); // Set up global mocks and environment
        app = await createApp();  // Await the async app creation
        await app.ready();      // Wait for the app to be fully loaded
    });

    // Close the app once after all tests have completed
    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    // Before each individual test, reset all mocks to a clean, default state
    beforeEach(() => {
        jest.clearAllMocks();

        // Default success mock for libphonenumber-js
        libphone.parsePhoneNumber.mockReturnValue({
            isValid: () => true,
            number: '+15551234567',
            country: 'US',
        });

        // Default success mock for Twilio
        mockTwilioInstance.messages.create.mockResolvedValue({ sid: 'test_sid' });

        // Add a default mock for the API key authentication to prevent auth failures
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

        // Reset Redis mocks
        mockRedisInstance.get.mockResolvedValue(null);
        mockRedisInstance.set.mockResolvedValue('OK');

        // Mock crypto.randomUUID
        jest.spyOn(crypto, 'randomUUID').mockReturnValue('123e4567-e89b-12d3-a456-426614174000');
    });

    describe('validatePhone function', () => {
        it('should validate a valid phone without country', async () => {
            const result = await validatePhone('+1 555 123 4567');

            expect(result.valid).toBe(true);
            expect(result.e164).toBe('+15551234567');
            expect(result.country).toBe('US');
            expect(result.reason_codes).toEqual([]);
            expect(libphone.parsePhoneNumber).toHaveBeenCalledWith('+1 555 123 4567');
        });

        it('should validate a valid phone with country hint', async () => {
            const result = await validatePhone('555 123 4567', 'US');

            expect(result.valid).toBe(true);
            expect(result.e164).toBe('+15551234567');
            expect(result.country).toBe('US');
            expect(libphone.parsePhoneNumber).toHaveBeenCalledWith('555 123 4567', 'US');
        });

        it('should invalidate phone with invalid format', async () => {
            libphone.parsePhoneNumber.mockReturnValueOnce(null);

            const result = await validatePhone('invalid');

            expect(result.valid).toBe(false);
            expect(result.e164).toBe('');
            expect(result.country).toBe(null);
            expect(result.reason_codes).toContain('phone.invalid_format');
        });

        it('should handle unparseable phone', async () => {
            libphone.parsePhoneNumber.mockImplementation(() => { throw new Error('Parse error'); });

            const result = await validatePhone('unparseable');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('phone.unparseable');
        });

        it('should use cache from Redis', async () => {
            const mockRedis = mockRedisInstance as any;
            const cachedResult = {
                valid: true,
                e164: '+15551234567',
                country: 'US',
                reason_codes: [],
                request_id: '123e4567-e89b-12d3-a456-426614174000',
                ttl_seconds: 2592000
            };
            const input = JSON.stringify({ phone: '+1 555 123 4567', country: '' });
            const hash = crypto.createHash('sha1').update(input).digest('hex');
            mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedResult));

            const result = await validatePhone('+1 555 123 4567', undefined, mockRedis);

            expect(result).toEqual(cachedResult);
            expect(mockRedis.get).toHaveBeenCalledWith(`validator:phone:${hash}`);
            expect(libphone.parsePhoneNumber).not.toHaveBeenCalled();
        });

        it('should cache result in Redis after computation', async () => {
            const mockRedis = mockRedisInstance as any;
            mockRedis.get.mockResolvedValue(null);

            await validatePhone('+1 555 123 4567', undefined, mockRedis);

            const input = JSON.stringify({ phone: '+1 555 123 4567', country: '' });
            const hash = crypto.createHash('sha1').update(input).digest('hex');
            expect(mockRedis.set).toHaveBeenCalledWith(
                `validator:phone:${hash}`,
                expect.stringContaining('+15551234567'),
                'EX',
                30 * 24 * 3600
            );
        });

        it('should use country from parsed number if no hint provided', async () => {
            libphone.parsePhoneNumber.mockReturnValueOnce({
                isValid: () => true,
                number: '+441234567890',
                country: 'GB'
            });

            const result = await validatePhone('+44 1234 567890');

            expect(result.country).toBe('GB');
        });
    });

    describe('POST /v1/validate/phone', () => {
        it('should validate a valid phone number', async () => {
            const res = await request(app.server)
                .post('/v1/validate/phone')
                .set('Authorization', 'Bearer valid_key')
                .send({ phone: '+1 555 123 4567' });

            expect(res.statusCode).toBe(200);
            expect(res.body.valid).toBe(true);
            expect(res.body.e164).toBe('+15551234567');
        });

        it('should handle invalid phone number when parser returns null', async () => {
            // Override the default mock to simulate an invalid number
            mockValidatePhone.mockResolvedValueOnce({
                valid: false,
                e164: '',
                country: null,
                reason_codes: ['phone.invalid_format'],
                request_id: 'test-request-id',
                ttl_seconds: 2592000
            });

            const res = await request(app.server)
                .post('/v1/validate/phone')
                .set('Authorization', 'Bearer valid_key')
                .send({ phone: 'invalid' });

            expect(res.statusCode).toBe(200);
            expect(res.body.valid).toBe(false);
            expect(res.body.reason_codes).toContain('phone.invalid_format');
        });

        it('should send OTP if requested', async () => {
            const res = await request(app.server)
                .post('/v1/validate/phone')
                .set('Authorization', 'Bearer valid_key')
                .send({ phone: '+1 555 123 4567', request_otp: true });

            expect(res.statusCode).toBe(200);
            expect(res.body.verification_sid).toBeDefined();
            expect(mockTwilioInstance.verify.v2.services().verifications.create).toHaveBeenCalled();
        });
    });
});