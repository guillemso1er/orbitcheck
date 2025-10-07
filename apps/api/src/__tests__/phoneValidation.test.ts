// Import the Fastify type for better code quality
// Import the necessary setup functions and mock instances
import crypto from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { CountryCode, ParsedNumber } from 'libphonenumber-js';
import request from 'supertest';

import { createApp, libphone, mockPool, mockRedisInstance, mockTwilioInstance, mockValidatePhone, setupBeforeAll } from './testSetup.js';

type ValidatePhoneResult = {
    valid: boolean;
    e164: string;
    country: string | null;
    reason_codes: string[];
    request_id?: string;
    ttl_seconds?: number;
};

interface _MockParsedNumber extends ParsedNumber {
    isValid: () => boolean;
    number: string;
    country: CountryCode;
}

const { validatePhone } = jest.requireActual('../validators/phone');

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
        libphone.parsePhoneNumberWithError.mockReturnValue({
            isValid: () => true,
            number: '+15551234567',
            country: 'US',
            phone: '15551234567',
        } as any);

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
        const mockRedis = mockRedisInstance as unknown as jest.Mocked<Redis>;
        mockRedis.get.mockResolvedValue(null);
        mockRedis.set.mockResolvedValue('OK');

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
            expect(libphone.parsePhoneNumberWithError).toHaveBeenCalledWith('+1 555 123 4567');
        });

        it('should validate a valid phone with country hint', async () => {
            const result = await validatePhone('555 123 4567', 'US');

            expect(result.valid).toBe(true);
            expect(result.e164).toBe('+15551234567');
            expect(result.country).toBe('US');
            expect(libphone.parsePhoneNumberWithError).toHaveBeenCalledWith('555 123 4567', 'US');
        });

        it('should invalidate phone with invalid format', async () => {
            libphone.parsePhoneNumberWithError.mockReturnValueOnce(null);

            const result = await validatePhone('invalid');

            expect(result.valid).toBe(false);
            expect(result.e164).toBe('');
            expect(result.country).toBe(null);
            expect(result.reason_codes).toContain('phone.invalid_format');
        });

        it('should handle unparseable phone', async () => {
            libphone.parsePhoneNumberWithError.mockImplementation(() => { throw new Error('Parse error'); });

            const result = await validatePhone('unparseable');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('phone.unparseable');
        });

        it('should use cache from Redis', async () => {
            const mockRedis = mockRedisInstance as unknown as jest.Mocked<Redis>;
            const cachedResult: ValidatePhoneResult = {
                valid: true,
                e164: '+15551234567',
                country: 'US',
                reason_codes: [],
                request_id: '123e4567-e89b-12d3-a456-426614174000',
                ttl_seconds: 2_592_000
            };
            const input = JSON.stringify({ phone: '+1 555 123 4567', country: '' });
            const hash = crypto.createHash('sha1').update(input).digest('hex');
            mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedResult));

            const result = await validatePhone('+1 555 123 4567', undefined, mockRedis);

            expect(result).toEqual(cachedResult);
            expect(mockRedis.get).toHaveBeenCalledWith(`validator:phone:${hash}`);
            expect(libphone.parsePhoneNumberWithError).not.toHaveBeenCalled();
        });

        it('should cache result in Redis after computation', async () => {
            const mockRedis = mockRedisInstance as unknown as jest.Mocked<Redis>;
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
            libphone.parsePhoneNumberWithError.mockReturnValueOnce({
                isValid: () => true,
                number: '+441234567890',
                country: 'GB',
                phone: '441234567890',
            } as any);

            const result = await validatePhone('+44 1234 567890');

            expect(result.country).toBe('GB');
        });
    });

    describe('POST /v1/validate/phone', () => {
        it('should validate a valid phone number', async () => {
            const response = await request(app.server)
                .post('/v1/validate/phone')
                .set('Authorization', 'Bearer valid_key')
                .send({ phone: '+1 555 123 4567' });

            expect(response.status).toBe(200);
            const body = response.body as ValidatePhoneResult;
            expect(body.valid).toBe(true);
            expect(body.e164).toBe('+15551234567');
        });

        it('should handle invalid phone number when parser returns null', async () => {
            // Override the default mock to simulate an invalid number
            mockValidatePhone.mockResolvedValueOnce({
                valid: false,
                e164: '',
                country: null,
                reason_codes: ['phone.invalid_format'],
                request_id: 'test-request-id',
                ttl_seconds: 2_592_000
            });

            const response = await request(app.server)
                .post('/v1/validate/phone')
                .set('Authorization', 'Bearer valid_key')
                .send({ phone: 'invalid' });

            expect(response.status).toBe(200);
            const body = response.body as ValidatePhoneResult;
            expect(body.valid).toBe(false);
            expect(body.reason_codes).toContain('phone.invalid_format');
        });

        it('should send OTP if requested', async () => {
            const response = await request(app.server)
                .post('/v1/validate/phone')
                .set('Authorization', 'Bearer valid_key')
                .send({ phone: '+1 555 123 4567', request_otp: true });

            expect(response.status).toBe(200);
            const body = response.body as { verification_sid: string };
            expect(body.verification_sid).toBeDefined();
            expect(mockTwilioInstance.verify.v2.services().verifications.create).toHaveBeenCalled();
        });
    });
});