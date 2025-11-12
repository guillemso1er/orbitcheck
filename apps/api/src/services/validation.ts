import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis as IORedisType } from "ioredis";
import type { Pool } from "pg";
import twilio from 'twilio';
import { TWILIO_CHANNEL_SMS } from "../config.js";
import { environment } from "../environment.js";
import { HTTP_STATUS } from "../errors.js";
import type { ValidateAddressData, ValidateAddressResponses, ValidateEmailData, ValidateEmailResponses, ValidateNameData, ValidateNameResponses, ValidatePhoneData, ValidatePhoneResponses, ValidateTaxIdData, ValidateTaxIdResponses, VerifyPhoneOtpData, VerifyPhoneOtpResponses } from "../generated/fastify/types.gen.js";
import { logEvent } from "../hooks.js";
import { validateAddress as validateAddressLogic } from "../validators/address.js";
import { validateEmail } from "../validators/email.js";
import { validatePhone } from "../validators/phone.js";
import { validateTaxId as validateTaxIdLogic } from "../validators/taxid.js";
import { generateRequestId, sendServerError } from "./utils.js";

export async function validateEmailAddress(
    request: FastifyRequest<{ Body: ValidateEmailData['body'] }>,
    rep: FastifyReply,
    pool: Pool,
    redis: IORedisType
): Promise<FastifyReply<{ Body: ValidateEmailResponses }>> {
    try {
        const request_id = generateRequestId();
        const body = request.body as ValidateEmailData['body'];
        const { email } = body;

        if (!email || (typeof email === 'string' && email.trim() === '')) {
            return rep.status(400).send({
                error: {
                    code: 'validation_error',
                    message: 'Email field cannot be empty'
                },
                request_id
            });
        }

        let out;
        try {
            out = await validateEmail(email, redis);
        } catch (error) {
            out = {
                valid: false,
                normalized: email.toLowerCase().trim(),
                reason_codes: ['email.invalid_format'],
                disposable: false,
                mx_found: false,
                request_id,
                ttl_seconds: 30 * 24 * 3600
            };
        }

        if (rep.saveIdem) {
            await rep.saveIdem(out);
        }
        await logEvent((request as any).project_id!, 'validation', '/v1/validate/email', out.reason_codes, HTTP_STATUS.OK, {
            domain: out.normalized.split('@')[1],
            disposable: out.disposable,
            mx_found: out.mx_found,
        }, pool);
        const response: ValidateEmailResponses[200] = { ...out, request_id };
        return rep.send(response);
    } catch (error) {
        console.error('Email validation error:', error);
        return sendServerError(request, rep, error, '/v1/validate/email', generateRequestId());
    }
}

export async function validatePhoneNumber(
    request: FastifyRequest<{ Body: ValidatePhoneData['body'] }>,
    rep: FastifyReply,
    pool: Pool,
    redis: IORedisType
): Promise<FastifyReply<{ Body: ValidatePhoneResponses }>> {
    try {
        const request_id = generateRequestId();
        const body = request.body as ValidatePhoneData['body'];
        const { phone, country, request_otp = false } = body;
        const validation = await validatePhone(phone, country, redis);
        let verification_sid: string | undefined = undefined;

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
                verification_sid = undefined;
            }
        }
        const response = { ...validation, verification_sid };
        if (rep.saveIdem) {
            await rep.saveIdem(response);
        }
        await logEvent((request as any).project_id!, "validation", "/v1/validate/phone", response.reason_codes, HTTP_STATUS.OK, { request_otp, otp_status: verification_sid ? 'otp_sent' : 'no_otp' }, pool);
        const phoneResponse: ValidatePhoneResponses[200] = { ...response, request_id };
        return rep.send(phoneResponse);
    } catch (error) {
        return sendServerError(request, rep, error, "/v1/validate/phone", generateRequestId());
    }
}

