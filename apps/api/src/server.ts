import cookie from "@fastify/cookie";
import secureSession from '@fastify/secure-session';
import metrics from "@immobiliarelabs/fastify-metrics";
import * as Sentry from '@sentry/node';
import { Queue, Worker } from 'bullmq';
import * as dotenv from 'dotenv';
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { type Redis as IORedisType, Redis } from 'ioredis';
import cron from 'node-cron';
import { once } from 'node:events';
import { Pool } from "pg";
import { MESSAGES, REQUEST_TIMEOUT_MS, ROUTES, SESSION_MAX_AGE_MS, STARTUP_SMOKE_TEST_TIMEOUT_MS } from "./config.js";
import { runLogRetention } from './cron/retention.js';
import { environment } from "./environment.js";
import { batchDedupeProcessor } from './jobs/batchDedupe.js';
import { batchValidationProcessor } from './jobs/batchValidation.js';
import { disposableProcessor } from './jobs/refreshDisposable.js';
import { inputSanitizationHook } from "./middleware/inputSanitization.js";
import { setupCors } from "./plugins/cors.js";
import { setupDocumentation } from "./plugins/documentation.js";
import { setupErrorHandler } from "./plugins/errorHandler.js";
import { openapiValidation } from "./plugins/openapi.js";
import { setupSecurityHeaders } from "./plugins/securityHeaders.js";
import { registerAuthenticatedDocsRoutes } from "./routes/authenticatedDocs.js";
import { registerHealthRoutes } from "./routes/health.js";
import startupGuard from './startup-guard.js';
import { registerRoutes } from "./web.js";
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    dotenv.config();
}



