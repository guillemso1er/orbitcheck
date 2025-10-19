import { DASHBOARD_ROUTES } from "@orbitcheck/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type Redis as IORedisType } from 'ioredis';
import type { Pool } from "pg";

import { ROUTES } from "./config.js";
import { auth, idempotency, rateLimit } from "./hooks.js";
import { registerApiKeysRoutes } from './routes/api-keys.js';
import { registerAuthRoutes, verifyPAT, verifySession } from "./routes/auth.js";
import { registerBatchRoutes } from './routes/batch.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerDataRoutes } from './routes/data.js';
import { registerDedupeRoutes } from './routes/dedupe.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerNormalizeRoutes } from './routes/normalize.js';
import { registerOrderRoutes } from './routes/orders.js';
import { registerRulesRoutes } from './routes/rules.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerValidationRoutes } from './routes/validation.js';
import { registerWebhookRoutes } from './routes/webhook.js';

const AUTH_REGISTER = DASHBOARD_ROUTES.REGISTER_NEW_USER;
const AUTH_LOGIN = DASHBOARD_ROUTES.USER_LOGIN;
const AUTH_LOGOUT = DASHBOARD_ROUTES.USER_LOGOUT;

/**
 * Determines the appropriate authentication hook based on the request URL.
 * Dashboard routes use session cookies, management routes use PAT, runtime routes use API key with HMAC.
 * Public routes are skipped.
 *
 * @param req - Fastify request object
 * @param rep - Fastify reply object
 * @param pool - PostgreSQL connection pool
 * @returns {Promise<void>} Resolves after authentication or sends error response
 */
export async function authenticateRequest(request: FastifyRequest, rep: FastifyReply, pool: Pool): Promise<void> {
    const url = request.url;

    // Skip authentication for public endpoints: health checks, API docs, metrics, and auth routes
    if (url.startsWith(ROUTES.HEALTH) ||
        url.startsWith(ROUTES.DOCUMENTATION) ||
        url.startsWith(ROUTES.METRICS) ||
        url.startsWith(AUTH_REGISTER) ||
        url.startsWith(AUTH_LOGIN) ||
        url.startsWith(AUTH_LOGOUT)) {
        return;
    }

    // Dashboard routes - use session-based authentication
    const isDashboardRoute = url.startsWith('/dashboard') ||
        url.startsWith(ROUTES.DASHBOARD);

    // Management routes - use PAT authentication, fallback to session
    const isMgmtRoute = url.startsWith(ROUTES.API_KEYS) ||
        url.startsWith(ROUTES.DATA) ||
        url.startsWith(ROUTES.LOGS) ||
        url.startsWith(ROUTES.RULES) ||
        url.startsWith(ROUTES.SETTINGS) ||
        url.startsWith(ROUTES.WEBHOOKS);

    // Runtime routes - use API key with HMAC
    const isRuntimeRoute = url.startsWith(ROUTES.DEDUPE) ||
        url.startsWith(ROUTES.ORDERS) ||
        url.startsWith(ROUTES.VALIDATE) ||
        url.startsWith(ROUTES.NORMALIZE) ||
        url.startsWith(ROUTES.VERIFY) ||
        url.startsWith(ROUTES.BATCH) ||
        url.startsWith(ROUTES.JOBS);

    // Log the auth method being used for debugging
    request.log.info({ url, isDashboardRoute, isMgmtRoute, isRuntimeRoute }, 'Auth method determination');

    // Apply appropriate auth
    if (isDashboardRoute) {
        request.log.info('Using session auth for dashboard route');
        await verifySession(request, rep, pool);
    } else if (isMgmtRoute) {
        request.log.info('Trying PAT auth for management route');
        const header = request.headers["authorization"];
        if (header && header.startsWith("Bearer ")) {
            await verifyPAT(request, rep, pool);
        } else {
            request.log.info('No Bearer header, trying session auth for management route');
            await verifySession(request, rep, pool);
        }
    } else if (isRuntimeRoute) {
        request.log.info('Using API key/HMAC auth for runtime route');
        await auth(request, rep, pool); // Supports both Bearer API keys and HMAC
    } else {
        // Other public routes
        request.log.info('No auth required for public route');
    }
}

/**
 * Applies rate limiting and idempotency checks for runtime API routes only.
 * Skips for dashboard and management routes to avoid unnecessary overhead.
 * Calls rateLimit hook (project+IP per minute) and idempotency hook (replay if key exists).
 *
 * @param req - Fastify request object with URL and project_id (from auth).
 * @param rep - Fastify reply object for potential error responses or caching.
 * @param redis - Redis client for rate counters and idempotency storage.
 * @returns {Promise<void>} Resolves after middleware or sends 429/200 replay.
 */
export async function applyRateLimitingAndIdempotency(request: FastifyRequest, rep: FastifyReply, redis: IORedisType): Promise<void> {
    const url = request.url;

    // Skip middleware for health, docs, metrics, and auth
    if (url.startsWith(ROUTES.HEALTH) ||
        url.startsWith(ROUTES.DOCUMENTATION) ||
        url.startsWith(ROUTES.METRICS) ||
        url.startsWith(AUTH_REGISTER) ||
        url.startsWith(AUTH_LOGIN) ||
        url.startsWith(AUTH_LOGOUT)) {
        return;
    }

    // Only apply rate limiting and idempotency to runtime routes
    const isRuntimeRoute = url.startsWith(ROUTES.DEDUPE) ||
        url.startsWith(ROUTES.ORDERS) ||
        url.startsWith(ROUTES.VALIDATE) ||
        url.startsWith(ROUTES.NORMALIZE) ||
        url.startsWith(ROUTES.VERIFY) ||
        url.startsWith(ROUTES.BATCH) ||
        url.startsWith(ROUTES.JOBS);

    if (isRuntimeRoute) {
        await rateLimit(request, rep, redis);
        await idempotency(request, rep, redis);
    }
}

/**
 * Registers all API routes on the Fastify instance with global preHandler hooks for auth, rate limiting, and idempotency.
 * Hooks run before every route: authenticate based on path, apply middleware for runtime routes.
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
    registerNormalizeRoutes(app, pool);
    registerDedupeRoutes(app, pool);
    registerOrderRoutes(app, pool, redis);
    registerDataRoutes(app, pool);
    registerSettingsRoutes(app, pool);
    registerWebhookRoutes(app, pool);
    registerBillingRoutes(app, pool);
    registerRulesRoutes(app, pool, redis);
    registerBatchRoutes(app, pool, redis);
    registerJobRoutes(app, pool);
}