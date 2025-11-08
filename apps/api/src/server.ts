import cookie from "@fastify/cookie";
import secureSession from '@fastify/secure-session';
import metrics from "@immobiliarelabs/fastify-metrics";
import * as Sentry from '@sentry/node';
import { Queue, Worker } from 'bullmq';
import * as dotenv from 'dotenv';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import Fastify from "fastify";
import { type Redis as IORedisType, Redis } from 'ioredis';
import cron from 'node-cron';
import crypto from 'node:crypto';
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

// Store active workers and cron tasks for cleanup
let activeWorkers: Worker[] = [];
let activeCronTasks: cron.ScheduledTask[] = [];

export async function build(pool: Pool, redis: IORedisType): Promise<FastifyInstance> {
    const isTestEnvironment = process.env.NODE_ENV === 'test';

    // Initialize Sentry only in non-test environments
    if (environment.SENTRY_DSN && !isTestEnvironment) {
        Sentry.init({
            dsn: environment.SENTRY_DSN,
            tracesSampleRate: 1,
        });
    }

    const app = Fastify({
        ...(environment.HTTP2_ENABLED ? { http2: true as const } : {}),
        logger: {
            level: isTestEnvironment ? 'error' : environment.LOG_LEVEL, // Reduce logging in tests
            transport: process.env.NODE_ENV === 'production' || isTestEnvironment
                ? undefined
                : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
        },
        requestTimeout: REQUEST_TIMEOUT_MS,
        bodyLimit: 1024 * 100, // 100KB limit to trigger 413
        trustProxy: true,
    }) as any;

    // Setup API documentation
    await setupDocumentation(app);

    // Add input sanitization hook - use preValidation to catch content-type errors early
    app.addHook('preValidation', async (request: any, reply: any) => {
        if (
            request.url.startsWith('/documentation') ||
            request.url.startsWith('/reference') ||
            request.url.startsWith('/api-reference')
        ) {
            return;
        }
        await inputSanitizationHook(request, reply);
    });

    // Add custom error handler to convert 400 to 413 for payload too large errors
    app.setErrorHandler(async (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
        // Handle body size limit errors - check various conditions
        const isPayloadTooLarge =
            error.code === 'FST_REQ_FILE_TOO_LARGE' ||
            error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ||
            error.statusCode === 413 ||
            (error.statusCode === 400 && (
                error.message?.includes('payload') ||
                error.message?.includes('too large') ||
                error.message?.includes('body')
            ));

        if (isPayloadTooLarge) {
            return reply.status(413).send({
                error: {
                    code: 'payload_too_large',
                    message: 'Request payload too large'
                },
                request_id: (request as any).id || crypto.randomUUID()
            });
        }

        console.log('Unhandled error:', { code: error.code, statusCode: error.statusCode, message: error.message });
        throw error;
    });

    // Skip startup guard in test environment
    if (!isTestEnvironment && process.env.NODE_ENV !== 'production') {
        await app.register(startupGuard);
    }

    // Setup error handler
    await setupErrorHandler(app);

    // Register authenticated documentation routes
    await registerAuthenticatedDocsRoutes(app, pool);

    // Setup CORS
    await setupCors(app);

    // Register cookie support
    await app.register(cookie);

    // Setup secure sessions
    await app.register(secureSession, {
        sessionName: 'session',
        cookieName: 'orbitcheck_session',
        key: Buffer.from(environment.SESSION_SECRET, 'hex'),
        cookie: {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: SESSION_MAX_AGE_MS,
            domain: process.env.NODE_ENV === 'production'
                ? '.orbitcheck.io'
                : undefined
        }
    });

    // Register all API routes
    registerRoutes(app, pool, redis);

    // Enable metrics collection (skip in tests)
    if (!isTestEnvironment) {
        await app.register(metrics, { endpoint: '/metrics' });
    }

    // Register OpenAPI validation
    await openapiValidation(app);

    // Setup security headers
    await setupSecurityHeaders(app);

    // Register health check routes with error handling
    await registerHealthRoutes(app, pool, redis);

    return app as any;
}

async function createTimeoutPromise(ms: number, message: string): Promise<never> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
    throw new Error(message);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return Promise.race([
        promise,
        createTimeoutPromise(ms, message)
    ]);
}

async function closeResources(
    app: FastifyInstance | null,
    pool: Pool | null,
    redis: IORedisType | null
): Promise<void> {
    const isTestEnvironment = process.env.NODE_ENV === 'test';

    if (!isTestEnvironment) {
        console.log('Closing application resources...');
    }

    // Stop all workers
    if (activeWorkers.length > 0) {
        await Promise.allSettled(
            activeWorkers.map(worker => {
                if (worker && typeof worker.close === 'function') {
                    return worker.close();
                }
                return Promise.resolve();
            })
        );
    }
    activeWorkers = [];

    // Stop all cron tasks
    activeCronTasks.forEach(task => {
        if (task && typeof task.stop === 'function') {
            task.stop();
        }
    });
    activeCronTasks = [];

    // Close other resources
    await Promise.allSettled([
        app?.close(),
        pool?.end(),
        redis?.quit(),
    ]);

    if (!isTestEnvironment) {
        console.log('All resources closed.');
    }
}

