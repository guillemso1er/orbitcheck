import { isEmailValid } from '@hapi/address';

import crypto from "crypto";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import IORedis from "ioredis";
import { parsePhoneNumber } from "libphonenumber-js";
import fetch from "node-fetch";
import dns from "node:dns/promises";
import url from 'node:url';
import { Pool } from "pg";
import { getDomain as getRegistrableDomain } from 'tldts';
import twilio from 'twilio';
import { env } from "./env";
import { detectPoBox, normalizeAddress } from "./validators/address";
import { validateTaxId } from "./validators/taxid";

// --- Reusable Schema Components ---
const errorSchema = {
    type: 'object',
    properties: {
        error: {
            type: 'object',
            properties: {
                code: { type: 'string' },
                message: { type: 'string' }
            }
        }
    }
};

const securityHeader = {
    type: 'object',
    properties: {
        'authorization': { type: 'string' },
        'idempotency-key': { type: 'string' }
    },
    required: ['authorization']
};

const unauthorizedResponse = { 401: { description: 'Unauthorized', ...errorSchema } };
const rateLimitResponse = { 429: { description: 'Rate Limit Exceeded', ...errorSchema } };
const validationErrorResponse = { 400: { description: 'Validation Error', ...errorSchema } };


async function auth(req: FastifyRequest, rep: FastifyReply, pool: Pool) {
    const header = req.headers["authorization"];
    if (!header || !header.startsWith("Bearer ")) {
        return rep.status(401).send({ error: { code: "unauthorized", message: "Missing API key" } });
    }
    const key = header.substring(7).trim();
    const prefix = key.slice(0, 6);

    // Instead of bcrypt hash, we will store and compare a SHA-256 hash.
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');

    // The query now looks for the full hash. This is much more secure and efficient.
    const { rows } = await pool.query(
        "select id, project_id from api_keys where hash=$1 and prefix=$2 and status='active'",
        [keyHash, prefix]
    );

    if (rows.length === 0) {
        return rep.status(401).send({ error: { code: "unauthorized", message: "Invalid API key" } });
    }

    (req as any).project_id = rows[0].project_id;
}

async function rateLimit(req: FastifyRequest, rep: FastifyReply, redis: IORedis) {
    const key = `rl:${(req as any).project_id}:${req.ip}`;
    const limit = env.RATE_LIMIT_COUNT;
    const ttl = 60;
    const cnt = await redis.incr(key);
    if (cnt === 1) await redis.expire(key, ttl);
    if (cnt > limit) return rep.status(429).send({ error: { code: "rate_limited", message: "Rate limit exceeded" } });
}

