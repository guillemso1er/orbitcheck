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

    const app = Fastify({ logger: { level: env.LOG_LEVEL } });

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
          'https://dashboard.orbicheck.local', // Example prod subdomain
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
    app.addHook('preHandler', (req, reply) => {
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('X-Frame-Options', 'DENY');
      reply.header('X-XSS-Protection', '1; mode=block');
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
      reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
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
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    const app = await build(pool, redis);

    const disposableQueue = new Queue('disposable', { connection: redis });
    const disposableWorker = new Worker('disposable', disposableProcessor, { connection: redis });

    // Schedule daily disposable email list refresh job (cron pattern: midnight UTC)
    await disposableQueue.add('refresh', {}, {
        repeat: { pattern: '0 0 * * *' }
    });

    // Run initial refresh on startup to ensure fresh data
    await disposableQueue.add('refresh', {});

    // Daily log retention cleanup at midnight (removes old logs based on RETENTION_DAYS env)
    cron.schedule('0 0 * * *', async () => {
      await runLogRetention(pool);
    });

    // Start server on all interfaces (0.0.0.0 for Docker/container access)
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`Orbicheck API server listening on http://0.0.0.0:${env.PORT}`);
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