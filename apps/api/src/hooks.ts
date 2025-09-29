import crypto from "crypto";
import { FastifyRequest, FastifyReply } from "fastify";
import IORedis from "ioredis";
import { Pool } from "pg";
import { env } from "./env";

/**
 * Authentication hook for API requests.
 * Extracts and validates the Bearer API key from the Authorization header.
 * Computes SHA-256 hash for secure comparison against stored hashes.
 * Attaches project_id to the request if valid.
 *
 * @param req - Fastify request object.
 * @param rep - Fastify reply object.
 * @param pool - PostgreSQL connection pool.
 * @returns {Promise<void>} Resolves if authenticated, sends 401 error if not.
 */
export async function auth(req: FastifyRequest, rep: FastifyReply, pool: Pool) {
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

    // Update last_used_at
    await pool.query(
        "UPDATE api_keys SET last_used_at = now() WHERE id = $1",
        [rows[0].id]
    );

    (req as any).project_id = rows[0].project_id;
}

/**
 * Rate limiting hook using Redis.
 * Limits requests per project and IP to RATE_LIMIT_COUNT per minute.
 *
 * @param req - Fastify request object (requires project_id from auth).
 * @param rep - Fastify reply object.
 * @param redis - Redis client.
 * @returns {Promise<void>} Resolves if under limit, sends 429 if exceeded.
 */
export async function rateLimit(req: FastifyRequest, rep: FastifyReply, redis: IORedis) {
    const key = `rl:${(req as any).project_id}:${req.ip}`;
    const limit = env.RATE_LIMIT_COUNT;
    const ttl = 60;
    const cnt = await redis.incr(key);
    if (cnt === 1) await redis.expire(key, ttl);
    if (cnt > limit) return rep.status(429).send({ error: { code: "rate_limited", message: "Rate limit exceeded" } });
}

/**
 * Idempotency hook using Redis cache (24h TTL).
 * Checks for idempotency-key header; replays cached response if exists.
 * Provides saveIdem method on reply for storing new responses.
 *
 * @param req - Fastify request object (requires project_id from auth).
 * @param rep - Fastify reply object.
 * @param redis - Redis client.
 * @returns {Promise<void|FastifyReply>} Sends cached response if found, otherwise attaches saveIdem.
 */
export async function idempotency(req: FastifyRequest, rep: FastifyReply, redis: IORedis) {
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

/**
 * Logs an event to the database for observability.
 * Inserts into 'logs' table with project_id, type, endpoint, reason_codes, status, and meta JSON.
 *
 * @param project_id - The project identifier.
 * @param type - Event type (e.g., 'validation', 'order').
 * @param endpoint - API endpoint called.
 * @param reason_codes - Array of reason codes for the event.
 * @param status - HTTP status code.
 * @param meta - Additional metadata as JSON.
 * @param pool - PostgreSQL connection pool.
 * @returns {Promise<void>}
 */
export async function logEvent(project_id: string, type: string, endpoint: string, reason_codes: string[], status: number, meta: any, pool: Pool) {
    await pool.query(
        "insert into logs (project_id, type, endpoint, reason_codes, status, meta) values ($1, $2, $3, $4, $5, $6)",
        [project_id, type, endpoint, reason_codes, status, meta]
    );
}