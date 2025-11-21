import cors, { FastifyCorsOptions } from "@fastify/cors";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

import { environment } from "../environment.js";

/**
 * Configures CORS for the Fastify application based on environment settings.
 * Handles both development and production origins, with support for server-to-server requests.
 * In production, CORS is handled by the reverse proxy (Caddy), so we skip registration here.
 */
const setupCors: FastifyPluginAsync = async (app) => {
    // In production, CORS is handled by Caddy reverse proxy, so skip Fastify CORS to avoid duplicate headers
    if (environment.isProd) {
        return;
    }

    // Define allowed origins based on environment
    const allowedOrigins = new Set([
        `http://localhost:${environment.PORT}`, // API itself for health/docs
        `http://127.0.0.1:${environment.PORT}`, // API itself for health/docs
    ]);

    // Add production origins from environment variable or defaults
    if (environment.isProd) {
        // Allow origins from environment variable or use defaults
        const corsOrigins = environment.CORS_ORIGINS && environment.CORS_ORIGINS.length > 0 ? environment.CORS_ORIGINS : [
            'https://dashboard.orbitcheck.io',
            'https://api.orbitcheck.io',
            'https://orbitcheck.io'
        ];
        corsOrigins.forEach(origin => allowedOrigins.add(origin));
    } else {
        // Development origins
        allowedOrigins.add('http://localhost:5173'); // Vite dev server
        allowedOrigins.add('http://localhost:3000'); // Alternative dev server
        allowedOrigins.add('http://localhost:5174'); // Dashboard dev server

        // Allow additional dev origins from environment
        if (environment.CORS_ORIGINS && environment.CORS_ORIGINS.length > 0) {
            environment.CORS_ORIGINS.forEach((origin: string) => allowedOrigins.add(origin.trim()));
        }
    }

    // Enable CORS with proper configuration for different auth methods
    // FIX 1: Cast 'cors' to 'any' to bypass the Fastify v4/v5 mismatch in register()
    await app.register(cors as any, {
        origin: (origin: string, cb: (err: Error | null, allow: boolean) => void) => {
            // Allow requests with no Origin header (e.g., server-to-server, Postman, curl)
            if (!origin) {
                cb(null, true);
                return;
            }

            // Check if origin is in allowed list
            // Allow Shopify CLI tunnel URLs in development
            if (allowedOrigins.has(origin) || (!environment.isProd && origin.endsWith('.trycloudflare.com'))) {
                cb(null, true);
            } else {
                cb(new Error("Not allowed"), false);
            }
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Idempotency-Key',
            'Idempotency-Key',
            'X-Request-Id',
            'Correlation-Id',
            'X-Correlation-Id'
        ],
        exposedHeaders: ['X-Request-Id', 'Correlation-Id', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    } as FastifyCorsOptions);
};

// FIX 2: Double-cast export to 'unknown' -> 'FastifyPluginAsync'
// This wipes the "missing properties: propfind..." error from fastify-plugin
export default fp(setupCors as any, { name: 'orbitcheck-cors' }) as unknown as FastifyPluginAsync;
export { setupCors };
