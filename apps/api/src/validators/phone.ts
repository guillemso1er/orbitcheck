import crypto from "crypto";
import { parsePhoneNumber } from "libphonenumber-js";
import type { Redis } from "ioredis";

export async function validatePhone(
    phone: string,
    country?: string,
    redis?: Redis
): Promise<{
    valid: boolean;
    e164: string;
    country: string | null;
    reason_codes: string[];
    request_id: string;
    ttl_seconds: number;
}> {
    const input = JSON.stringify({ phone, country: country || "" });
    const hash = crypto.createHash('sha1').update(input).digest('hex');
    const cacheKey = `validator:phone:${hash}`;

    let result: any;

    if (redis) {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
    }

    const reason_codes: string[] = [];
    let e164 = "";
    let cc = country?.toUpperCase();

    try {
        const parsed = cc ? parsePhoneNumber(phone, cc as any) : parsePhoneNumber(phone as any);
        if (parsed && parsed.isValid()) {
            e164 = parsed.number;
            cc = parsed.country || cc;
        } else {
            reason_codes.push("phone.invalid_format");
        }
    } catch {
        reason_codes.push("phone.unparseable");
    }

    const valid = reason_codes.length === 0;
    result = {
        valid,
        e164,
        country: cc || null,
        reason_codes,
        request_id: crypto.randomUUID(),
        ttl_seconds: 30 * 24 * 3600,
    };

    if (redis) {
        await redis.set(cacheKey, JSON.stringify(result), 'EX', 30 * 24 * 3600);
    }

    return result;
}