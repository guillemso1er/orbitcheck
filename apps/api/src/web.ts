
import { API_ROUTES, DASHBOARD_ROUTES } from "@orbicheck/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type Redis as IORedisType } from 'ioredis';
import type { Pool } from "pg";

import { auth, idempotency, rateLimit } from "./hooks.js";
const _WEBHOOKS_TEST = DASHBOARD_ROUTES.TEST_WEBHOOK;
const _USAGE = DASHBOARD_ROUTES.GET_USAGE_STATISTICS;
const _LOGS = DASHBOARD_ROUTES.GET_EVENT_LOGS;
const AUTH_REGISTER = API_ROUTES.REGISTER_NEW_USER;
const AUTH_LOGIN = API_ROUTES.USER_LOGIN;
import { registerApiKeysRoutes } from './routes/api-keys.js';
import { registerAuthRoutes, verifyJWT } from "./routes/auth.js";
import { registerDataRoutes } from './routes/data.js';
import { registerDedupeRoutes } from './routes/dedupe.js';
import { registerOrderRoutes } from './routes/orders.js';
import { registerRulesRoutes } from './routes/rules.js';
import { registerValidationRoutes } from './routes/validation.js';
import { registerWebhookRoutes } from './routes/webhook.js';

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
async function authenticateRequest(request: FastifyRequest, rep: FastifyReply, pool: Pool): Promise<void> {
    const url = request.url;

    // Skip authentication for public endpoints: health checks, API docs, and auth routes
    if (url.startsWith('/health') || url.startsWith('/documentation') || url.startsWith(AUTH_REGISTER) || url.startsWith(AUTH_LOGIN)) return;

    // Dashboard routes require JWT authentication (user session)
    const isDashboardRoute = url.startsWith(DASHBOARD_ROUTES.LIST_API_KEYS) || url.startsWith(DASHBOARD_ROUTES.TEST_WEBHOOK) ||
        url.startsWith(DASHBOARD_ROUTES.GET_EVENT_LOGS) || url.startsWith(DASHBOARD_ROUTES.GET_USAGE_STATISTICS);

    // Apply JWT verification for dashboard or API key auth for public API
    await (isDashboardRoute ? verifyJWT(request, rep, pool) : auth(request, rep, pool));
}

/**
 * Applies rate limiting and idempotency checks for non-dashboard API routes only.
 * Skips for dashboard to avoid unnecessary overhead on low-volume admin routes.
 * Calls rateLimit hook (project+IP per minute) and idempotency hook (replay if key exists).
 *
 * @param req - Fastify request object with URL and project_id (from auth).
 * @param rep - Fastify reply object for potential error responses or caching.
 * @param redis - Redis client for rate counters and idempotency storage.
 * @returns {Promise<void>} Resolves after middleware or sends 429/200 replay.
 */
async function applyRateLimitingAndIdempotency(request: FastifyRequest, rep: FastifyReply, redis: IORedisType): Promise<void> {
    const url = request.url;

    // Skip middleware for health, docs, and auth
    if (url.startsWith('/health') || url.startsWith('/documentation') || url.startsWith(AUTH_REGISTER) || url.startsWith(AUTH_LOGIN)) return;

    const isDashboardRoute = url.startsWith(DASHBOARD_ROUTES.LIST_API_KEYS) || url.startsWith(DASHBOARD_ROUTES.TEST_WEBHOOK) ||
        url.startsWith(DASHBOARD_ROUTES.GET_EVENT_LOGS) || url.startsWith(DASHBOARD_ROUTES.GET_USAGE_STATISTICS);

    if (!isDashboardRoute) {
        await rateLimit(request, rep, redis);
        await idempotency(request, rep, redis);
    }
}

/**
 * Registers all API routes on the Fastify instance with global preHandler hooks for auth, rate limiting, and idempotency.
 * Hooks run before every route: authenticate based on path, apply middleware for API routes.
 * Imports and registers modular route handlers for auth, API keys, validation, dedupe, orders, data, webhooks, rules.
 * Ensures consistent middleware application across the API surface.
 *
 * @param app - FastifyInstance to register routes and hooks on.
 * @param pool - Shared PostgreSQL pool for all route database access.
 * @param redis - Shared Redis client for caching, rate limiting, and idempotency in routes.
 */
export function registerRoutes(app: FastifyInstance, pool: Pool, redis: IORedisType): void {
    // Global preHandler hook chain: authentication + rate limiting/idempotency middleware
    app.addHook("preHandler", async (request, rep) => {
        await authenticateRequest(request, rep, pool);
        await applyRateLimitingAndIdempotency(request, rep, redis);
        return;
    });

    // Register modular route groups with shared dependencies
    registerAuthRoutes(app, pool);
    registerApiKeysRoutes(app, pool);
    registerValidationRoutes(app, pool, redis);
    registerDedupeRoutes(app, pool);
    registerOrderRoutes(app, pool, redis);
    registerDataRoutes(app, pool);
    registerWebhookRoutes(app, pool);
    registerRulesRoutes(app, pool);
}