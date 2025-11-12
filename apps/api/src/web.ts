import type { FastifyInstance, FastifyReply, FastifyRequest, RawServerBase, RouteGenericInterface } from "fastify";
import openapiGlue from "fastify-openapi-glue";
import { type Redis as IORedisType } from 'ioredis';
import type { Pool } from "pg";

import openapiSpec from "@orbitcheck/contracts/openapi.v1.json";
import { ROUTES } from "./config.js";
import { HTTP_STATUS } from "./errors.js";
import { serviceHandlers } from "./handlers/handlers.js";
import { idempotency, rateLimit } from "./hooks.js";
import openapiSecurity from "./plugins/auth.js";
import { managementRoutes, runtimeRoutes } from "./routes/routes.js";
import { createPlansService } from './services/plans.js';




/**
 * Applies validation limits for users on validation endpoints.
 * Checks and increments usage for authenticated users only.
 *
 * @param request - Fastify request object
 * @param rep - Fastify reply object
 * @param pool - PostgreSQL connection pool
 * @returns {Promise<void>} Resolves after limit check or sends payment required error
 */
export async function applyValidationLimits<TServer extends RawServerBase = RawServerBase>(request: FastifyRequest<RouteGenericInterface, TServer>, rep: FastifyReply<RouteGenericInterface, TServer>, pool: Pool): Promise<void> {
    const url = request.url;

    // Only apply to validation routes
    const isValidationRoute = runtimeRoutes().some(route => url.startsWith(route));

    if (!isValidationRoute) return;

    // Only for users, not API keys
    // Try multiple sources to get user_id, with fallback to auth object
    const userId = (request as any).user_id || request.auth?.userId;
    if (!userId) return;

    try {
        const plansService = createPlansService(pool);
        await plansService.checkValidationLimit(userId, 1);
        await plansService.incrementValidationUsage(userId, 1);
    } catch (limitError: any) {
        if (limitError.status === HTTP_STATUS.PAYMENT_REQUIRED) {
            rep.status(HTTP_STATUS.PAYMENT_REQUIRED).send(limitError);
            return;
        }
        throw limitError;
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
export async function applyRateLimitingAndIdempotency<TServer extends RawServerBase = RawServerBase>(request: FastifyRequest<RouteGenericInterface, TServer>, rep: FastifyReply<RouteGenericInterface, TServer>, redis: IORedisType): Promise<void> {
    const url = request.url;

    // Skip middleware for health, docs, metrics, auth, and management routes
    if (url.startsWith(ROUTES.HEALTH) ||
        url.startsWith(ROUTES.DOCUMENTATION) ||
        url.startsWith(ROUTES.METRICS) ||
        url.startsWith(ROUTES.AUTH_REGISTER) ||
        url.startsWith(ROUTES.AUTH_LOGIN) ||
        url.startsWith(ROUTES.AUTH_LOGOUT)) {
        return;
    }

    // Skip middleware for management routes
    const isMgmtRoute = managementRoutes().some(group =>
        typeof group === 'object' && group !== null &&
        Object.values(group).some(route => {
            // Handle parameterized routes like '/v1/api-keys/:id'
            if (typeof route === 'string' && route.includes(':')) {
                const routePattern = route.replace(/:[^/]+/g, '[^/]+');
                const regex = new RegExp(`^${routePattern}`);
                return regex.test(url);
            }
            return typeof route === 'string' && url.startsWith(route);
        })
    );

    if (isMgmtRoute) {
        return;
    }

    // Only apply rate limiting and idempotency to runtime routes
    const isRuntimeRoute = runtimeRoutes().some(route => {
        // Handle parameterized routes like '/v1/jobs/:id'
        if (typeof route === 'string' && route.includes(':')) {
            const routePattern = route.replace(/:[^/]+/g, '[^/]+');
            const regex = new RegExp(`^${routePattern}`);
            return regex.test(url);
        }
        return typeof route === 'string' && url.startsWith(route);
    });

    if (isRuntimeRoute) {
        await rateLimit(request as any, rep as any, redis);
        await idempotency(request as any, rep as any, redis);
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
export function registerRoutes<TServer extends RawServerBase = RawServerBase>(app: FastifyInstance<TServer>, pool: Pool, redis: IORedisType): void {

    // Register OpenAPI routes with integrated security
    app.register(openapiSecurity, { pool });
    // Global preHandler hook chain: validation limits + rate limiting/idempotency middleware
    app.addHook("preHandler", async (request, rep) => {
        await applyValidationLimits(request, rep, pool);
        await applyRateLimitingAndIdempotency(request, rep, redis);
        return;
    });



    app.register(openapiGlue, {
        serviceHandlers: serviceHandlers(pool, redis, app),
        specification: openapiSpec,
    });

}
