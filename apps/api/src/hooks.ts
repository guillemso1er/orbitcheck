import crypto from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";
import { type Redis as IORedisType } from 'ioredis';
import type { Pool } from "pg";

import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS, STATUS } from "./constants.js";
import { environment } from "./environment.js";


/**
 * Authentication hook for API requests using Bearer token or HMAC.
 * For Bearer: Extracts API key from Authorization header, computes SHA-256 hash for secure comparison.
 * For HMAC: Parses keyId, signature, ts, nonce; verifies ts is recent; looks up key by prefix.
 * Queries database for active key, attaches project_id to request.
 * Updates last_used_at timestamp on successful auth.
 *
 * @param req - Fastify request object with headers.
 * @param rep - Fastify reply object for sending responses.
 * @param pool - PostgreSQL connection pool for database queries.
 * @returns {Promise<void>} Resolves on success, sends 401 error on failure.
 */
export async function auth(request: FastifyRequest, rep: FastifyReply, pool: Pool): Promise<void> {
    const header = request.headers["authorization"];
    if (!header) {
        request.log.info('No Authorization header for runtime auth');
        rep.status(HTTP_STATUS.UNAUTHORIZED).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } });
        return;
    }

    if (header.startsWith("Bearer ")) {
        request.log.info('Using Bearer API key auth for runtime');
        // API key auth
        const key = header.slice(7).trim();
        const prefix = key.slice(0, 6);

        // Compute SHA-256 hash for secure storage and comparison (avoids storing plaintext keys)
        const keyHash = crypto.createHash('sha256').update(key).digest('hex');

        // Query for active key matching full hash and prefix (efficient indexing on hash/prefix)
        const { rows } = await pool.query(
            "select id, project_id from api_keys where hash=$1 and prefix=$2 and status=$3",
            [keyHash, prefix, STATUS.ACTIVE]
        );

        if (rows.length === 0) {
            rep.status(HTTP_STATUS.UNAUTHORIZED).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } });
            return;
        }

        // Update usage timestamp for auditing and analytics
        await pool.query(
            "UPDATE api_keys SET last_used_at = now() WHERE id = $1",
            [rows[0].id]
        );

        // Attach project_id to request for downstream route access
        // eslint-disable-next-line require-atomic-updates
        request.project_id = rows[0].project_id;
    } else if (header.startsWith("HMAC ")) {
        request.log.info('Using HMAC auth for runtime');
        // HMAC auth
        const hmacParams = header.slice(5).trim();
        const params = new URLSearchParams(hmacParams);
        const keyId = params.get('keyId');
        const signature = params.get('signature');
        const ts = params.get('ts');
        const nonce = params.get('nonce');

        if (!keyId || !signature || !ts || !nonce) {
            request.log.info('Missing HMAC parameters');
            rep.status(HTTP_STATUS.UNAUTHORIZED).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } });
            return;
        }

        // Check ts is recent (within 5 minutes)
        const now = Date.now();
        const requestTs = parseInt(ts);
        if (Math.abs(now - requestTs) > 5 * 60 * 1000) {
            request.log.info('HMAC ts too old');
            rep.status(HTTP_STATUS.UNAUTHORIZED).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } });
            return;
        }

        // Query for active key by prefix
        const { rows } = await pool.query(
            "select id, project_id, encrypted_key from api_keys where prefix=$1 and status=$2",
            [keyId, STATUS.ACTIVE]
        );

        if (rows.length === 0) {
            request.log.info('No active API key found for HMAC keyId');
            rep.status(HTTP_STATUS.UNAUTHORIZED).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } });
            return;
        }

        // Decrypt the full key
        const encryptedWithIv = rows[0].encrypted_key;
        const [ivHex, encrypted] = encryptedWithIv.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(environment.ENCRYPTION_KEY, 'hex'), iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        const fullKey = decrypted;

        // Compute expected signature: HMAC-SHA256 of method + url + body + ts + nonce
        const body = request.body ? JSON.stringify(request.body) : '';
        const message = request.method + request.url + body + ts + nonce;
        const expectedSignature = crypto.createHmac('sha256', fullKey).update(message).digest('hex');

        if (signature !== expectedSignature) {
            request.log.info('HMAC signature mismatch');
            rep.status(HTTP_STATUS.UNAUTHORIZED).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } });
            return;
        }

        request.log.info('HMAC signature verified');

        // Update usage timestamp
        await pool.query(
            "UPDATE api_keys SET last_used_at = now() WHERE id = $1",
            [rows[0].id]
        );

        // Attach project_id
        // eslint-disable-next-line require-atomic-updates
        request.project_id = rows[0].project_id;
    } else {
        request.log.info('Invalid Authorization header format for runtime auth');
        rep.status(HTTP_STATUS.UNAUTHORIZED).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } });
        return;
    }
}

