import request from 'supertest';
import { createApp, mockPool, setupBeforeAll } from './testSetup';
import * as twilio from 'twilio';

jest.mock('twilio');

describe('Phone OTP Verify', () => {
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

    it('should verify OTP successfully', async () => {
        const mockTwilio = {
            verify: {
                v2: {
                    services: jest.fn().mockReturnValue({
                        verificationChecks: {
                            create: jest.fn().mockReturnValue(Promise.resolve({ status: 'approved' }))
                        }
                    })
                }
            }
        };
        (twilio as any) = mockTwilio;

        const res = await request(app.server)
            .post('/v1/verify/phone')
            .set('Authorization', 'Bearer valid_key')
            .send({
                verification_sid: 'VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                code: '123456'
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.valid).toBe(true);
        expect(res.body.reason_codes).toEqual([]);
    });

    it('should return invalid for wrong OTP', async () => {
        const mockTwilio = {
            verify: {
                v2: {
                    services: jest.fn().mockReturnValue({
                        verificationChecks: {
                            create: jest.fn().mockReturnValue(Promise.resolve({ status: 'failed' }))
                        }
                    })
                }
            }
        };
        (twilio as any) = mockTwilio;

        const res = await request(app.server)
            .post('/v1/verify/phone')
            .set('Authorization', 'Bearer valid_key')
            .send({
                verification_sid: 'VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                code: 'wrongcode'
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.valid).toBe(false);
        expect(res.body.reason_codes).toEqual(['phone.otp_invalid']);
    });
});