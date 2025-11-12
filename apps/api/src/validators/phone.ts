import crypto from "node:crypto";

import type { Redis } from "ioredis";
import { type CountryCode, parsePhoneNumberWithError } from "libphonenumber-js";


/**
 * Validates a phone number using libphonenumber-js for international format parsing.
 * Supports optional country hint for ambiguous numbers. Caches results in Redis (30 days TTL)
 * using SHA-1 hash of input for performance. Normalizes to E.164 format on success.
 *
 * @param phone - The phone number string to validate (e.g., "+1 555-123-4567" or "5551234567").
 * @param country - Optional two-letter ISO country code hint (e.g., "US") for parsing.
 * @param redis - Optional Redis client for caching validation results.
 * @returns {Promise<Object>} Validation result with E.164 normalized number, validity, country, reason codes, request ID, and TTL.
 */

export async function validatePhone(
    phone: string,
    country?: string,
    redis?: Redis
): Promise<{
    valid: boolean;
    e164: string;
    country: string | undefined;
    reason_codes: string[];
    request_id: string;
    ttl_seconds: number;
}> {
    const input = JSON.stringify({ phone, country: country || "" });
    const hash = crypto.createHash('sha1').update(input).digest('hex');
    const cacheKey = `validator:phone:${hash}`;

    let result: { valid: boolean; e164: string; country: string | undefined; reason_codes: string[]; request_id: string; ttl_seconds: number };

    if (redis) {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
    }

    // Handle null, undefined, or empty phone input
    if (!phone || typeof phone !== 'string' || phone.trim() === '') {
        return {
            valid: false,
            e164: "",
            country: country ? country.toUpperCase() : undefined,
            reason_codes: ['phone.invalid_format'],
            request_id: crypto.randomUUID(),
            ttl_seconds: 30 * 24 * 3600,
        };
    }

    const reason_codes: string[] = [];
    let e164 = "";
    let cc = country?.toUpperCase();

    try {
        const parsed = cc ? parsePhoneNumberWithError(phone, cc as CountryCode) : parsePhoneNumberWithError(phone);
        if (parsed && parsed.isValid()) {
            e164 = parsed.number;
            cc = parsed.country ? String(parsed.country) : cc;
        } else {
            reason_codes.push('phone.invalid');
        }
    } catch {
        reason_codes.push('phone.invalid');
    }

    const valid = reason_codes.length === 0;
    result = {
        valid,
        e164,
        country: cc || undefined,
        reason_codes,
        request_id: crypto.randomUUID(),
        ttl_seconds: 30 * 24 * 3600,
    };

    if (redis) {
        await redis.set(cacheKey, JSON.stringify(result), 'EX', 30 * 24 * 3600);
    }

    return result;
}