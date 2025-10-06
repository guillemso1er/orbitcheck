
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import twilio from 'twilio';

import { type Redis as IORedisType } from 'ioredis';
import {  ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS, TWILIO_CHANNEL_SMS } from "../constants.js";
import { API_V1_ROUTES } from "@orbicheck/contracts";
// Import route constants from contracts package
// TODO: Update to use @orbicheck/contracts export once build issues are resolved
const ROUTES = {
  VALIDATE_EMAIL: API_V1_ROUTES.VALIDATE.VALIDATE_EMAIL_ADDRESS,
  VALIDATE_PHONE: API_V1_ROUTES.VALIDATE.VALIDATE_PHONE_NUMBER,
  VALIDATE_ADDRESS: API_V1_ROUTES.VALIDATE.VALIDATE_ADDRESS,
  VALIDATE_TAXID: API_V1_ROUTES.VALIDATE.VALIDATE_TAX_ID,
  VERIFY_PHONE: API_V1_ROUTES.VERIFY.VERIFY_PHONE_OTP,
};
import { environment } from "../env.js";
import { logEvent } from "../hooks.js";
import { validateAddress } from "../validators/address.js";
import { validateEmail } from "../validators/email.js";
import { validatePhone } from "../validators/phone.js";
import { validateTaxId } from "../validators/taxid.js";
import { generateRequestId, rateLimitResponse, securityHeader, sendServerError, unauthorizedResponse, validationErrorResponse } from "./utils.js";

