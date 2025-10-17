import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import ScalarApiReference from '@scalar/fastify-api-reference'
import type { FastifyInstance } from 'fastify'

import { API_VERSION,ROUTES } from '../config.js'
import { environment } from '../environment.js'

export async function setupDocumentation(app: FastifyInstance): Promise<void> {

    app.addHook('onRoute', (routeOptions) => {
        const url = routeOptions.url || ''
        // Hide any route that contains 'internal' in the URL
        if (
            url.startsWith(ROUTES.DASHBOARD) ||
            url.startsWith(ROUTES.REFERENCE) ||
            url.startsWith(ROUTES.DOCUMENTATION) ||
            url.startsWith(ROUTES.METRICS) ||
            url.startsWith(ROUTES.SETTINGS) ||
            url.startsWith(ROUTES.STATUS) ||
            url.startsWith(ROUTES.HEALTH) ||

            url.startsWith(ROUTES.READY)) {
            routeOptions.schema = routeOptions.schema || {};
            routeOptions.schema.hide = true;
        }
    });

    await app.register(fastifySwagger, {
        openapi: {
            info: {
                title: 'Orbicheck API',
                description: 'API documentation',
                version: API_VERSION,
            },
            components: {
                securitySchemes: {
                    // Match the names used in your route schemas exactly
                    BearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'JWT', // or leave out if you prefer
                        description: 'Use your API key as a Bearer token: Authorization: Bearer ok_xxx',
                    },
                },
            },
            servers: [{ url: `http://localhost:${environment.PORT}`, description: 'Development server' }],
        },
        transform: ({ schema, url }: { schema: any; url: string }) => {
            if (
                url.startsWith('/dashboard') ||
                url.startsWith(ROUTES.DASHBOARD) ||
                url.startsWith(ROUTES.REFERENCE) ||
                url.startsWith(ROUTES.DOCUMENTATION) ||
                url.startsWith(ROUTES.METRICS) ||
                url.startsWith(ROUTES.SETTINGS) ||
                url.startsWith(ROUTES.STATUS) ||
                url.startsWith(ROUTES.HEALTH) ||
                url.startsWith(ROUTES.READY)
            ) {
                return { schema: null as any, url }
            }

            return { schema, url }
        },
    })

    await app.register(fastifySwaggerUi, {
        routePrefix: '/documentation',
        uiConfig: { docExpansion: 'list', deepLinking: false },
        staticCSP: true,
        transformStaticCSP: (h) => h,
    })


    // Public Scalar reference — no content/url; it will use app.swagger()
    await app.register(ScalarApiReference, {
        routePrefix: '/reference',
        // configuration: { ... } // optional UI tweaks
    })
}