export async function start(): Promise<void> {
    let app: FastifyInstance | null = null;
    let pool: Pool | null = null;
    let appRedis: IORedisType | null = null;
    const isTestEnvironment = process.env.NODE_ENV === 'test';

    try {
        // Initialize database pool
        pool = new Pool({ connectionString: environment.DATABASE_URL });

        // Verify database connection
        try {
            const client = await pool.connect();
            await client.query('SELECT 1');
            client.release();
        } catch (error) {
            throw new Error(MESSAGES.POSTGRESQL_CONNECTION_FAILED(String(error)));
        }

        // Skip Redis verification in test environment (handled by test setup)
        if (!isTestEnvironment) {
            const verificationRedis = new Redis(environment.REDIS_URL, {
                maxRetriesPerRequest: 3,
                connectTimeout: 5000,
            });

            try {
                if (verificationRedis.status !== 'ready') {
                    await once(verificationRedis, 'ready');
                }
                await verificationRedis.ping();
                await verificationRedis.quit();
            } catch (error) {
                throw new Error(MESSAGES.REDIS_CONNECTION_FAILED(String(error)));
            }
        }

        // Create main Redis client
        appRedis = new Redis(environment.REDIS_URL, {
            maxRetriesPerRequest: null
        });

        // Build the app
        app = await build(pool, appRedis);

        if (!isTestEnvironment) {
            app.log.info('All dependencies are connected. Building Fastify app...');
        }

        // Ensure Redis is ready
        if (appRedis.status !== 'ready') {
            await once(appRedis, 'ready');
        }
        await appRedis.ping();

        // Skip smoke test in test environment
        if (!isTestEnvironment) {
            const timeoutMs = Number(process.env.STARTUP_SMOKETEST_TIMEOUT ?? STARTUP_SMOKE_TEST_TIMEOUT_MS);
            try {
                const response = await withTimeout(
                    app.inject({ method: 'GET', url: ROUTES.HEALTH }),
                    timeoutMs,
                    `Startup smoke test timed out after ${timeoutMs}ms.`
                );

                if (response.statusCode !== 200) {
                    throw new Error(MESSAGES.STARTUP_SMOKE_TEST_FAILED(response.statusCode, response.body));
                }
                app.log.info('Startup smoke test passed.');
            } catch (error) {
                app?.log.error({ err: error }, 'FATAL: Startup check failed.');
                await closeResources(app, pool, appRedis);
                throw error;
            }

            // Setup workers and cron jobs only in non-test environments
            const disposableQueue = new Queue('disposable', { connection: appRedis });

            // Create and track workers
            const disposableWorker = new Worker('disposable', disposableProcessor, { connection: appRedis });
            activeWorkers.push(disposableWorker);

            const batchValidationWorker = new Worker('batch_validation', async (job) => {
                return batchValidationProcessor(job as any, pool!, appRedis!);
            }, { connection: appRedis! });
            activeWorkers.push(batchValidationWorker);

            const batchDedupeWorker = new Worker('batch_dedupe', async (job) => {
                return batchDedupeProcessor(job as any, pool!);
            }, { connection: appRedis! });
            activeWorkers.push(batchDedupeWorker);

            // Schedule recurring job
            await disposableQueue.add('refresh', {}, {
                repeat: { pattern: '0 0 * * *' }
            });

            // Setup and track cron jobs
            const retentionTask = cron.schedule('0 0 * * *', async () => {
                try {
                    await runLogRetention(pool!);
                } catch (error) {
                    app?.log.error({ err: error }, 'Log retention job failed');
                }
            });
            activeCronTasks.push(retentionTask);

            const usageResetTask = cron.schedule('0 0 1 * *', async () => {
                try {
                    const { rows } = await pool!.query('UPDATE users SET monthly_validations_used = 0 RETURNING id');
                    app?.log.info(`Reset monthly validation usage for ${rows.length} users`);
                } catch (error) {
                    app?.log.error({ err: error }, 'Usage reset job failed');
                }
            });
            activeCronTasks.push(usageResetTask);
        }

        // Start listening
        const host = process.env.NODE_ENV === 'local' ? 'localhost' : '0.0.0.0';
        await app.listen({ port: environment.PORT, host });

        if (!isTestEnvironment) {
            app.log.info(`Orbitcheck API server listening on http://${host}:${environment.PORT}`);

            // Run initial refresh job in background
            const disposableQueue = new Queue('disposable', { connection: appRedis });
            void disposableQueue.add('refresh', {}).catch(error => {
                app?.log.error({ err: error }, 'Failed to add initial refresh job');
            });
        }

    } catch (error) {
        if (!isTestEnvironment) {
            if (app?.log) {
                app.log.error({ err: error }, 'Failed to start Orbitcheck API');
            } else {
                console.error('Failed to start Orbitcheck API:', error);
            }

            if (environment.SENTRY_DSN) {
                Sentry.captureException(error);
            }
        }

        await closeResources(app, pool, appRedis);

        if (!isTestEnvironment) {
            setTimeout(() => {
                console.error('Process did not exit cleanly, forcing shutdown now.');
                process.exit(1);
            }, 1000).unref();
        }

        throw error;
    }
}

if (process.argv[1] === import.meta.url.slice(7)) {
    void start();
}