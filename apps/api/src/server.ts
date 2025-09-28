import cors from "@fastify/cors";
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify from "fastify";
import cron from 'node-cron';
import { Pool } from "pg";
import IORedis from "ioredis";
import { env } from "./env";
import { refreshDisposableDomains } from "./jobs/refreshDisposable";
import { registerRoutes } from "./web";

async function build() {
    const app = Fastify({ logger: { level: env.LOG_LEVEL } });

    const pool = new Pool({ connectionString: env.DATABASE_URL });
    const redis = new IORedis(env.REDIS_URL);

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
    const app = await build();
    cron.schedule('0 0 * * *', refreshDisposableDomains);

    // Also run it once on startup to ensure data is present immediately
    refreshDisposableDomains();
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`API up on ${env.PORT}`);
})().catch(err => {
    console.error(err);
    process.exit(1);
});