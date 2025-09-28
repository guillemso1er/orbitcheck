import cors from "@fastify/cors";
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify from "fastify";
import * as Sentry from '@sentry/node';
import { Pool } from "pg";
import IORedis from "ioredis";
import { Queue, Worker } from 'bullmq';
import { env } from "./env";
import { disposableProcessor } from "./jobs/refreshDisposable";
import { registerRoutes } from "./web";
import cron from 'node-cron';
import { exec } from 'node:child_process';
import { runLogRetention } from './cron/retention';

/**
 * Builds and configures the Fastify application instance.
 * Initializes Sentry if configured, sets up Swagger documentation,
 * registers CORS, routes, and a health check endpoint.
 *
 * @param pool - PostgreSQL connection pool for database operations.
 * @param redis - Redis client for caching and rate limiting.
 * @returns {Promise<FastifyInstance>} Configured Fastify app instance.
 */
async function build(pool: Pool, redis: IORedis) {
    if (env.SENTRY_DSN) {
        Sentry.init({
            dsn: env.SENTRY_DSN,
            tracesSampleRate: 1.0,
        });
    }

    const app = Fastify({ logger: { level: env.LOG_LEVEL } });

    // Register @fastify/swagger
    await app.register(fastifySwagger, {
        openapi: {
            info: {
                title: 'My Awesome API',
                description: 'API documentation for my awesome Fastify application',
                version: '0.1.0'
            },
            servers: [{
                url: 'http://localhost:8080',
                description: 'Development server'
            }],
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'Bearer',
                        description: 'Enter "Bearer" followed by your API key'
                    }
                }
            },
            // Add this security requirement
            security: [
                {
                    "bearerAuth": []
                }
            ]
        }
    });

    // Register @fastify/swagger-ui
    await app.register(fastifySwaggerUi, {
        routePrefix: '/documentation',
    });

    await app.register(cors, { origin: true });
    registerRoutes(app, pool, redis);

    app.get("/health", async () => ({ ok: true }));

    return app;
}

(async () => {
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    const app = await build(pool, redis);

    const disposableQueue = new Queue('disposable', { connection: redis });
    const disposableWorker = new Worker('disposable', disposableProcessor, { connection: redis });

    // Schedule daily refresh job
    await disposableQueue.add('refresh', {}, {
        repeat: { pattern: '0 0 * * *' }
    });

    // Run once on startup
    await disposableQueue.add('refresh', {});

    // Log retention cron job - run daily at midnight
    cron.schedule('0 0 * * *', async () => {
      await runLogRetention(pool);
    });

    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`API up on ${env.PORT}`);
})().catch(err => {
    if (env.SENTRY_DSN) {
        Sentry.captureException(err);
    }
    console.error(err);
    process.exit(1);
});