async function idempotency(req: FastifyRequest, rep: FastifyReply, redis: IORedis) {
    const idem = req.headers["idempotency-key"];
    if (!idem || typeof idem !== "string") return;
    const cacheKey = `idem:${(req as any).project_id}:${idem}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
        rep.header("x-idempotent-replay", "1");
        return rep.send(JSON.parse(cached));
    }
    (rep as any).saveIdem = async (payload: any) => {
        await redis.set(cacheKey, JSON.stringify(payload), "EX", 60 * 60 * 24);
    };
}

async function logEvent(project_id: string, type: string, endpoint: string, reason_codes: string[], status: number, meta: any, pool: Pool) {
    await pool.query(
        "insert into logs (project_id, type, endpoint, reason_codes, status, meta) values ($1, $2, $3, $4, $5, $6)",
        [project_id, type, endpoint, reason_codes, status, meta]
    );
}

export function registerRoutes(app: FastifyInstance, pool: Pool, redis: IORedis) {
    app.addHook("preHandler", async (req, rep) => {
        if (req.url.startsWith("/health") || req.url.startsWith("/documentation")) return;
        await auth(req, rep, pool);
        await rateLimit(req, rep, redis);
        await idempotency(req, rep, redis);
    });


    const withTimeout = (p: Promise<any>, ms = 1200) => {
        let timer: NodeJS.Timeout;

        // The timeout promise
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('ETIMEDOUT')), ms);
        });

        // Race the input promise against the timeout
        return Promise.race([p, timeoutPromise])
            .finally(() => {
                // CRITICAL: Always clear the timer when the race is over.
                clearTimeout(timer);
            });
    };

    app.post('/validate/email', {
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
        // --- 1. INITIALIZATION ---
        // Initialize all state variables with safe defaults.
        const reason_codes: string[] = [];
        let mx_found = false;
        let disposable = false;
        let normalizedEmail = '';
        let registrableDomain = '';
        let asciiHost = '';
        let isFormatValid = false;

        // --- 2. GLOBAL ERROR HANDLING ---
        try {
            // --- 3. PARSING & NORMALIZATION ---
            const body = (req.body ?? {}) as { email: string };
            const raw = String(body.email || '').trim();
            const [local, host = ''] = raw.split('@');

            asciiHost = url.domainToASCII(host || '');
            normalizedEmail = (local || '') + (host ? '@' + asciiHost.toLowerCase() : '');
            registrableDomain = asciiHost ? (getRegistrableDomain(asciiHost) || asciiHost) : '';

            // --- 4. FORMAT VALIDATION ---
            isFormatValid = isEmailValid(normalizedEmail, { /* ... your options ... */ });

            if (!isFormatValid) {
                reason_codes.push('email.invalid_format');
            }

            // --- 5. NETWORK-DEPENDENT VALIDATIONS ---
            if (isFormatValid && asciiHost) {
                // --- DNS LOOKUP (with MX and A/AAAA fallback) ---
                try {
                    // First, try to resolve MX records.
                    const recs = (await withTimeout(dns.resolveMx(asciiHost))) as { exchange: string }[];
                    mx_found = !!(recs && recs.length > 0 && recs[0].exchange !== '.');
                } catch (mxError) {
                    // If MX lookup fails (e.g., no records found), fall back to checking for A/AAAA.
                    req.log.warn({ domain: asciiHost, error: mxError }, 'MX lookup failed, falling back to A/AAAA check.');
                    try {
                        const [a, aaaa] = await Promise.allSettled([
                            withTimeout(dns.resolve4(asciiHost)),
                            withTimeout(dns.resolve6(asciiHost)),
                        ]);
                        const hasA = a.status === 'fulfilled' && (a.value as string[])?.length > 0;
                        const hasAAAA = aaaa.status === 'fulfilled' && (aaaa.value as string[])?.length > 0;
                        mx_found = hasA || hasAAAA; // Domain is valid if it has either A or AAAA record.
                    } catch (aError) {
                        req.log.warn({ domain: asciiHost, error: aError }, 'A/AAAA lookup also failed.');
                        mx_found = false;
                    }
                }

                if (!mx_found) {
                    reason_codes.push('email.mx_not_found');
                }

                // --- REDIS LOOKUP for disposable domains ---
                const isDisposable =
                    (await redis.sismember('disposable_domains', asciiHost)) ||
                    (registrableDomain && (await redis.sismember('disposable_domains', registrableDomain)));

                if (isDisposable) {
                    disposable = true;
                    reason_codes.push('email.disposable_domain');
                }
            }
        } catch (error) {
            // Global safety net
            req.log.error(error, "A critical error occurred during email validation");
            mx_found = false;
            disposable = false;
            reason_codes.push('email.server_error');
        }

        // --- 6. CONSTRUCT AND SEND RESPONSE ---
        const response = {
            valid: isFormatValid && mx_found && !disposable,
            normalized: normalizedEmail,
            disposable,
            mx_found,
            reason_codes,
            request_id: crypto.randomUUID(),
            ttl_seconds: 30 * 24 * 3600,
        };

        await (rep as any).saveIdem?.(response);
        await logEvent((req as any).project_id, 'validation', '/validate/email', reason_codes, 200, {
            domain: registrableDomain || asciiHost,
            disposable,
            mx_found,
        }, pool);

        return rep.send(response);

    });

    app.post("/validate/phone", {
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
        const { phone, country, request_otp = false } = req.body as { phone: string; country?: string; request_otp?: boolean };
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
        let verification_id: string | null = null;
        if (valid && request_otp && e164 && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER) {
            verification_id = crypto.randomUUID();
            const otp = Math.floor(1000 + Math.random() * 9000).toString();
            const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
            try {
                await client.messages.create({
                    body: `Your Orbicheck verification code is ${otp}`,
                    from: env.TWILIO_PHONE_NUMBER,
                    to: e164
                });
                await redis.set(`otp:${verification_id}`, otp, 'EX', 300);
                reason_codes.push("phone.otp_sent");
            } catch (err) {
                req.log.error(err, "Failed to send OTP");
                reason_codes.push("phone.otp_send_failed");
                verification_id = null;
            }
        }
        const response = { valid, e164, country: cc || null, reason_codes, request_id: crypto.randomUUID(), ttl_seconds: 30 * 24 * 3600, verification_id };
        await (rep as any).saveIdem?.(response);
        await logEvent((req as any).project_id, "validation", "/validate/phone", reason_codes, 200, { request_otp, otp_status: verification_id ? 'otp_sent' : 'no_otp' }, pool);
        return rep.send(response);
    });

    app.post("/validate/address", {
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
        const { address } = req.body as any; // Cast because Fastify has already validated
        const reason_codes: string[] = [];
        const norm = await normalizeAddress(address);
        const po_box = detectPoBox(norm.line1) || detectPoBox(norm.line2);
        if (po_box) reason_codes.push("address.po_box");

        const { rows } = await pool.query(
            "select 1 from geonames_postal where country_code=$1 and postal_code=$2 and (lower(place_name)=lower($3) or lower(admin_name1)=lower($3)) limit 1",
            [norm.country.toUpperCase(), norm.postal_code, norm.city]
        );
        const postal_city_match = rows.length > 0;
        if (!postal_city_match) reason_codes.push("address.postal_city_mismatch");

        let geo: any = null;
        try {
            const q = encodeURIComponent(`${norm.line1} ${norm.city} ${norm.state} ${norm.postal_code} ${norm.country}`);
            if (env.LOCATIONIQ_KEY) {
                const url = `https://us1.locationiq.com/search.php?key=${env.LOCATIONIQ_KEY}&q=${q}&format=json&addressdetails=1`;
                const r = await fetch(url, { headers: { "User-Agent": "Orbicheck/0.1" } });
                const j = await r.json();
                if (Array.isArray(j) && j[0]) geo = { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), confidence: 0.9 };
            } else {
                const url = `${env.NOMINATIM_URL}/search?format=json&limit=1&q=${q}`;
                const r = await fetch(url, { headers: { "User-Agent": "Orbicheck/0.1" } });
                const j = await r.json();
                if (Array.isArray(j) && j[0]) geo = { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), confidence: 0.7 };
            }
        } catch { /* ignore */ }

        const valid = postal_city_match && !po_box;
        const response = { valid, normalized: norm, geo, po_box, postal_city_match, reason_codes, request_id: crypto.randomUUID(), ttl_seconds: 7 * 24 * 3600 };
        await (rep as any).saveIdem?.(response);
        await logEvent((req as any).project_id, "validation", "/validate/address", reason_codes, 200, { po_box, postal_city_match }, pool);
        return rep.send(response);
    });

    app.post("/validate/tax-id", {
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
        const { type, value, country } = req.body as { type: string; value: string; country?: string };
        const out = await validateTaxId({ type, value, country: country || "" });
        await (rep as any).saveIdem?.(out);
        await logEvent((req as any).project_id, "validation", "/validate/tax-id", out.reason_codes, 200, { type }, pool);
        return rep.send(out);
    });

    app.get("/logs", {
        schema: {
            summary: 'Get Event Logs',
            description: 'Retrieves the 100 most recent event logs for the project associated with the API key.',
            tags: ['Data Retrieval'],
            headers: securityHeader,
            response: {
                200: {
                    description: 'A list of log entries.',
                    type: 'object',
                    properties: {
                        data: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    type: { type: 'string' },
                                    endpoint: { type: 'string' },
                                    reason_codes: { type: 'array', items: { type: 'string' } },
                                    status: { type: 'integer' },
                                    created_at: { type: 'string', format: 'date-time' }
                                }
                            }
                        },
                        next_cursor: { type: 'string', nullable: true }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse
            }
        }
    }, async (req, rep) => {
        const project_id = (req as any).project_id;
        const { rows } = await pool.query("select id, type, endpoint, reason_codes, status, created_at from logs where project_id=$1 order by created_at desc limit 100", [project_id]);
        return rep.send({ data: rows, next_cursor: null });
    });

    app.get("/usage", {
        schema: {
            summary: 'Get Usage Statistics',
            description: 'Retrieves usage statistics for the last 31 days for the project associated with the API key.',
            tags: ['Data Retrieval'],
            headers: securityHeader,
            response: {
                200: {
                    description: 'A summary of usage data.',
                    type: 'object',
                    properties: {
                        period: { type: 'string', example: 'month' },
                        totals: {
                            type: 'object',
                            properties: {
                                validations: { type: 'integer' },
                                orders: { type: 'integer' }
                            }
                        },
                        by_day: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    date: { type: 'string', format: 'date' },
                                    validations: { type: 'integer' },
                                    orders: { type: 'integer' }
                                }
                            }
                        },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse
            }
        }
    }, async (req, rep) => {
        const project_id = (req as any).project_id;
        const { rows } = await pool.query("select date, validations, orders from usage_daily where project_id=$1 order by date desc limit 31", [project_id]);
        const totals = rows.reduce((acc: any, r: any) => ({ ...acc, validations: acc.validations + (r.validations || 0), orders: acc.orders + (r.orders || 0) }), { validations: 0, orders: 0 });
        return rep.send({ period: "month", totals, by_day: rows, request_id: crypto.randomUUID() });
    });

    app.post('/dedupe/customer', {
        schema: {
            summary: 'Deduplicate Customer',
            description: 'Searches for existing customers using deterministic (exact) and fuzzy matching on email, phone, and name.',
            tags: ['Deduplication'],
            headers: securityHeader,
            body: {
                type: 'object',
                required: ['email', 'first_name', 'last_name'],
                properties: {
                    email: { type: 'string' },
                    phone: { type: 'string' },
                    first_name: { type: 'string' },
                    last_name: { type: 'string' }
                }
            },
            response: {
                200: {
                    description: 'Deduplication results',
                    type: 'object',
                    properties: {
                        matches: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    similarity_score: { type: 'number' },
                                    match_type: { type: 'string', enum: ['exact_email', 'exact_phone', 'fuzzy_name', 'fuzzy_email', 'fuzzy_phone'] },
                                    data: { type: 'object' }
                                }
                            }
                        },
                        suggested_action: { type: 'string', enum: ['create_new', 'merge_with', 'review'] },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse
            }
        }
    }, async (req, rep) => {
        const { email, phone, first_name, last_name } = req.body as any;
        const project_id = (req as any).project_id;
        const reason_codes: string[] = [];
        const matches: any[] = [];
        const request_id = crypto.randomUUID();

        try {
            // Deterministic matches
            if (email) {
                const { rows: emailMatches } = await pool.query(
                    'SELECT id, email, phone, first_name, last_name, similarity(email, $1) as score FROM customers WHERE project_id = $2 AND email = $1',
                    [email, project_id]
                );
                emailMatches.forEach(row => {
                    if (row.id) {
                        matches.push({
                            id: row.id,
                            similarity_score: 1.0,
                            match_type: 'exact_email',
                            data: row
                        });
                    }
                });
            }

            if (phone) {
                const { rows: phoneMatches } = await pool.query(
                    'SELECT id, email, phone, first_name, last_name, similarity(phone, $1) as score FROM customers WHERE project_id = $2 AND phone = $1',
                    [phone, project_id]
                );
                phoneMatches.forEach(row => {
                    if (row.id) {
                        matches.push({
                            id: row.id,
                            similarity_score: 1.0,
                            match_type: 'exact_phone',
                            data: row
                        });
                    }
                });
            }

            // Fuzzy matches
            const full_name = `${first_name || ''} ${last_name || ''}`.trim();
            if (full_name) {
                const { rows: nameMatches } = await pool.query(
                    `SELECT id, email, phone, first_name, last_name,
                     similarity((first_name || ' ' || last_name), $1) as name_score,
                     similarity(email, $2) as email_score,
                     similarity(phone, $3) as phone_score
                     FROM customers
                     WHERE project_id = $4
                     AND similarity((first_name || ' ' || last_name), $1) > 0.3
                     ORDER BY name_score DESC LIMIT 5`,
                    [full_name, email || '', phone || '', project_id]
                );
                nameMatches.forEach(row => {
                    const score = Math.max(row.name_score, row.email_score || 0, row.phone_score || 0);
                    if (score > 0.3) {
                        matches.push({
                            id: row.id,
                            similarity_score: score,
                            match_type: score === row.name_score ? 'fuzzy_name' : (score === row.email_score ? 'fuzzy_email' : 'fuzzy_phone'),
                            data: row
                        });
                    }
                });
            }
            // Sort matches by score descending
            matches.sort((a, b) => b.similarity_score - a.similarity_score);

            let suggested_action = 'create_new';
            if (matches.length > 0) {
                const bestMatch = matches[0];
                if (bestMatch.similarity_score === 1.0) {
                    suggested_action = 'merge_with';
                } else if (bestMatch.similarity_score > 0.8) {
                    suggested_action = 'review';
                }
            }

            const response = { matches, suggested_action, request_id };
            await (rep as any).saveIdem?.(response);
            await logEvent(project_id, 'dedupe', '/dedupe/customer', reason_codes, 200, { matches_count: matches.length, suggested_action }, pool);
            return rep.send(response);

        } catch (error) {
            req.log.error(error);
            reason_codes.push('dedupe.server_error');
            const response = { matches: [], suggested_action: 'create_new', request_id, reason_codes };
            await logEvent(project_id, 'dedupe', '/dedupe/customer', reason_codes, 500, {}, pool);
            return rep.status(500).send(response);
        }
    });

    app.post('/dedupe/address', {
        schema: {
            summary: 'Deduplicate Address',
            description: 'Searches for existing addresses using deterministic (exact postal/city/country) and fuzzy matching on address components.',
            tags: ['Deduplication'],
            headers: securityHeader,
            body: {
                type: 'object',
                required: ['line1', 'city', 'postal_code', 'country'],
                properties: {
                    line1: { type: 'string' },
                    line2: { type: 'string' },
                    city: { type: 'string' },
                    state: { type: 'string' },
                    postal_code: { type: 'string' },
                    country: { type: 'string', minLength: 2, maxLength: 2 }
                }
            },
            response: {
                200: {
                    description: 'Deduplication results',
                    type: 'object',
                    properties: {
                        matches: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    similarity_score: { type: 'number' },
                                    match_type: { type: 'string', enum: ['exact_postal', 'fuzzy_address'] },
                                    data: { type: 'object' }
                                }
                            }
                        },
                        suggested_action: { type: 'string', enum: ['create_new', 'merge_with', 'review'] },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse
            }
        }
    }, async (req, rep) => {
        const { line1, line2, city, state, postal_code, country } = req.body as any;
        const project_id = (req as any).project_id;
        const reason_codes: string[] = [];
        const matches: any[] = [];
        const request_id = crypto.randomUUID();

        try {
            // Normalize the input address
            const normAddr = await normalizeAddress({ line1, line2: line2 || '', city, state: state || '', postal_code, country });
            const addrKey = `${normAddr.line1} ${normAddr.line2} ${normAddr.city} ${normAddr.state} ${normAddr.postal_code} ${normAddr.country}`.trim();

            // Deterministic match: exact postal_code + city + country
            const { rows: exactMatches } = await pool.query(
                'SELECT id, line1, line2, city, state, postal_code, country, lat, lng, similarity((line1 || \' \' || line2 || \' \' || city || \' \' || state || \' \' || postal_code || \' \' || country), $1) as score FROM addresses WHERE project_id = $2 AND postal_code = $3 AND lower(city) = lower($4) AND country = $5',
                [addrKey, project_id, normAddr.postal_code, normAddr.city, normAddr.country]
            );
            exactMatches.forEach(row => {
                if (row.id) {
                    matches.push({
                        id: row.id,
                        similarity_score: 1.0,
                        match_type: 'exact_postal',
                        data: row
                    });
                }
            });

            // Fuzzy matches
            const { rows: fuzzyMatches } = await pool.query(
                `SELECT id, line1, line2, city, state, postal_code, country, lat, lng,
                 similarity((line1 || ' ' || line2 || ' ' || city || ' ' || state || ' ' || postal_code || ' ' || country), $1) as score
                 FROM addresses
                 WHERE project_id = $2
                 AND similarity((line1 || ' ' || line2 || ' ' || city || ' ' || state || ' ' || postal_code || ' ' || country), $1) > 0.6
                 ORDER BY score DESC LIMIT 5`,
                [addrKey, project_id]
            );
            fuzzyMatches.forEach(row => {
                if (row.id && !matches.some(m => m.id === row.id)) {  // Avoid duplicates
                    matches.push({
                        id: row.id,
                        similarity_score: row.score,
                        match_type: 'fuzzy_address',
                        data: row
                    });
                }
            });

            // Sort matches by score descending
            matches.sort((a, b) => b.similarity_score - a.similarity_score);

            let suggested_action = 'create_new';
            if (matches.length > 0) {
                const bestMatch = matches[0];
                if (bestMatch.similarity_score === 1.0) {
                    suggested_action = 'merge_with';
                } else if (bestMatch.similarity_score > 0.8) {
                    suggested_action = 'review';
                }
            }

            const response = { matches, suggested_action, request_id };
            await (rep as any).saveIdem?.(response);
            await logEvent(project_id, 'dedupe', '/dedupe/address', reason_codes, 200, { matches_count: matches.length, suggested_action }, pool);
            return rep.send(response);

        } catch (error) {
            req.log.error(error);
            reason_codes.push('dedupe.server_error');
            const response = { matches: [], suggested_action: 'create_new', request_id, reason_codes };
            await logEvent(project_id, 'dedupe', '/dedupe/address', reason_codes, 500, {}, pool);
            return rep.status(500).send(response);
        }
    });

    app.post('/order/evaluate', {
        schema: {
            summary: 'Evaluate Order for Risk and Rules',
            description: 'Evaluates an order for deduplication, validation, and applies business rules like P.O. box blocking, fraud scoring, and auto-hold/tagging. Returns risk assessment and action recommendations.',
            tags: ['Order Evaluation'],
            headers: securityHeader,
            body: {
                type: 'object',
                required: ['order_id', 'customer', 'shipping_address', 'total_amount', 'currency'],
                properties: {
                    order_id: { type: 'string', description: 'Unique order identifier' },
                    customer: {
                        type: 'object',
                        properties: {
                            email: { type: 'string' },
                            phone: { type: 'string' },
                            first_name: { type: 'string' },
                            last_name: { type: 'string' }
                        }
                    },
                    shipping_address: {
                        type: 'object',
                        required: ['line1', 'city', 'postal_code', 'country'],
                        properties: {
                            line1: { type: 'string' },
                            line2: { type: 'string' },
                            city: { type: 'string' },
                            state: { type: 'string' },
                            postal_code: { type: 'string' },
                            country: { type: 'string' }
                        }
                    },
                    total_amount: { type: 'number' },
                    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
                    payment_method: { type: 'string', enum: ['card', 'cod', 'bank_transfer'] }
                }
            },
            response: {
                200: {
                    description: 'Order evaluation results',
                    type: 'object',
                    properties: {
                        order_id: { type: 'string' },
                        risk_score: { type: 'number', minimum: 0, maximum: 100 },
                        action: { type: 'string', enum: ['approve', 'hold', 'block'] },
                        tags: { type: 'array', items: { type: 'string' } },
                        reason_codes: { type: 'array', items: { type: 'string' } },
                        customer_dedupe: {
                            type: 'object',
                            properties: {
                                matches: { type: 'array', items: { type: 'object' } },
                                suggested_action: { type: 'string' }
                            }
                        },
                        address_dedupe: {
                            type: 'object',
                            properties: {
                                matches: { type: 'array', items: { type: 'object' } },
                                suggested_action: { type: 'string' }
                            }
                        },
                        validations: {
                            type: 'object',
                            properties: {
                                email: { type: 'object', properties: { valid: { type: 'boolean' }, reason_codes: { type: 'array', items: { type: 'string' } } } },
                                phone: { type: 'object', properties: { valid: { type: 'boolean' }, reason_codes: { type: 'array', items: { type: 'string' } } } },
                                address: { type: 'object', properties: { valid: { type: 'boolean' }, reason_codes: { type: 'array', items: { type: 'string' } } } }
                            }
                        },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse
            }
        }
    }, async (req, rep) => {
        const body = req.body as any;
        const project_id = (req as any).project_id;
        const reason_codes: string[] = [];
        const tags: string[] = [];
        let risk_score = 0;
        const request_id = crypto.randomUUID();

        try {
            const { order_id, customer, shipping_address, total_amount, currency, payment_method } = body;

            // 1. Customer dedupe
            const customer_dedupe = customer ? await pool.query(
                'SELECT id, similarity_score, match_type FROM (SELECT id, 1.0 as similarity_score, \'exact_email\' as match_type FROM customers WHERE project_id = $1 AND email = $2 UNION ALL SELECT id, similarity_score, match_type FROM (SELECT id, similarity((first_name || \' \' || last_name), $3) as similarity_score, \'fuzzy_name\' as match_type FROM customers WHERE project_id = $1 AND similarity((first_name || \' \' || last_name), $3) > 0.3 ORDER BY similarity_score DESC LIMIT 3) f) c ORDER BY similarity_score DESC LIMIT 3',
                [project_id, customer.email, `${customer.first_name} ${customer.last_name}`]
            ) : { rows: [] };
            const customer_matches = customer_dedupe.rows;
            if (customer_matches.length > 0) {
                risk_score += 20;
                tags.push('potential_duplicate_customer');
                reason_codes.push('order.customer_dedupe_match');
            }

            // 2. Address dedupe and validation
            const address_dedupe = await pool.query(
                'SELECT id, similarity_score, match_type FROM (SELECT id, 1.0 as similarity_score, \'exact_postal\' as match_type FROM addresses WHERE project_id = $1 AND postal_code = $2 AND lower(city) = lower($3) AND country = $4 UNION ALL SELECT id, similarity((line1 || \' \' || city || \' \' || postal_code || \' \' || country), $5) as similarity_score, \'fuzzy_address\' as match_type FROM addresses WHERE project_id = $1 AND similarity((line1 || \' \' || city || \' \' || postal_code || \' \' || country), $5) > 0.6 ORDER BY similarity_score DESC LIMIT 3) a ORDER BY similarity_score DESC LIMIT 3',
                [project_id, shipping_address.postal_code, shipping_address.city, shipping_address.country, `${shipping_address.line1} ${shipping_address.city} ${shipping_address.postal_code} ${shipping_address.country}`]
            );
            const address_matches = address_dedupe.rows;
            if (address_matches.length > 0) {
                risk_score += 15;
                tags.push('potential_duplicate_address');
                reason_codes.push('order.address_dedupe_match');
            }

            // 3. Address validation
            const address_valid = await normalizeAddress(shipping_address);
            const po_box = detectPoBox(address_valid.line1) || detectPoBox(address_valid.line2);
            if (po_box) {
                risk_score += 30;
                tags.push('po_box_detected');
                reason_codes.push('order.po_box_block');
                reason_codes.push('order.hold_for_review');
            }

            const { rows: postalMatch } = await pool.query(
                "select 1 from geonames_postal where country_code=$1 and postal_code=$2 and (lower(place_name)=lower($3) or lower(admin_name1)=lower($3)) limit 1",
                [address_valid.country.toUpperCase(), address_valid.postal_code, address_valid.city]
            );
            const postal_city_match = postalMatch.length > 0;
            if (!postal_city_match) {
                risk_score += 10;
                reason_codes.push('order.address_mismatch');
            }

            // 4. Customer validation (email and phone)
            let email_valid = { valid: true, reason_codes: [] as string[] };
            if (customer.email) {
                // Simplified - in production, call the full validator
                const isFormatValid = isEmailValid(customer.email);
                if (!isFormatValid) {
                    email_valid = { valid: false, reason_codes: ['email.invalid_format'] };
                    risk_score += 25;
                    reason_codes.push('order.invalid_email');
                }
            }

            let phone_valid = { valid: true, reason_codes: [] as string[] };
            if (customer.phone) {
                const parsed = parsePhoneNumber(customer.phone);
                if (!parsed || !parsed.isValid()) {
                    phone_valid = { valid: false, reason_codes: ['phone.invalid_format'] };
                    risk_score += 25;
                    reason_codes.push('order.invalid_phone');
                }
            }

            // 5. Order dedupe (exact order_id)
            const { rows: orderMatch } = await pool.query(
                'SELECT id FROM orders WHERE project_id = $1 AND order_id = $2',
                [project_id, order_id]
            );
            if (orderMatch.length > 0) {
                risk_score += 50;
                tags.push('duplicate_order');
                reason_codes.push('order.duplicate_detected');
            }

            // 6. Business rules
            if (payment_method === 'cod') {
                risk_score += 20;
                tags.push('cod_order');
                reason_codes.push('order.cod_risk');
            }

            if (total_amount > 1000) {
                risk_score += 15;
                tags.push('high_value_order');
                reason_codes.push('order.high_value');
            }

            // 7. Determine action
            let action = 'approve';
            if (risk_score > 70) {
                action = 'block';
            } else if (risk_score > 40) {
                action = 'hold';
            }

            const validations = { email: email_valid, phone: phone_valid, address: { valid: !po_box && postal_city_match, reason_codes: po_box ? ['address.po_box'] : (!postal_city_match ? ['address.postal_city_mismatch'] : []) } };

            const response = {
                order_id,
                risk_score: Math.min(risk_score, 100),
                action,
                tags,
                reason_codes,
                customer_dedupe: { matches: customer_matches, suggested_action: customer_matches.length > 0 ? (customer_matches[0].similarity_score === 1.0 ? 'merge_with' : 'review') : 'create_new' },
                address_dedupe: { matches: address_matches, suggested_action: address_matches.length > 0 ? (address_matches[0].similarity_score === 1.0 ? 'merge_with' : 'review') : 'create_new' },
                validations,
                request_id
            };

            // Log the order for dedupe (insert if new)
            await pool.query(
                'INSERT INTO orders (project_id, order_id, customer_email, customer_phone, shipping_address, total_amount, currency, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (order_id) DO NOTHING',
                [project_id, order_id, customer.email, customer.phone, shipping_address, total_amount, currency, action]
            );

            await (rep as any).saveIdem?.(response);
            await logEvent(project_id, 'order', '/order/evaluate', reason_codes, 200, { risk_score, action, tags: tags.join(',') }, pool);
            return rep.send(response);

        } catch (error) {
            req.log.error(error);
            reason_codes.push('order.server_error');
            const response = { order_id: body.order_id, risk_score: 0, action: 'hold', tags: [], reason_codes, customer_dedupe: { matches: [], suggested_action: 'create_new' }, address_dedupe: { matches: [], suggested_action: 'create_new' }, validations: { email: { valid: false, reason_codes: [] as string[] }, phone: { valid: false, reason_codes: [] as string[] }, address: { valid: false, reason_codes: [] as string[] } }, request_id };
            await logEvent(project_id, 'order', '/order/evaluate', reason_codes, 500, {}, pool);
            return rep.status(500).send(response);
        }
    });

    app.get('/rules', {
        schema: {
            summary: 'Get Available Rules',
            description: 'Returns a list of available validation and business rules with descriptions and reason codes.',
            tags: ['Configuration'],
            headers: securityHeader,
            response: {
                200: {
                    description: 'List of rules',
                    type: 'object',
                    properties: {
                        rules: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    name: { type: 'string' },
                                    description: { type: 'string' },
                                    reason_code: { type: 'string' },
                                    severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                                    enabled: { type: 'boolean' }
                                }
                            }
                        },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse
            }
        }
    }, async (req, rep) => {
        const project_id = (req as any).project_id;
        const request_id = crypto.randomUUID();

        // Static list of rules (in production, could be configurable per project)
        const rules = [
            { id: 'email_format', name: 'Email Format Validation', description: 'Checks if email is properly formatted', reason_code: 'email.invalid_format', severity: 'low', enabled: true },
            { id: 'email_mx', name: 'Email MX Records', description: 'Verifies domain has MX records', reason_code: 'email.mx_not_found', severity: 'medium', enabled: true },
            { id: 'email_disposable', name: 'Disposable Email Detection', description: 'Blocks disposable email providers', reason_code: 'email.disposable_domain', severity: 'high', enabled: true },
            { id: 'phone_format', name: 'Phone Format Validation', description: 'Validates phone number in E.164 format', reason_code: 'phone.invalid_format', severity: 'low', enabled: true },
            { id: 'address_po_box', name: 'P.O. Box Detection', description: 'Blocks shipments to P.O. boxes', reason_code: 'address.po_box', severity: 'high', enabled: true },
            { id: 'address_postal_match', name: 'Postal Code-City Matching', description: 'Verifies postal code matches city', reason_code: 'address.postal_city_mismatch', severity: 'medium', enabled: true },
            { id: 'tax_id_checksum', name: 'Tax ID Checksum', description: 'Validates tax ID checksum', reason_code: 'taxid.invalid_checksum', severity: 'medium', enabled: true },
            { id: 'customer_dedupe', name: 'Customer Deduplication', description: 'Detects duplicate customers', reason_code: 'order.customer_dedupe_match', severity: 'medium', enabled: true },
            { id: 'address_dedupe', name: 'Address Deduplication', description: 'Detects duplicate addresses', reason_code: 'order.address_dedupe_match', severity: 'medium', enabled: true },
            { id: 'order_duplicate', name: 'Order Duplicate Detection', description: 'Blocks duplicate orders', reason_code: 'order.duplicate_detected', severity: 'high', enabled: true },
            { id: 'cod_risk', name: 'COD Order Risk', description: 'Increases risk for cash on delivery', reason_code: 'order.cod_risk', severity: 'medium', enabled: true },
            { id: 'high_value', name: 'High Value Order', description: 'Flags high value orders for review', reason_code: 'order.high_value', severity: 'low', enabled: true }
        ];

        const response = { rules, request_id };
        await logEvent(project_id, 'config', '/rules', [], 200, { rules_count: rules.length }, pool);
        return rep.send(response);
    });
}