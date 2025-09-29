import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Pool } from "pg";
import IORedis from "ioredis";
import { auth, rateLimit, idempotency } from "./hooks";
import { verifyJWT } from "./routes/auth";
import { registerAuthRoutes } from './routes/auth';
import { registerApiKeysRoutes } from './routes/api-keys';
import { registerValidationRoutes } from './routes/validation';
import { registerDedupeRoutes } from './routes/dedupe';
import { registerOrderRoutes } from './routes/order';
import { registerDataRoutes } from './routes/data';
import { registerWebhookRoutes } from './routes/webhook';
import { registerRulesRoutes } from './routes/rules';

/**
 * Determines the appropriate authentication hook based on the request URL.
 * For dashboard routes, uses JWT verification; for API routes, uses API key auth.
 * Public routes are skipped.
 *
 * @param req - Fastify request object
 * @param rep - Fastify reply object
 * @param pool - PostgreSQL connection pool
 * @returns {Promise<void>} Resolves after authentication or sends error response
 */
async function authenticateRequest(req: FastifyRequest, rep: FastifyReply, pool: Pool) {
    const url = req.url;

    // Skip public routes
    if (url.startsWith("/health") || url.startsWith("/documentation") || url.startsWith("/auth")) {
        return;
    }

    // Determine if this is a dashboard route
    const isDashboardRoute = url.startsWith("/api-keys") || url.startsWith("/webhooks");

    // Apply appropriate authentication
    if (isDashboardRoute) {
        await verifyJWT(req, rep, pool);
    } else {
        await auth(req, rep, pool);
    }
}

/**
 * Applies rate limiting and idempotency for non-dashboard routes.
 *
 * @param req - Fastify request object
 * @param rep - Fastify reply object
 * @param redis - Redis client
 * @returns {Promise<void>} Resolves after applying middleware or sends error response
 */
async function applyRateLimitingAndIdempotency(req: FastifyRequest, rep: FastifyReply, redis: IORedis) {
    const url = req.url;
    const isDashboardRoute = url.startsWith("/api-keys") || url.startsWith("/webhooks");

    if (!isDashboardRoute) {
        await rateLimit(req, rep, redis);
        await idempotency(req, rep, redis);
    }
}

export function registerRoutes(app: FastifyInstance, pool: Pool, redis: IORedis) {
    // Common preHandler hook - composed of authentication and middleware
    app.addHook("preHandler", async (req, rep) => {
        await authenticateRequest(req, rep, pool);
        await applyRateLimitingAndIdempotency(req, rep, redis);
    });

    // Register all route groups
    registerAuthRoutes(app, pool);
    registerApiKeysRoutes(app, pool);
    registerValidationRoutes(app, pool, redis);
    registerDedupeRoutes(app, pool);
    registerOrderRoutes(app, pool);
    registerDataRoutes(app, pool);
    registerWebhookRoutes(app, pool);
    registerRulesRoutes(app, pool);
}