export async function validateAddress(
    request: FastifyRequest<{ Body: ValidateAddressData['body'] }>,
    rep: FastifyReply,
    pool: Pool,
    redis: IORedisType
): Promise<FastifyReply<{ Body: ValidateAddressResponses }>> {
    try {
        const request_id = generateRequestId();
        const body = request.body as ValidateAddressData['body'];
        const { address } = body;
        
        // Validate required fields at the service level
        if (!address ||
            !address.line1?.trim() ||
            !address.city?.trim() ||
            !address.postal_code?.trim() ||
            !address.country?.trim()) {
            return rep.status(400).send({
                error: {
                    code: 'validation_error',
                    message: 'Missing required address fields: line1, city, postal_code, country'
                },
                request_id
            });
        }
        
        const out = await validateAddressLogic(address, pool, redis);
        if (rep.saveIdem) {
            await rep.saveIdem(out);
        }
        await logEvent((request as any).project_id!, "validation", "/v1/validate/address", out.reason_codes, HTTP_STATUS.OK, { po_box: out.po_box, postal_city_match: out.postal_city_match }, pool);
        const response: ValidateAddressResponses[200] = { ...out, request_id };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, "/v1/validate/address", generateRequestId());
    }
}

export async function validateTaxId(
    request: FastifyRequest<{ Body: ValidateTaxIdData['body'] }>,
    rep: FastifyReply,
    pool: Pool,
    redis: IORedisType
): Promise<FastifyReply<{ Body: ValidateTaxIdResponses }>> {
    try {
        const request_id = generateRequestId();
        const body = request.body as ValidateTaxIdData['body'];
        const { type, value, country } = body;
        const out = await validateTaxIdLogic({ type, value: value, country: country || "", redis });
        if (rep.saveIdem) {
            await rep.saveIdem(out);
        }
        await logEvent((request as any).project_id!, "validation", "/v1/validate/tax_id", out.reason_codes, HTTP_STATUS.OK, { type }, pool);
        const response: ValidateTaxIdResponses[200] = { ...out, request_id };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, "/v1/validate/tax_id", generateRequestId());
    }
}

export async function validateName(
    request: FastifyRequest<{ Body: ValidateNameData['body'] }>,
    rep: FastifyReply
): Promise<FastifyReply<{ Body: ValidateNameResponses }>> {
    try {
        const request_id = generateRequestId();
        const body = request.body as ValidateNameData['body'];
        const { name } = body;

        if (!name || (typeof name === 'string' && name.trim() === '')) {
            return rep.status(400).send({
                error: {
                    code: 'validation_error',
                    message: 'Name field cannot be empty'
                },
                request_id
            });
        }

        const { validateName } = await import('../validators/name.js');
        const out = validateName(name);
        const response: ValidateNameResponses[200] = { ...out, request_id };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, "/v1/validate/name", generateRequestId());
    }
}

export async function verifyPhoneOtp(
    request: FastifyRequest<{ Body: VerifyPhoneOtpData['body'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply<{ Body: VerifyPhoneOtpResponses }>> {
    try {
        const request_id = generateRequestId();
        const body = request.body as VerifyPhoneOtpData['body'];
        const { verification_sid, code } = body;
        if (!environment.TWILIO_ACCOUNT_SID || !environment.TWILIO_AUTH_TOKEN || !environment.TWILIO_VERIFY_SERVICE_SID) {
            return rep.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({ error: { code: 'SERVER_ERROR', message: 'Server configuration error' } });
        }
        const client = twilio(environment.TWILIO_ACCOUNT_SID, environment.TWILIO_AUTH_TOKEN);
        const verify = client.verify.v2.services(environment.TWILIO_VERIFY_SERVICE_SID);
        const verificationCheck = await verify.verificationChecks.create({ code, to: verification_sid });
        const valid = verificationCheck.status === 'approved';
        const reason_codes = valid ? [] : ['phone.otp_invalid'];
        const response: VerifyPhoneOtpResponses[200] = { valid, reason_codes, request_id };
        await (rep as any).saveIdem?.(response);
        await logEvent((request as any).project_id, "verification", "/v1/verify/phone_otp", reason_codes, valid ? HTTP_STATUS.OK : HTTP_STATUS.BAD_REQUEST, { verified: valid }, pool);
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, "/v1/verify/phone_otp", generateRequestId());
    }
}