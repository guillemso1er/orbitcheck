import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import ScalarApiReference from '@scalar/fastify-api-reference';
import type { FastifyInstance } from "fastify";
import { API_VERSION, ROUTES } from "../constants.js";
import { environment } from "../environment.js";
import { authenticateRequest } from "../web.js";
import type { Pool } from "pg";
import { STATUS } from "../constants.js";

/**
 * Sets up API documentation plugins including OpenAPI/Swagger, Swagger UI, and Scalar API Reference.
 * Handles both public and authenticated documentation routes.
 */
export async function setupDocumentation(app: FastifyInstance, pool: Pool): Promise<void> {
    // Register OpenAPI/Swagger
    await app.register(async function documentationPlugin(fastify) {
        // Register OpenAPI/Swagger
        await fastify.register(fastifySwagger, {
            openapi: {
                info: {
                    title: 'Orbicheck API',
                    description: 'API documentation',
                    version: API_VERSION
                },
                servers: [{
                    url: `http://localhost:${environment.PORT}`,
                    description: 'Development server'
                }]
            },
            transform: ({ schema, url }: { schema: any; url: string }) => {
                if (url.startsWith('/dashboard') || url.startsWith(ROUTES.DASHBOARD) ||
                    url.startsWith(ROUTES.REFERENCE) || url.startsWith(ROUTES.DOCUMENTATION) ||
                    url.startsWith(ROUTES.STATUS) || url.startsWith(ROUTES.HEALTH) ||
                    url.startsWith(ROUTES.READY)) {
                    return { schema: null as any, url };
                }
                return { schema, url };
            }
        });

        // Register Swagger UI - it handles its own static files
        await fastify.register(fastifySwaggerUi, {
            routePrefix: '/documentation',
            uiConfig: {
                docExpansion: 'list',
                deepLinking: false
            },
            staticCSP: true,
            transformStaticCSP: (header) => header
        });

        // Register Scalar API Reference
        await fastify.register(ScalarApiReference, {
            routePrefix: '/reference',
        });
    });

    // Authenticated dashboard API documentation (embedded in dashboard)
    // This route is protected and will inject user-specific authentication
    app.register(async (app) => {
        // Protect the entire api-reference route
        app.addHook('preHandler', async (request, reply) => {
            await authenticateRequest(request, reply, pool);
        });

        await app.register(ScalarApiReference, {
            routePrefix: '/api-reference',
        });

        // Custom route to serve the Scalar page with user-specific authentication
        app.get('/api-reference/*', async (request, reply) => {
            // Get user's API keys for prefilled authentication
            const userId = (request as any).user_id;
            if (!userId) {
                return reply.status(401).send({ error: 'unauthorized' });
            }

            try {
                // Fetch user's API keys for display (we'll show a masked version)
                const apiKeysResult = await pool.query(
                    'SELECT key_prefix || \'****\' || RIGHT(key_hash, 4) as masked_key FROM api_keys WHERE user_id = $1 AND status = $2 LIMIT 1',
                    [userId, STATUS.ACTIVE]
                );

                const maskedApiKey = apiKeysResult.rows[0]?.masked_key || 'ok_****';

                // In a real implementation, you'd want to securely pass the actual API key
                // For now, we'll show a placeholder that indicates authentication is available
                const apiKey = maskedApiKey;

                // Get user's settings for workspace-specific defaults
                const settingsResult = await pool.query(
                    'SELECT country_defaults, formatting, risk_thresholds FROM user_settings WHERE user_id = $1',
                    [userId]
                );

                const userSettings = settingsResult.rows[0] || {};

            } catch (error) {
                app.log.error({ err: error }, 'Error fetching user data for API docs');
                return reply.status(500).send({ error: 'internal_error' });
            }
        });
    });
}