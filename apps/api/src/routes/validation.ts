import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Pool } from "pg";
import IORedis from "ioredis";
import crypto from "crypto";
import { validateEmail } from "../validators/email";
import { validatePhone } from "../validators/phone";
import { validateAddress } from "../validators/address";
import { validateTaxId } from "../validators/taxid";
import { logEvent } from "../hooks";
import { env } from "../env";
import twilio from 'twilio';
import { securityHeader, unauthorizedResponse, rateLimitResponse, validationErrorResponse, generateRequestId, sendError, sendServerError } from "./utils";
import { HTTP_STATUS, ERROR_CODES, ERROR_MESSAGES, API_PATHS, TTL_EMAIL, TTL_ADDRESS, TTL_TAXID, TWILIO_CHANNEL_SMS } from "../constants";


export function registerValidationRoutes(app: FastifyInstance, pool: Pool, redis: IORedis) {
    app.post('/v1/validate/email', {
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
    }, async (req, rep) => {
        try {
            const request_id = generateRequestId();
            const { email } = req.body as { email: string };
            const out = await validateEmail(email, redis);
            await (rep as any).saveIdem?.(out);
            logEvent((req as any).project_id, 'validation', API_PATHS.VALIDATE_EMAIL, out.reason_codes, HTTP_STATUS.OK, {
                domain: out.normalized.split('@')[1],
                disposable: out.disposable,
                mx_found: out.mx_found,
            }, pool);
            return rep.send({ ...out, request_id });
        } catch (error) {
            console.error('Email validation error:', error);
            return sendServerError(req, rep, error, '/v1/validate/email', generateRequestId());
        }
    });

    app.post("/v1/validate/phone", {
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
    }, async (req, rep) => {
        try {
            const request_id = generateRequestId();
            const { phone, country, request_otp = false } = req.body as { phone: string; country?: string; request_otp?: boolean };
            const validation = await validatePhone(phone, country, redis);
            let verification_sid: string | null = null;
            if (validation.valid && request_otp && validation.e164 && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID) {
                const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
                try {
                    const verify = client.verify.v2.services(env.TWILIO_VERIFY_SERVICE_SID);
                    const verification = await verify.verifications.create({
                        to: validation.e164,
                        channel: TWILIO_CHANNEL_SMS
                    });
                    verification_sid = verification.sid;
                    validation.reason_codes.push("phone.otp_sent");
                } catch (err) {
                    req.log.error(err, "Failed to send OTP via Verify");
                    validation.reason_codes.push("phone.otp_send_failed");
                    verification_sid = null;
                }
            }
            const response = { ...validation, verification_sid };
            await (rep as any).saveIdem?.(response);
            logEvent((req as any).project_id, "validation", API_PATHS.VALIDATE_PHONE, response.reason_codes, HTTP_STATUS.OK, { request_otp, otp_status: verification_sid ? 'otp_sent' : 'no_otp' }, pool);
            return rep.send({ ...response, request_id });
        } catch (error) {
            return sendServerError(req, rep, error, '/v1/validate/phone', generateRequestId());
        }
    });

    app.post("/v1/validate/address", {
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
    }, async (req, rep) => {
        try {
            const request_id = generateRequestId();
            const { address } = req.body as any; // Cast because Fastify has already validated
            const out = await validateAddress(address, pool, redis);
            await (rep as any).saveIdem?.(out);
            logEvent((req as any).project_id, "validation", API_PATHS.VALIDATE_ADDRESS, out.reason_codes, HTTP_STATUS.OK, { po_box: out.po_box, postal_city_match: out.postal_city_match }, pool);
            return rep.send({ ...out, request_id });
        } catch (error) {
            return sendServerError(req, rep, error, '/v1/validate/address', generateRequestId());
        }
    });

    app.post("/v1/validate/tax-id", {
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
    }, async (req, rep) => {
        try {
            const request_id = generateRequestId();
            const { type, value, country } = req.body as { type: string; value: string; country?: string };
            const out = await validateTaxId({ type, value, country: country || "", redis });
            await (rep as any).saveIdem?.(out);
            logEvent((req as any).project_id, "validation", API_PATHS.VALIDATE_TAXID, out.reason_codes, HTTP_STATUS.OK, { type }, pool);
            return rep.send({ ...out, request_id });
        } catch (error) {
            return sendServerError(req, rep, error, '/v1/validate/tax-id', generateRequestId());
        }
    });
    // New endpoint for verifying OTP with Twilio Verify
    app.post("/v1/verify/phone", {
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
    }, async (req, rep) => {
        try {
            const request_id = generateRequestId();
            const { verification_sid, code } = req.body as { verification_sid: string; code: string };
            if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_VERIFY_SERVICE_SID) {
                return rep.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({ error: { code: ERROR_CODES.SERVER_ERROR, message: ERROR_MESSAGES[ERROR_CODES.SERVER_ERROR] } });
            }
            const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
            const verify = client.verify.v2.services(env.TWILIO_VERIFY_SERVICE_SID);
            const verificationCheck = await verify.verificationChecks.create({ code, to: verification_sid });
            const valid = verificationCheck.status === 'approved';
            const reason_codes = valid ? [] : ['phone.otp_invalid'];
            const response = { valid, reason_codes, request_id };
            await (rep as any).saveIdem?.(response);
            await logEvent((req as any).project_id, "verification", API_PATHS.VERIFY_PHONE, reason_codes, valid ? HTTP_STATUS.OK : HTTP_STATUS.BAD_REQUEST, { verified: valid }, pool);
            return rep.send(response);
        } catch (error) {
            return sendServerError(req, rep, error, '/v1/verify/phone', generateRequestId());
        }
    });
}