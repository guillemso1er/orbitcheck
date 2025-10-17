import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

import { environment } from "../environment.js";

/**
 * Configures CORS for the Fastify application based on environment settings.
 * Handles both development and production origins, with support for server-to-server requests.
 */
export async function setupCors(app: FastifyInstance): Promise<void> {
    // Define allowed origins based on environment
    const allowedOrigins = new Set([
        `http://localhost:${environment.PORT}`, // API itself for health/docs
    ]);

    // Add production origins from environment variable or defaults
    if (process.env.NODE_ENV === 'production') {
        // Allow origins from environment variable or use defaults
        const corsOrigins = environment.CORS_ORIGINS ? environment.CORS_ORIGINS.split(',') : [
            'https://dashboard.orbitcheck.io',
            'https://api.orbitcheck.io'
        ];
        corsOrigins.forEach(origin => allowedOrigins.add(origin.trim()));

        // Add your OIDC provider domain if needed
        if (environment.OIDC_PROVIDER_URL) {
            allowedOrigins.add(new URL(environment.OIDC_PROVIDER_URL).origin);
        }
    } else {
        // Development origins
        allowedOrigins.add('http://localhost:5173'); // Vite dev server
        allowedOrigins.add('http://localhost:3000'); // Alternative dev server
        allowedOrigins.add('http://localhost:5174'); // Dashboard dev server

        // Allow additional dev origins from environment
        if (environment.CORS_ORIGINS) {
            environment.CORS_ORIGINS.split(',').forEach(origin => allowedOrigins.add(origin.trim()));
        }
    }

    // Enable CORS with proper configuration for different auth methods
    await app.register(cors, {
        origin: async (origin: string | undefined) => {
            // Allow requests with no Origin header (e.g., server-to-server, Postman, curl)
            // This is important for PAT and API key authentication
            if (!origin) return true;

            // Check if origin is in allowed list
            return allowedOrigins.has(origin);
        },
        credentials: true, // Required for session cookies
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization', // For PAT and API keys
            'X-Idempotency-Key', // For idempotency
            'Idempotency-Key', // For idempotency (standard header)
            'X-Request-Id', // For request tracking
            'Correlation-Id', // For correlation tracking
            'X-Correlation-Id' // For correlation tracking
        ],
        exposedHeaders: ['X-Request-Id', 'Correlation-Id', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    });
}