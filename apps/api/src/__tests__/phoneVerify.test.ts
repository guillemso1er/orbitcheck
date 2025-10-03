import type { FastifyInstance } from 'fastify'; // Import the type for safety
import request from 'supertest';
import * as twilio from 'twilio';

import { createApp, setupBeforeAll } from './testSetup.js';

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
        const mockClient = {
            verify: {
                v2: {
                    services: jest.fn().mockReturnValue({
                        verificationChecks: {
                            create: jest.fn().mockResolvedValue({ status: 'approved' })
                        }
                    })
                }
            }
        };

        (twilio as unknown as jest.Mock).mockImplementation(() => mockClient);

        const response = await request(app.server)
            .post('/v1/verify/phone')
            .set('Authorization', 'Bearer valid_key')
            .send({
                verification_sid: 'VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                code: '123456'
            });

        expect(response.status).toBe(200);
        const body = response.body as { valid: boolean; reason_codes: string[] };
        expect(body.valid).toBe(true);
        expect(body.reason_codes).toEqual([]);
    });

    it('should return invalid for wrong OTP', async () => {
        const mockClient = {
            verify: {
                v2: {
                    services: jest.fn().mockReturnValue({
                        verificationChecks: {
                            create: jest.fn().mockResolvedValue({ status: 'failed' })
                        }
                    })
                }
            }
        };

        (twilio as unknown as jest.Mock).mockImplementation(() => mockClient);

        const response = await request(app.server)
            .post('/v1/verify/phone')
            .set('Authorization', 'Bearer valid_key')
            .send({
                verification_sid: 'VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                code: 'wrongcode'
            });

        expect(response.status).toBe(200);
        const body = response.body as { valid: boolean; reason_codes: string[] };
        expect(body.valid).toBe(false);
        expect(body.reason_codes).toEqual(['phone.otp_invalid']);
    });
});