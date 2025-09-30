import request from 'supertest';
// Import the necessary setup functions and mock instances
import { createApp, libphone, mockPool, mockTwilioInstance, setupBeforeAll } from './testSetup';
// Import the Fastify type for better code quality
import { FastifyInstance } from 'fastify';

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
            libphone.parsePhoneNumber.mockReturnValue(null);

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