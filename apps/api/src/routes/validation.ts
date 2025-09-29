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
            logEvent((req as any).project_id, 'validation', '/v1/validate/email', out.reason_codes, 200, {
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
                        verification_id: { type: 'string', nullable: true, description: 'ID for OTP verification if requested.' }
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
            let verification_id: string | null = null;
            if (validation.valid && request_otp && validation.e164 && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER) {
                verification_id = crypto.randomUUID();
                const otp = Math.floor(1000 + Math.random() * 9000).toString();
                const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
                try {
                    await client.messages.create({
                        body: `Your Orbicheck verification code is ${otp}`,
                        from: env.TWILIO_PHONE_NUMBER,
                        to: validation.e164
                    });
                    await redis.set(`otp:${verification_id}`, otp, 'EX', 300);
                    validation.reason_codes.push("phone.otp_sent");
                } catch (err) {
                    req.log.error(err, "Failed to send OTP");
                    validation.reason_codes.push("phone.otp_send_failed");
                    verification_id = null;
                }
            }
            const response = { ...validation, verification_id };
            await (rep as any).saveIdem?.(response);
            logEvent((req as any).project_id, "validation", "/validate/phone", response.reason_codes, 200, { request_otp, otp_status: verification_id ? 'otp_sent' : 'no_otp' }, pool);
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
            logEvent((req as any).project_id, "validation", "/validate/address", out.reason_codes, 200, { po_box: out.po_box, postal_city_match: out.postal_city_match }, pool);
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
            logEvent((req as any).project_id, "validation", "/validate/tax-id", out.reason_codes, 200, { type }, pool);
            return rep.send({ ...out, request_id });
        } catch (error) {
            return sendServerError(req, rep, error, '/v1/validate/tax-id', generateRequestId());
        }
    });
}