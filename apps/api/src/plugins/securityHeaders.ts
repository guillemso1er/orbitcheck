import type { FastifyInstance, FastifyRequest, RawServerBase, RouteGenericInterface } from "fastify";

import { ROUTES } from "../config.js";

/**
 * Adds comprehensive security headers to all responses.
 * Includes CORS, CSP for dashboard routes, HSTS in production, and request tracing headers.
 */
export async function setupSecurityHeaders<TServer extends RawServerBase = RawServerBase>(app: FastifyInstance<TServer>): Promise<void> {
    // Add security headers (enhanced security)
    app.addHook('onSend', async (request: FastifyRequest<RouteGenericInterface, TServer>, reply, payload) => {
        // Basic security headers
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('X-Frame-Options', 'DENY');
        reply.header('X-XSS-Protection', '1; mode=block');
        reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
        reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

        // Add CSP for dashboard routes
        if (request.url.startsWith('/dashboard') || request.url.startsWith(ROUTES.DASHBOARD)) {
            reply.header('Content-Security-Policy',
                "default-src 'self'; " +
                "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " + // May need to adjust for your frontend
                "style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data: https:; " +
                "connect-src 'self' "
                // + (environment.OIDC_PROVIDER_URL || '') 
                + "; " +
                "frame-ancestors 'none';"
            );
        }

        // Add HSTS in production
        if (process.env.NODE_ENV === 'production') {
            reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
        }

        // Add request ID and correlation ID to response headers for tracing
        if (request.id) {
            reply.header('X-Request-Id', request.id);
        }

        // Support Correlation-Id header for request tracing
        const correlationId = request.headers['correlation-id'] || request.headers['x-correlation-id'];
        if (correlationId && typeof correlationId === 'string') {
            reply.header('Correlation-Id', correlationId);
        } else if (request.id) {
            reply.header('Correlation-Id', request.id);
        }

        return payload;
    });
}