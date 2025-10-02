import cors from "@fastify/cors";
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import * as Sentry from '@sentry/node';
import { Queue, Worker } from 'bullmq';
import { once } from 'events';
import Fastify from "fastify";
import IORedis from "ioredis";
import cron from 'node-cron';
import { Pool } from "pg";
import { runLogRetention } from './cron/retention';
import { env } from "./env";
import { disposableProcessor } from './jobs/refreshDisposable';
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
export async function build(pool: Pool, redis: IORedis) {
    if (env.SENTRY_DSN) {
        Sentry.init({
            dsn: env.SENTRY_DSN,
            tracesSampleRate: 1.0,
        });
    }

    const app = Fastify({
        logger: {
            level: env.LOG_LEVEL,
            transport: process.env.NODE_ENV !== 'production'
                ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
                : undefined
        },
        requestTimeout: 10_000
    });

    app.setErrorHandler((err, req, reply) => {
        // Fastify throws a specific error when a request times out
        if ((err as any).code === 'FST_ERR_REQUEST_TIMEOUT' || err.name === 'RequestTimeoutError') {
            req.log.error({ method: req.method, url: req.url, reqId: req.id }, 'Request timed out — likely stuck in a hook/handler');
            return reply.status(503).send({ error: 'timeout' });
        }
        req.log.error({ err }, 'Unhandled error');
        reply.status(err.statusCode ?? 500).send({ error: 'internal_error' });
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
                url: `http://localhost:${env.PORT}`,
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
        origin: (origin, callback) => {
            const allowedOrigins = [
                `http://localhost:${env.PORT}`, // API itself for health/docs
                'http://localhost:5173', // Vite dev server
                'https://dashboard.orbicheck.com', // Example prod subdomain
            ];
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'), false);
            }
        },
        credentials: true,
    });

    // Register all API routes with shared pool and redis instances
    registerRoutes(app, pool, redis);

    // Add security headers (equivalent to helmet)
    app.addHook('onSend', async (_req, reply, payload) => {
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('X-Frame-Options', 'DENY');
        reply.header('X-XSS-Protection', '1; mode=block');
        reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
        reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        return payload;
    });



    // Simple health check endpoint for monitoring and load balancers
    app.get("/health", async () => ({ ok: true, timestamp: new Date().toISOString() }));

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
export async function start() {
    // --- Step 1: Initialize and Verify Dependencies ---
    console.log('Initializing dependencies...');
    const pool = new Pool({ connectionString: env.DATABASE_URL });

    try {
        console.log('Attempting to connect to PostgreSQL...');
        const client = await pool.connect();
        console.log('PostgreSQL connection successful. Pinging...');
        await client.query('SELECT 1');
        client.release();
        console.log('PostgreSQL is ready.');
    } catch (err) {
        console.error('FATAL: Could not connect to PostgreSQL. Shutting down.', err);
        process.exit(1);
    }

    // --- Create a dedicated client just for the startup check ---
    const verificationRedis = new IORedis(env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
    });

    try {
        console.log('Attempting to connect to Redis for verification...');
        if (verificationRedis.status !== 'ready') {
            await once(verificationRedis, 'ready');
        }
        await verificationRedis.ping();
        console.log('Redis is ready.');
        // We are done with this client, disconnect it.
        await verificationRedis.quit();
    } catch (err) {
        console.error('FATAL: Could not connect to Redis. Shutting down.', err);
        process.exit(1);
    }

    // --- Create the main Redis client for the application with BullMQ's required options ---
    const appRedis = new IORedis(env.REDIS_URL, {
        maxRetriesPerRequest: null // This is required by BullMQ
    });

    // --- Step 2: Build the App and Start Workers ---
    console.log('All dependencies are connected. Building Fastify app...');
    const app = await build(pool, appRedis);

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
    console.log('Starting server to listen for connections...');
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`Orbicheck API server listening on http://0.0.0.0:${env.PORT}`);

    // Run initial refresh job in the background now that everything is running
    disposableQueue.add('refresh', {});
}

/**
 * Module entry point: starts the server if run directly (e.g., node server.js).
 * Catches startup errors, reports to Sentry if configured, logs to console, and exits with code 1.
 */
if (require.main === module) {
    start().catch(err => {
        if (env.SENTRY_DSN) {
            Sentry.captureException(err);
        }
        console.error('Failed to start Orbicheck API:', err);
        process.exit(1);
    });
}