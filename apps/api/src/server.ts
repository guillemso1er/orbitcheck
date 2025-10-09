import 'dotenv/config';

import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import secureSession from '@fastify/secure-session';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import * as Sentry from '@sentry/node';
import { Queue, Worker } from 'bullmq';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import Fastify from "fastify";
import { type Redis as IORedisType, Redis } from 'ioredis';
import yaml from 'js-yaml';
import cron from 'node-cron';
import { Pool } from "pg";

import { runLogRetention } from './cron/retention.js';
import { environment } from "./environment.js";
import { disposableProcessor } from './jobs/refreshDisposable.js';
import { openapiValidation } from "./plugins/openapi.js";
import startupGuard from './startup-guard.js';
import { registerRoutes } from "./web.js";

export async function build(pool: Pool, redis: IORedisType): Promise<FastifyInstance> {
    if (environment.SENTRY_DSN) {
        Sentry.init({
            dsn: environment.SENTRY_DSN,
            tracesSampleRate: 1,
        });
    }

    const app = Fastify({
        logger: {
            level: environment.LOG_LEVEL,
            transport: process.env.NODE_ENV === 'production'
                ? undefined
                : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
        },
        requestTimeout: 10_000,
        trustProxy: true, // Important for secure cookies behind proxies
    });

    if (process.env.NODE_ENV !== 'production') {
        await app.register(startupGuard);
    }

    // Error handler
    app.setErrorHandler(async (error: Error & { code?: string; statusCode?: number }, request: FastifyRequest, reply: FastifyReply) => {
        if (error.code === 'FST_ERR_REQUEST_TIMEOUT' || error.name === 'RequestTimeoutError') {
            request.log.error({ method: request.method, url: request.url, reqId: request.id }, 'Request timed out — likely stuck in a hook/handler');
            return reply.status(503).send({ error: 'timeout' });
        }
        request.log.error({ err: error }, 'Unhandled error');
        return reply.status(error.statusCode ?? 500).send({ error: 'internal_error' });
    });

    // Load OpenAPI spec from contracts package
    const openapiPath = path.join(process.cwd(), '..', '..', 'packages', 'contracts', 'openapi.yaml');
    const openapiSpec = yaml.load(readFileSync(openapiPath, 'utf8'));

    // Register OpenAPI/Swagger for automatic API documentation generation
    await app.register(fastifySwagger, {
        openapi: {
            ...(openapiSpec as Record<string, unknown>),
            servers: [{
                url: `http://localhost:${environment.PORT}`,
                description: 'Development server'
            }]
        }
    });

    // Register Swagger UI for interactive API documentation at /documentation
    await app.register(fastifySwaggerUi, {
        routePrefix: '/documentation',
    });

    // Define allowed origins based on environment
    const allowedOrigins = new Set([
        `http://localhost:${environment.PORT}`, // API itself for health/docs
    ]);

    // Add environment-specific origins
    if (process.env.NODE_ENV === 'production') {
        allowedOrigins.add('https://dashboard.orbicheck.com');
        allowedOrigins.add('https://api.orbicheck.com');
        // Add your OIDC provider domain if needed
        if (environment.OIDC_PROVIDER_URL) {
            allowedOrigins.add(new URL(environment.OIDC_PROVIDER_URL).origin);
        }
    } else {
        // Development origins
        allowedOrigins.add('http://localhost:5173'); // Vite dev server
        allowedOrigins.add('http://localhost:3000'); // Alternative dev server
        allowedOrigins.add('http://localhost:5174'); // Dashboard dev server
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
            'X-Request-Id' // For request tracking
        ],
        exposedHeaders: ['X-Request-Id', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    });

    // Register cookie support (required for secure sessions)
    await app.register(cookie);

    // Use secure-session instead of regular session for better security
    // This provides encrypted, stateless sessions
    await app.register(secureSession, {
        sessionName: 'session',
        cookieName: 'orbicheck_session', // More specific cookie name
        key: Buffer.from(environment.SESSION_SECRET, 'hex'), // Should be 32 bytes hex string
        cookie: {
            path: '/',
            httpOnly: true, // Prevents JavaScript access
            secure: process.env.NODE_ENV === 'production', // HTTPS only in production
            sameSite: 'lax', // CSRF protection while allowing navigation
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            domain: process.env.NODE_ENV === 'production'
                ? '.orbicheck.com' // Allow subdomain sharing in production
                : undefined
        }
    });

    // Add OIDC support for dashboard authentication (if configured)
    if (environment.OIDC_ENABLED && environment.OIDC_CLIENT_ID && environment.OIDC_CLIENT_SECRET) {
        // Register OIDC plugin here if using one
        // Example: await app.register(fastifyOauth2, { ... })
        app.log.info('OIDC authentication configured for dashboard');
    }

    // Register all API routes with shared pool and redis instances
    registerRoutes(app, pool, redis);

    // Register OpenAPI validation (after routes are registered)
    await openapiValidation(app);

    // Add security headers (enhanced security)
    app.addHook('onSend', async (request, reply, payload) => {
        // Basic security headers
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('X-Frame-Options', 'DENY');
        reply.header('X-XSS-Protection', '1; mode=block');
        reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
        reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

        // Add CSP for dashboard routes
        if (request.url.startsWith('/dashboard') || request.url.startsWith('/api/dashboard')) {
            reply.header('Content-Security-Policy',
                "default-src 'self'; " +
                "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " + // May need to adjust for your frontend
                "style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data: https:; " +
                "connect-src 'self' " + (environment.OIDC_PROVIDER_URL || '') + "; " +
                "frame-ancestors 'none';"
            );
        }

        // Add HSTS in production
        if (process.env.NODE_ENV === 'production') {
            reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
        }

        // Add request ID to response headers for tracing
        if (request.id) {
            reply.header('X-Request-Id', request.id);
        }

        return payload;
    });

    // Health check endpoint (public, no auth required)
    app.get("/health", async (): Promise<{ ok: true; timestamp: string; environment: string }> => ({
        ok: true,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    }));

    // Add a ready check that verifies all dependencies
    app.get("/ready", async (): Promise<{ ready: boolean; checks: Record<string, boolean> }> => {
        const checks = {
            database: false,
            redis: false
        };

        try {
            // Check database
            const dbResult = await pool.query('SELECT 1');
            checks.database = dbResult.rows.length > 0;
        } catch (error) {
            app.log.error({ err: error }, 'Database health check failed');
        }

        try {
            // Check Redis
            await redis.ping();
            checks.redis = true;
        } catch (error) {
            app.log.error({ err: error }, 'Redis health check failed');
        }

        const ready = Object.values(checks).every(status => status);

        return { ready, checks };
    });

    return app;
}