export async function build(pool: Pool, redis: IORedisType): Promise<FastifyInstance> {
    if (environment.SENTRY_DSN) {
        Sentry.init({
            dsn: environment.SENTRY_DSN,
            tracesSampleRate: 1,
        });
    }
    const app = Fastify({
        ...(environment.HTTP2_ENABLED ? { http2: true as const } : {}),
        logger: {
            level: environment.LOG_LEVEL,
            transport: process.env.NODE_ENV === 'production'
                ? undefined
                : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
        },
        requestTimeout: REQUEST_TIMEOUT_MS,
        trustProxy: true, // Important for secure cookies behind proxies
    }) as any;

    // Setup API documentation
    await setupDocumentation(app);

    // NOW add input sanitization hook AFTER documentation is registered
    app.addHook('preHandler', async (request: any, reply: any) => {
        if (
            request.url.startsWith('/documentation') ||
            request.url.startsWith('/reference') ||
            request.url.startsWith('/api-reference')
        ) {
            return;
        }
        await inputSanitizationHook(request, reply);
    });

    if (process.env.NODE_ENV !== 'production') {
        await app.register(startupGuard);
    }

    // Setup error handler
    await setupErrorHandler(app);


    // Register authenticated documentation routes
    await registerAuthenticatedDocsRoutes(app, pool);

    // Setup CORS
    await setupCors(app);

    // Register cookie support (required for secure sessions)
    await app.register(cookie);

    // Use secure-session instead of regular session for better security
    // This provides encrypted, stateless sessions
    await app.register(secureSession, {
        sessionName: 'session',
        cookieName: 'orbitcheck_session', // More specific cookie name
        key: Buffer.from(environment.SESSION_SECRET, 'hex'), // Should be 32 bytes hex string
        cookie: {
            path: '/',
            httpOnly: true, // Prevents JavaScript access
            secure: process.env.NODE_ENV === 'production', // HTTPS only in production
            sameSite: 'lax', // CSRF protection while allowing navigation
            maxAge: SESSION_MAX_AGE_MS, // 7 days
            domain: process.env.NODE_ENV === 'production'
                ? '.orbitcheck.io' // Allow subdomain sharing in production
                : undefined
        }
    });

    // Add OIDC support for dashboard authentication (if configured)
    // if (environment.OIDC_ENABLED && environment.OIDC_CLIENT_ID && environment.OIDC_CLIENT_SECRET) {
    //     // Register OIDC plugin here if using one
    //     // Example: await app.register(fastifyOauth2, { ... })
    //     app.log.info('OIDC authentication configured for dashboard');
    // }

    // Register all API routes with shared pool and redis instances
    registerRoutes(app, pool, redis);

    // Enable metrics collection (after routes to ensure auth hooks apply)
    await app.register(metrics, { endpoint: '/metrics' });

    // Register OpenAPI validation (after routes are registered)
    await openapiValidation(app);

    // Setup security headers
    await setupSecurityHeaders(app);

    // Register health check routes
    await registerHealthRoutes(app, pool, redis);

    return app as any;
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
            throw new Error(MESSAGES.POSTGRESQL_CONNECTION_FAILED(String(error)));
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
            throw new Error(MESSAGES.REDIS_CONNECTION_FAILED(String(error)));
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

        const timeoutMs = Number(process.env.STARTUP_SMOKETEST_TIMEOUT ?? STARTUP_SMOKE_TEST_TIMEOUT_MS);
        try {
            const response = await withTimeout(
                app.inject({ method: 'GET', url: ROUTES.HEALTH }),
                timeoutMs,
                `Startup smoke test timed out after ${timeoutMs}ms. A hook/handler is likely not async or not calling done().`
            );

            if (response.statusCode !== 200) {
                throw new Error(MESSAGES.STARTUP_SMOKE_TEST_FAILED(response.statusCode, response.body));
            }
            app.log.info('Startup smoke test passed.');
        } catch (error) {
            // On smoke test failure, log, close resources, then re-throw
            app?.log.error({ err: error }, 'FATAL: Startup check failed. Initiating graceful shutdown.');
            await closeResources(app, pool, appRedis);
            throw error; // Re-throw to be caught by the outer try/catch
        }
        if (process.env.NODE_ENV !== 'test') {


            const disposableQueue = new Queue('disposable', { connection: appRedis });
            new Worker('disposable', disposableProcessor, { connection: appRedis });

            // Batch operation workers
            new Worker('batch_validation', async (job) => {
                return batchValidationProcessor(job as any, pool!, appRedis!);
            }, { connection: appRedis! });

            new Worker('batch_dedupe', async (job) => {
                return batchDedupeProcessor(job as any, pool!);
            }, { connection: appRedis! });

            await disposableQueue.add('refresh', {}, {
                repeat: { pattern: '0 0 * * *' }
            });

            cron.schedule('0 0 * * *', async () => {
                await runLogRetention(pool!);
            });
        }


        // --- Step 3: Start Listening ---
        const host = process.env.NODE_ENV === 'local' ? 'localhost' : '0.0.0.0';
        await app.listen({ port: environment.PORT, host });
        app.log.info(`Orbitcheck API server listening on http://${host}:${environment.PORT}`);

        // Run initial refresh job in the background now that everything is running
        if (process.env.NODE_ENV !== 'test') {
            const disposableQueue = new Queue('disposable', { connection: appRedis });
            void disposableQueue.add('refresh', {});
        }


    } catch (error) {
        if (app?.log) {
            app.log.error({ err: error }, 'Failed to start Orbitcheck API');
        } else {
            console.error('Failed to start Orbitcheck API:', error);
        }

        if (environment.SENTRY_DSN) {
            Sentry.captureException(error);
        }

        // Close resources gracefully before exit
        await closeResources(app, pool, appRedis);

        // Force cleanup after timeout
        setTimeout(() => {
            console.error('Process did not exit cleanly, forcing shutdown now.');
            process.exit(1);
        }, 1000).unref();

        // Attempt a clean exit by throwing error
        throw error;
    }
}

/**
 * Module entry point: starts the server if run directly (e.g., node server.js).
 */
if (process.argv[1] === import.meta.url.slice(7)) {
    void start();
}