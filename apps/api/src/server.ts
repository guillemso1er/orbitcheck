// Load environment variables FIRST, before any imports
import * as dotenv from 'dotenv';
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    dotenv.config();
    dotenv.config({ path: '.env.local', override: true });
}

import { once } from 'node:events';

import cookie from "@fastify/cookie";
import secureSession from '@fastify/secure-session';
import metrics from "@immobiliarelabs/fastify-metrics";
import * as Sentry from '@sentry/node';
import { Queue, Worker } from 'bullmq';
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { type Redis as IORedisType, Redis } from 'ioredis';
import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import { Pool } from "pg";

import { MESSAGES, REQUEST_TIMEOUT_MS, ROUTES, SESSION_MAX_AGE_MS, STARTUP_SMOKE_TEST_TIMEOUT_MS } from "./config.js";
import { runLogRetention } from './cron/retention.js';
import { environment } from "./environment.js";
import { shutdownShopifyTelemetry } from './integrations/shopify/lib/telemetry.js';
import { createAddressFixProcessor } from './jobs/addressFix.js';
import { batchDedupeProcessor } from './jobs/batchDedupe.js';
import { batchValidationProcessor } from './jobs/batchValidation.js';
import { disposableProcessor } from './jobs/refreshDisposable.js';
import { inputSanitizationHook } from "./middleware/inputSanitization.js";
import corsPlugin from "./plugins/cors.js";
import documentationPlugin from "./plugins/documentation.js";
import { setupErrorHandler } from "./plugins/errorHandler.js";
import { setupSecurityHeaders } from "./plugins/securityHeaders.js";
import { registerHealthRoutes } from "./routes/health.js";
import { main as seedDatabase } from "./seed.js";
import startupGuard from './startup-guard.js';
import { registerRoutes } from "./web.js";

// Store active workers and cron tasks for cleanup
let activeWorkers: Worker[] = [];
let activeCronTasks: ScheduledTask[] = [];

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
        allowErrorHandlerOverride: false, // Disable error handler override warnings
        ajv: {
            customOptions: {
                strict: false
            }
        }
    }) as any;

    // Setup API documentation
    await app.register(documentationPlugin);

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


    // Skip startup guard in test environment
    if (!isTestEnvironment && process.env.NODE_ENV !== 'production') {
        await app.register(startupGuard);
    }

    // Setup error handler
    await setupErrorHandler(app);

    // Setup CORS
    await app.register(corsPlugin);

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
            // In production behind TLS-terminating proxy, cookies must be secure
            // trustProxy: true ensures Fastify knows the original protocol from X-Forwarded-Proto
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: SESSION_MAX_AGE_MS,
            // Domain without leading dot (modern standard) allows sharing between subdomains
            // orbitcheck.io allows sharing between api.orbitcheck.io and dashboard.orbitcheck.io
            domain: process.env.NODE_ENV === 'production'
                ? 'orbitcheck.io'
                : undefined
        }
    });

    // Register all API routes
    await registerRoutes(app, pool, redis);

    // Enable metrics collection (skip in tests)
    if (!isTestEnvironment) {
        await app.register(metrics, { endpoint: '/metrics' });
    }

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
        // console.log('Closing application resources...');
    }

    await shutdownShopifyTelemetry();

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
    // eslint-disable-next-line require-atomic-updates
    activeWorkers = [];

    // Stop all cron tasks
    activeCronTasks.forEach(task => {
        if (task && typeof task.stop === 'function') {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
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
        // console.log('All resources closed.');
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

        // Run database seeding in development/local environments
        if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
            try {
                if (!isTestEnvironment) {
                    // console.log('Running database seed...');
                }
                await seedDatabase(false);
                if (!isTestEnvironment) {
                    // console.log('Database seed completed.');
                }
            } catch (error) {
                if (!isTestEnvironment) {
                    console.error('Database seeding failed:', error);
                }
                // Don't fail startup on seed error, just log it
            }
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

            const addressFixWorker = new Worker('address_fix', createAddressFixProcessor(pool!, app.log), { connection: appRedis! });
            activeWorkers.push(addressFixWorker);

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
            // eslint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks
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
                process.exitCode = 1;
            }, 1000).unref();
        }

        throw error;
    }
}

if (process.argv[1] === import.meta.url.slice(7)) {
    void start();
}