export function registerValidationRoutes(app: FastifyInstance, pool: Pool, redis: IORedisType) {
    app.post(API_V1_ROUTES.VALIDATE.VALIDATE_EMAIL_ADDRESS, {
        schema: {
            summary: 'Validate Email Address',
            description: 'Performs a comprehensive validation of an email address, checking for format, domain reachability (MX records), and whether it belongs to a disposable email provider.',
            tags: ['Validation'],
            headers: securityHeader,
            body: {
                type: 'object',
                required: ['email'],
                properties: {
                    email: { type: 'string', description: 'The email address to validate.' }
                }
            },
            response: {
                200: {
                    description: 'Successful validation response',
                    type: 'object',
                    properties: {
                        valid: { type: 'boolean' },
                        normalized: { type: 'string' },
                        disposable: { type: 'boolean' },
                        mx_found: { type: 'boolean' },
                        reason_codes: { type: 'array', items: { type: 'string' } },
                        request_id: { type: 'string' },
                        ttl_seconds: { type: 'integer' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse,
            }
        }
    }, async (request, rep) => {
        try {
            const request_id = generateRequestId();
            const body = request.body as any;
            const { email } = body;
            const out = await validateEmail(email, redis);
            if (rep.saveIdem) {
                await rep.saveIdem(out);
            }
            await logEvent(request.project_id!, 'validation', API_V1_ROUTES.VALIDATE.VALIDATE_EMAIL_ADDRESS, out.reason_codes, HTTP_STATUS.OK, {
                domain: out.normalized.split('@')[1],
                disposable: out.disposable,
                mx_found: out.mx_found,
            }, pool);
            const response: any = { ...out, request_id };
            return rep.send(response);
        } catch (error) {
            console.error('Email validation error:', error);
            return sendServerError(request, rep, error, API_V1_ROUTES.VALIDATE.VALIDATE_EMAIL_ADDRESS, generateRequestId());
        }
    });

    app.post(API_V1_ROUTES.VALIDATE.VALIDATE_PHONE_NUMBER, {
        schema: {
            summary: 'Validate Phone Number',
            description: 'Validates a phone number and returns it in E.164 format. An optional country code can be provided as a hint.',
            tags: ['Validation'],
            headers: securityHeader,
            body: {
                type: 'object',
                required: ['phone'],
                properties: {
                    phone: { type: 'string', description: 'The phone number to validate.' },
                    country: { type: 'string', description: 'An optional two-letter (ISO 3166-1 alpha-2) country code hint.' },
                    request_otp: { type: 'boolean', description: 'Request to send an OTP for additional verification.', default: false }
                }
            },
            response: {
                200: {
                    description: 'Successful validation response',
                    type: 'object',
                    properties: {
                        valid: { type: 'boolean' },
                        e164: { type: 'string' },
                        country: { type: 'string', nullable: true },
                        reason_codes: { type: 'array', items: { type: 'string' } },
                        request_id: { type: 'string' },
                        ttl_seconds: { type: 'integer' },
                        verification_sid: { type: 'string', nullable: true, description: 'Twilio Verify SID for OTP verification if requested.' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse,
            }
        }
    }, async (request, rep) => {
        try {
            const request_id = generateRequestId();
            const body = request.body as any;
            const { phone, country, request_otp = false } = body;
            const validation = await validatePhone(phone, country, redis);
            let verification_sid: string | null = null;
            if (validation.valid && request_otp && validation.e164 && environment.TWILIO_ACCOUNT_SID && environment.TWILIO_AUTH_TOKEN && environment.TWILIO_VERIFY_SERVICE_SID) {
                const client = twilio(environment.TWILIO_ACCOUNT_SID, environment.TWILIO_AUTH_TOKEN);
                try {
                    const verify = client.verify.v2.services(environment.TWILIO_VERIFY_SERVICE_SID);
                    const verification = await verify.verifications.create({
                        to: validation.e164,
                        channel: TWILIO_CHANNEL_SMS
                    });
                    verification_sid = verification.sid;
                    validation.reason_codes.push("phone.otp_sent");
                } catch (error) {
                    request.log.error(error, "Failed to send OTP via Verify");
                    validation.reason_codes.push("phone.otp_send_failed");
                    verification_sid = null;
                }
            }
            const response = { ...validation, verification_sid };
            if (rep.saveIdem) {
                await rep.saveIdem(response);
            }
            await logEvent(request.project_id!, "validation", API_V1_ROUTES.VALIDATE.VALIDATE_PHONE_NUMBER, response.reason_codes, HTTP_STATUS.OK, { request_otp, otp_status: verification_sid ? 'otp_sent' : 'no_otp' }, pool);
            const phoneResponse: any = { ...response, request_id };
            return rep.send(phoneResponse);
        } catch (error) {
            return sendServerError(request, rep, error, API_V1_ROUTES.VALIDATE.VALIDATE_PHONE_NUMBER, generateRequestId());
        }
    });

    app.post(API_V1_ROUTES.VALIDATE.VALIDATE_ADDRESS, {
        schema: {
            summary: 'Validate Physical Address',
            description: 'Validates a physical address by normalizing it, checking for P.O. boxes, and verifying the postal code and city combination.',
            tags: ['Validation'],
            headers: securityHeader,
            body: {
                type: 'object',
                required: ['address'],
                properties: {
                    address: {
                        type: 'object',
                        required: ['line1', 'city', 'postal_code', 'country'],
                        properties: {
                            line1: { type: 'string' },
                            line2: { type: 'string' },
                            city: { type: 'string' },
                            postal_code: { type: 'string' },
                            state: { type: 'string' },
                            country: { type: 'string', minLength: 2, maxLength: 2 }
                        }
                    }
                }
            },
            response: {
                200: {
                    description: 'Successful validation response',
                    type: 'object',
                    properties: {
                        valid: { type: 'boolean' },
                        normalized: { type: 'object', properties: { line1: { type: 'string' }, line2: { type: 'string' }, city: { type: 'string' }, postal_code: { type: 'string' }, state: { type: 'string' }, country: { type: 'string' } } },
                        geo: { type: 'object', nullable: true, properties: { lat: { type: 'number' }, lng: { type: 'number' }, confidence: { type: 'number' } } },
                        po_box: { type: 'boolean' },
                        postal_city_match: { type: 'boolean' },
                        reason_codes: { type: 'array', items: { type: 'string' } },
                        request_id: { type: 'string' },
                        ttl_seconds: { type: 'integer' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse,
            }
        }
    }, async (request, rep) => {
        try {
            const request_id = generateRequestId();
            const body = request.body as any;
            const { address } = body;
            const out = await validateAddress(address, pool, redis);
            if (rep.saveIdem) {
                await rep.saveIdem(out);
            }
            await logEvent(request.project_id!, "validation", API_V1_ROUTES.VALIDATE.VALIDATE_ADDRESS, out.reason_codes, HTTP_STATUS.OK, { po_box: out.po_box, postal_city_match: out.postal_city_match }, pool);
            const response: any = { ...out, request_id };
            return rep.send(response);
        } catch (error) {
            return sendServerError(request, rep, error, API_V1_ROUTES.VALIDATE.VALIDATE_ADDRESS, generateRequestId());
        }
    });

    app.post(API_V1_ROUTES.VALIDATE.VALIDATE_TAX_ID, {
        schema: {
            summary: 'Validate Tax ID',
            description: 'Validates a given tax ID number for a specified type and country.',
            tags: ['Validation'],
            headers: securityHeader,
            body: {
                type: 'object',
                required: ['type', 'value'],
                properties: {
                    type: { type: 'string', description: 'The type of tax ID (e.g., "vat", "euvat", "br_cnpj").' },
                    value: { type: 'string', description: 'The tax ID number.' },
                    country: { type: 'string', description: 'An optional two-letter country code.' }
                }
            },
            response: {
                200: {
                    description: 'Successful validation response',
                    type: 'object',
                    properties: {
                        valid: { type: 'boolean' },
                        normalized: { type: 'string' },
                        reason_codes: { type: 'array', items: { type: 'string' } },
                        request_id: { type: 'string' }
                        // Add other fields returned by `validateTaxId` as needed
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse,
            }
        }
    }, async (request, rep) => {
        try {
            const request_id = generateRequestId();
            const body = request.body as any;
            const { type, value, country } = body;
            const out = await validateTaxId({ type, value, country: country || "", redis });
            if (rep.saveIdem) {
                await rep.saveIdem(out);
            }
            await logEvent(request.project_id!, "validation", API_V1_ROUTES.VALIDATE.VALIDATE_TAX_ID, out.reason_codes, HTTP_STATUS.OK, { type }, pool);
            const response: any = { ...out, request_id };
            return rep.send(response);
        } catch (error) {
            return sendServerError(request, rep, error, API_V1_ROUTES.VALIDATE.VALIDATE_TAX_ID, generateRequestId());
        }
    });
    // New endpoint for verifying OTP with Twilio Verify
    app.post(API_V1_ROUTES.VERIFY.VERIFY_PHONE_OTP, {
        schema: {
            summary: 'Verify Phone OTP',
            description: 'Verifies the OTP sent to the phone number using Twilio Verify.',
            tags: ['Validation'],
            headers: securityHeader,
            body: {
                type: 'object',
                required: ['verification_sid', 'code'],
                properties: {
                    verification_sid: { type: 'string', description: 'The Twilio Verify SID from the validation response.' },
                    code: { type: 'string', description: 'The 4-10 digit OTP code entered by the user.' }
                }
            },
            response: {
                200: {
                    description: 'Verification result',
                    type: 'object',
                    properties: {
                        valid: { type: 'boolean' },
                        reason_codes: { type: 'array', items: { type: 'string' } },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse,
            }
        }
    }, async (request, rep) => {
        try {
            const request_id = generateRequestId();
            const body = request.body as any;
            const { verification_sid, code } = body;
            if (!environment.TWILIO_ACCOUNT_SID || !environment.TWILIO_AUTH_TOKEN || !environment.TWILIO_VERIFY_SERVICE_SID) {
                return rep.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({ error: { code: ERROR_CODES.SERVER_ERROR, message: ERROR_MESSAGES[ERROR_CODES.SERVER_ERROR] } });
            }
            const client = twilio(environment.TWILIO_ACCOUNT_SID, environment.TWILIO_AUTH_TOKEN);
            const verify = client.verify.v2.services(environment.TWILIO_VERIFY_SERVICE_SID);
            const verificationCheck = await verify.verificationChecks.create({ code, to: verification_sid });
            const valid = verificationCheck.status === 'approved';
            const reason_codes = valid ? [] : ['phone.otp_invalid'];
            const response: any = { valid, reason_codes, request_id };
            await (rep as any).saveIdem?.(response);
            await logEvent((request as any).project_id, "verification", API_V1_ROUTES.VERIFY.VERIFY_PHONE_OTP, reason_codes, valid ? HTTP_STATUS.OK : HTTP_STATUS.BAD_REQUEST, { verified: valid }, pool);
            return rep.send(response);
        } catch (error) {
            return sendServerError(request, rep, error, API_V1_ROUTES.VERIFY.VERIFY_PHONE_OTP, generateRequestId());
        }
    });
}