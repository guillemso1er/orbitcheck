import 'dotenv/config';

import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import cors from "@fastify/cors";
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

// ... (build function remains the same) ...
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
        requestTimeout: 10_000
    });
    if (process.env.NODE_ENV !== 'production') {
        await app.register(startupGuard);
    }
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    app.setErrorHandler(async (error: Error & { code?: string; statusCode?: number }, request: FastifyRequest, reply: FastifyReply) => {
        // Fastify throws a specific error when a request times out
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

    // Define allowed origins
    const allowedOrigins = new Set([
        `http://localhost:${environment.PORT}`, // API itself for health/docs
        'http://localhost:5173',                // Vite dev server
        'https://dashboard.orbicheck.com',
        'https://api.orbicheck.com'
    ]);

    // Enable CORS restricted to dashboard origin (configure for prod domains)
    // Using a function that returns a value directly instead of callback pattern
    await app.register(cors, {
        origin: async (origin: string | undefined) => {
            // Allow no Origin (e.g., curl/app.inject) or explicitly whitelisted origins
            return !origin || allowedOrigins.has(origin);
        },
        credentials: true,
    });

    // Register all API routes with shared pool and redis instances
    registerRoutes(app, pool, redis);

    // Register OpenAPI validation (after routes are registered)
    await openapiValidation(app);

    // Add security headers (equivalent to helmet)
    app.addHook('onSend', async (request, reply, payload) => {
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('X-Frame-Options', 'DENY');
        reply.header('X-XSS-Protection', '1; mode=block');
        reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
        reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        return payload;
    });


    // Simple health check endpoint for monitoring and load balancers
    app.get("/health", async (): Promise<{ ok: true; timestamp: string }> => ({ ok: true, timestamp: new Date().toISOString() }));

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
            await runLogRetention(pool);
        });

        // --- Step 3: Start Listening ---
        await app.listen({ port: environment.PORT, host: "0.0.0.0" });
        app.log.info(`Orbicheck API server listening on http://0.0.0.0:${environment.PORT}`);

        // Run initial refresh job in the background now that everything is running
        void disposableQueue.add('refresh', {});

    } catch (error) {
        // This outer catch block handles any error from dependency init or the re-thrown smoke test error.
        const logger = app?.log || console;
        logger.error('Failed to start Orbicheck API:', error);

        if (environment.SENTRY_DSN) {
            Sentry.captureException(error);
        }

        // *** THE FIX: GUARANTEE PROCESS TERMINATION ***
        // This is a safeguard. If something is keeping the event loop alive
        // (e.g., a misbehaving plugin like `startupGuard` that started a timer),
        // process.exit() might not terminate the process immediately.
        // This timeout ensures the process is forcefully terminated.
        setTimeout(() => {
            console.error('Process did not exit cleanly, forcing shutdown now.');
            process.exit(1);
        }, 1000).unref(); // .unref() prevents this timeout from keeping the process alive itself

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