/**
 * Creates a promise that rejects after a timeout using async/await pattern
 */
async function createTimeoutPromise(ms: number, message: string): Promise<never> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
    throw new Error(message);
}

/**
 * Races a promise against a timeout
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return Promise.race([
        promise,
        createTimeoutPromise(ms, message)
    ]);
}

// *** CHANGE 1: Add a graceful shutdown function ***
/**
 * Gracefully closes all application resources: Fastify server, DB pool, and Redis client.
 * Uses Promise.allSettled to ensure all resources are attempted to be closed, even if one fails.
 */
async function closeResources(app: FastifyInstance | null, pool: Pool | null, redis: IORedisType | null): Promise<void> {
    console.log('Closing application resources...');
    await Promise.allSettled([
        app?.close(),
        pool?.end(),
        redis?.quit(),
    ]);
    console.log('All resources closed.');
}

/**
 * Starts the API server: initializes database pool and Redis client,
 * builds the Fastify app, sets up BullMQ queue/worker for disposable email processing,
 * schedules recurring jobs (daily refresh, log retention), and starts listening.
 * Handles startup errors with Sentry capture and process exit.
 *
 * @returns {Promise<void>} Starts the server asynchronously; throws on failure.
 */
export async function start(): Promise<void> {
    let app: FastifyInstance | null = null;
    let pool: Pool | null = null;
    let appRedis: IORedisType | null = null;

    try {
        // --- Step 1: Initialize and Verify Dependencies ---
        pool = new Pool({ connectionString: environment.DATABASE_URL });

        try {
            const client = await pool.connect();
            await client.query('SELECT 1');
            client.release();
        } catch (error) {
            throw new Error(`FATAL: Could not connect to PostgreSQL. Shutting down. ${String(error)}`);
        }

        // --- Create a dedicated client just for the startup check ---
        const verificationRedis = new Redis(environment.REDIS_URL, {
            maxRetriesPerRequest: 3,
            connectTimeout: 5000,
        });

        try {
            if (verificationRedis.status !== 'ready') {
                await once(verificationRedis, 'ready');
            }
            await verificationRedis.ping();
            // We are done with this client, disconnect it.
            await verificationRedis.quit();
        } catch (error) {
            throw new Error(`FATAL: Could not connect to Redis. Shutting down. ${String(error)}`);
        }

        // --- Create the main Redis client for the application with BullMQ's required options ---
        appRedis = new Redis(environment.REDIS_URL, {
            maxRetriesPerRequest: null // This is required by BullMQ
        });

        // --- Step 2: Build the App and Start Workers ---
        app = await build(pool, appRedis);
        app.log.info('All dependencies are connected. Building Fastify app...');

        // Ensure Redis is ready for hooks during startup smoke test
        if (appRedis.status !== 'ready') {
            await once(appRedis, 'ready');
        }
        await appRedis.ping();

        const timeoutMs = Number(process.env.STARTUP_SMOKETEST_TIMEOUT ?? 2000);
        try {
            const response = await withTimeout(
                app.inject({ method: 'GET', url: '/health' }),
                timeoutMs,
                `Startup smoke test timed out after ${timeoutMs}ms. A hook/handler is likely not async or not calling done().`
            );

            if (response.statusCode !== 200) {
                throw new Error(`Startup smoke test failed: /health returned ${response.statusCode}. Body: ${response.body}`);
            }
            app.log.info('Startup smoke test passed.');
        } catch (error) {
            // On smoke test failure, log, close resources, then re-throw
            app?.log.error({ err: error }, 'FATAL: Startup check failed. Initiating graceful shutdown.');
            await closeResources(app, pool, appRedis);
            throw error; // Re-throw to be caught by the outer try/catch
        }

        const disposableQueue = new Queue('disposable', { connection: appRedis });
        new Worker('disposable', disposableProcessor, { connection: appRedis });

        await disposableQueue.add('refresh', {}, {
            repeat: { pattern: '0 0 * * *' }
        });

        cron.schedule('0 0 * * *', async () => {
            await runLogRetention(pool!);
        });

        // --- Step 3: Start Listening ---
        await app.listen({ port: environment.PORT, host: "0.0.0.0" });
        app.log.info(`Orbicheck API server listening on http://0.0.0.0:${environment.PORT}`);

        // Run initial refresh job in the background now that everything is running
        void disposableQueue.add('refresh', {});

    } catch (error) {
        if (app?.log) {
            app.log.error({ err: error }, 'Failed to start Orbicheck API');
        } else {
            console.error('Failed to start Orbicheck API:', error);
        }

        if (environment.SENTRY_DSN) {
            Sentry.captureException(error);
        }

        // *** THE FIX: GUARANTEE PROCESS TERMINATION ***
        setTimeout(() => {
            console.error('Process did not exit cleanly, forcing shutdown now.');
            process.exit(1);
        }, 1000).unref();

        // Attempt a clean exit first
        process.exit(1);
    }
}

/**
 * Module entry point: starts the server if run directly (e.g., node server.js).
 */
if (process.argv[1] === import.meta.url.slice(7)) {
    void start();
}