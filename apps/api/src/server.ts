import { once } from 'node:events';

import cors from "@fastify/cors";
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import * as Sentry from '@sentry/node';
import { Queue, Worker } from 'bullmq';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import Fastify from "fastify";
import IORedis from "ioredis";
import cron from 'node-cron';
import { Pool } from "pg";

import { runLogRetention } from './cron/retention';
import { environment } from "./env";
import { disposableProcessor } from './jobs/refreshDisposable';
import startupGuard from './startup-guard';
import { registerRoutes } from "./web";

/**
 * Builds and configures the Fastify server instance with middleware, plugins, and routes.
 * Initializes error monitoring with Sentry (if DSN provided), sets up OpenAPI/Swagger documentation
 * for API specs and UI, enables CORS for cross-origin requests, registers all route modules,
 * and adds a simple health check endpoint. Configures logger level from environment.
 *
 * @param pool - PostgreSQL connection pool for all database interactions (queries, migrations).
 * @param redis - ioredis client for caching, rate limiting, idempotency keys, and session storage.
 * @returns {Promise<FastifyInstance>} Fully configured Fastify application ready for listening.
 */
export async function build(pool: Pool, redis: IORedis): Promise<FastifyInstance> {
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

    app.setErrorHandler((error: Error & { code?: string; statusCode?: number }, request: FastifyRequest, reply: FastifyReply) => {
        // Fastify throws a specific error when a request times out
        if (error.code === 'FST_ERR_REQUEST_TIMEOUT' || error.name === 'RequestTimeoutError') {
            request.log.error({ method: request.method, url: request.url, reqId: request.id }, 'Request timed out — likely stuck in a hook/handler');
            return reply.status(503).send({ error: 'timeout' });
        }
        request.log.error({ err: error }, 'Unhandled error');
        reply.status(error.statusCode ?? 500).send({ error: 'internal_error' });
    });

    // Register OpenAPI/Swagger for automatic API documentation generation
    await app.register(fastifySwagger, {
        openapi: {
            info: {
                title: 'Orbicheck API',
                description: 'Validation and risk assessment API for emails, phones, addresses, tax IDs, and orders.',
                version: '1.0.0'
            },
            servers: [{
                url: `http://localhost:${environment.PORT}`,
                description: 'Development server'
            }],
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'Bearer',
                        description: 'Enter "Bearer" followed by your API key (e.g., Bearer ok_abcdef...)'
                    }
                }
            },
            security: [
                {
                    "bearerAuth": []
                }
            ]
        }
    });

    // Register Swagger UI for interactive API documentation at /documentation
    await app.register(fastifySwaggerUi, {
        routePrefix: '/documentation',
    });

    // Enable CORS restricted to dashboard origin (configure for prod domains)
    await app.register(cors, {
        origin: (origin: string | undefined): boolean => {
            const allowedOrigins = [
                `http://localhost:${environment.PORT}`, // API itself for health/docs
                'http://localhost:5173', // Vite dev server
                'https://dashboard.orbicheck.com', // Example prod subdomain
            ];
            return !origin || allowedOrigins.includes(origin);
        },
        credentials: true,
    });

    // Register all API routes with shared pool and redis instances
    registerRoutes(app, pool, redis);

    // Add security headers (equivalent to helmet)
    app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
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
 * Starts the API server: initializes database pool and Redis client,
 * builds the Fastify app, sets up BullMQ queue/worker for disposable email processing,
 * schedules recurring jobs (daily refresh, log retention), and starts listening.
 * Handles startup errors with Sentry capture and process exit.
 *
 * @returns {Promise<void>} Starts the server asynchronously; throws on failure.
 */
export async function start(): Promise<void> {
    // --- Step 1: Initialize and Verify Dependencies ---
    const pool = new Pool({ connectionString: environment.DATABASE_URL });

    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
    } catch (error) {
        throw new Error(`FATAL: Could not connect to PostgreSQL. Shutting down. ${error}`);
    }

    // --- Create a dedicated client just for the startup check ---
    const verificationRedis = new IORedis(environment.REDIS_URL, {
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
        throw new Error(`FATAL: Could not connect to Redis. Shutting down. ${error}`);
    }

    // --- Create the main Redis client for the application with BullMQ's required options ---
    const appRedis = new IORedis(environment.REDIS_URL, {
        maxRetriesPerRequest: null // This is required by BullMQ
    });

    function withTimeout<T>(p: Promise<T>, ms: number, message: string) {
        return new Promise<T>((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(message)), ms);
            p.then(
                (v) => { clearTimeout(t); resolve(v); },
                (error) => { clearTimeout(t); reject(error); }
            );
        });
    }
    console.log('All dependencies are connected. Building Fastify app...');

    // --- Step 2: Build the App and Start Workers ---
    const app = await build(pool, appRedis);
    if (process.env.NODE_ENV !== 'production') {
        await app.register(startupGuard);
    }
    const timeoutMs = Number(process.env.STARTUP_SMOKETEST_TIMEOUT ?? 2000);
    try {
        const res = await withTimeout(
            app.inject({ method: 'GET', url: '/health' }),
            timeoutMs,
            `Startup smoke test timed out after ${timeoutMs}ms. A hook/handler is likely not async or not calling done().`
        );
        if (res.statusCode !== 200) {
            throw new Error(`Startup smoke test failed: /health returned ${res.statusCode}. Body: ${res.body}`);
        }
        console.log('Startup smoke test passed.');
    } catch (error) {
        console.error('FATAL: Startup check failed:', error);
        process.exit(1);
    }
    const disposableQueue = new Queue('disposable', { connection: appRedis });
    const disposableWorker = new Worker('disposable',
        disposableProcessor, { connection: appRedis });


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
}

/**
 * Module entry point: starts the server if run directly (e.g., node server.js).
 * Catches startup errors, reports to Sentry if configured, logs to console, and exits with code 1.
 */
if (require.main === module) {
    start().catch(error => {
        if (environment.SENTRY_DSN) {
            Sentry.captureException(error);
        }
        console.error('Failed to start Orbicheck API:', error);
        process.exit(1); // eslint-disable-line n/no-process-exit
    });
}