/**
 * Rate limiting hook using Redis sliding window (per project + IP, 1-minute window).
 * Increments counter for unique key, sets TTL on first request, enforces limit.
 * Prevents abuse and ensures fair usage across projects.
 *
 * @param req - Fastify request object with project_id (from auth) and IP.
 * @param rep - Fastify reply object for sending 429 error if limited.
 * @param redis - Redis client for atomic increment and expiration.
 * @returns {Promise<void>} Resolves if under limit, sends 429 if exceeded.
 */
export async function rateLimit(request: FastifyRequest, rep: FastifyReply, redis: IORedisType): Promise<void> {
    const key = `rl:${request.project_id}:${request.ip}`;
    const limit = environment.RATE_LIMIT_COUNT;
    const ttl = 60;
    const cnt = await redis.incr(key);
    if (cnt === 1) await redis.expire(key, ttl);
    if (cnt > limit) {
        const remainingTtl = await redis.ttl(key);
        rep.header('Retry-After', Math.max(remainingTtl, 1).toString());
        rep.status(HTTP_STATUS.TOO_MANY_REQUESTS).send({ error: { code: ERROR_CODES.RATE_LIMITED, message: ERROR_MESSAGES[ERROR_CODES.RATE_LIMITED] } });
        return;
    }
}


/**
 * Idempotency hook using Redis (24-hour TTL per project + key).
 * Checks idempotency-key header; replays cached response if exists to prevent duplicates.
 * Attaches saveIdem method to reply for storing new responses post-processing.
 * Ensures safe retries for non-idempotent operations like payments.
 *
 * @param req - Fastify request object with headers and project_id (from auth).
 * @param rep - Fastify reply object; extended with saveIdem for caching responses.
 * @param redis - Redis client for GET/SET with expiration.
 * @returns {Promise<void|FastifyReply>} Sends cached response if found, otherwise attaches saveIdem.
 */
export async function idempotency(request: FastifyRequest, rep: FastifyReply, redis: IORedisType): Promise<void> {
    const idem = request.headers["idempotency-key"] || request.headers["Idempotency-Key"];
    if (!idem || typeof idem !== "string") return;
    const cacheKey = `idem:${request.project_id}:${idem}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
        rep.header("x-idempotent-replay", "1");
        rep.send(JSON.parse(cached));
        return;
    }
    rep.saveIdem = async (payload: unknown) => {
        await redis.set(cacheKey, JSON.stringify(payload), "EX", 24 * 60 * 60);
    };
}


/**
 * Logs an event to the 'logs' table for observability, auditing, and analytics.
 * Records project_id, event type, endpoint, reason codes, HTTP status, and metadata (JSON).
 * Enables querying for usage stats, error tracking, and compliance reporting.
 *
 * @param project_id - Unique identifier for the project.
 * @param type - Event category (e.g., 'validation', 'order', 'dedupe').
 * @param endpoint - API endpoint invoked (e.g., '/v1/validate/email').
 * @param reason_codes - Array of validation or risk reason codes.
 * @param status - HTTP status code of the response (e.g., 200, 400).
 * @param meta - Additional context as JSON object (e.g., { domain: 'example.com' }).
 * @param pool - PostgreSQL connection pool for inserting the log entry.
 * @returns {Promise<void>} Inserts log entry asynchronously.
 */
export async function logEvent(project_id: string, type: string, endpoint: string, reason_codes: string[], status: number, meta: Record<string, unknown>, pool: Pool): Promise<void> {
    await pool.query(
        "insert into logs (project_id, type, endpoint, reason_codes, status, meta) values ($1, $2, $3, $4, $5, $6)",
        [project_id, type, endpoint, reason_codes, status, meta]
    );
}