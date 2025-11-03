import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import ScalarApiReference from '@scalar/fastify-api-reference'
import type { FastifyInstance, RawServerBase } from 'fastify'

import { API_VERSION, ROUTES } from '../config.js'
import { environment } from '../environment.js'

export async function setupDocumentation<TServer extends RawServerBase = RawServerBase>(app: FastifyInstance<TServer>): Promise<void> {

    app.addHook('onRoute', (routeOptions) => {
        const url = routeOptions.url || ''
        // Hide any route that contains 'internal' in the URL
        if ((
            url.startsWith(ROUTES.DASHBOARD) ||
            url.startsWith(ROUTES.REFERENCE) ||
            url.startsWith(ROUTES.DOCUMENTATION) ||
            url.startsWith(ROUTES.METRICS) ||
            url.startsWith(ROUTES.SETTINGS) ||
            url.startsWith(ROUTES.STATUS) ||
            url.startsWith(ROUTES.HEALTH) ||
            url.startsWith(ROUTES.READY) ||
            url.startsWith(ROUTES.REGISTER) ||
            url.startsWith(ROUTES.LOGIN) ||
            url.startsWith(ROUTES.LOGOUT) ||

            url.startsWith(ROUTES.READY)) && environment.NODE_ENV !== 'local') {
            routeOptions.schema = routeOptions.schema || {};
            routeOptions.schema.hide = true;
        }

        // Hide specific endpoints in production
        if (environment.NODE_ENV !== 'local') {
            if (
                url === ROUTES.REGISTER ||
                url === ROUTES.LOGIN ||
                url === ROUTES.LOGOUT ||
                url === '/v1/data/erase'
            ) {
                routeOptions.schema = routeOptions.schema || {};
                routeOptions.schema.hide = true;
            }
        }
    });

    await app.register(fastifySwagger, {
        openapi: {
            info: {
                title: 'Orbitcheck API',
                description: 'API documentation',
                version: API_VERSION,
            },
            components: {
                securitySchemes: {
                    // Match the names used in your route schemas exactly
                    BearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'PAT', // or leave out if you prefer
                        description: 'Use your Personal Access Token (pat_xxx) for management routes ',
                    },
                    ApiKeyAuth: {
                        type: 'apiKey',
                        in: 'header',
                        name: 'Authorization',
                        description: 'Use your  API Key (ok_xxx) for runtime routes as an API Key',
                    },
                },
            },
            servers: [{ url: environment.BASE_URL, description: 'Development server' }],
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
                url.startsWith(ROUTES.READY) ||
                url.startsWith(ROUTES.REGISTER) ||
                url.startsWith(ROUTES.LOGIN) ||
                url.startsWith(ROUTES.LOGOUT)
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
        transformStaticCSP: (header) => {
            // Update CSP to allow Swagger UI to function properly
            // Allow connect-src to localhost and 127.0.0.1 for API calls
            const apiOrigins = [
                `http://localhost:${environment.PORT}`,
                `http://127.0.0.1:${environment.PORT}`,
                ...(environment.NODE_ENV === 'production' ? [
                    'https://dashboard.orbitcheck.io',
                    'https://api.orbitcheck.io'
                ] : [])
            ].join(' ');

            let csp = header || "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;";

            // Ensure connect-src includes API origins
            if (csp.includes('connect-src')) {
                csp = csp.replace(/connect-src [^;]+/, `connect-src 'self' ${apiOrigins}`);
            } else {
                csp += ` connect-src 'self' ${apiOrigins};`;
            }

            // Ensure style-src allows unsafe-inline for Swagger UI
            if (!csp.includes('style-src') || !csp.includes('unsafe-inline')) {
                if (csp.includes('style-src')) {
                    csp = csp.replace(/style-src [^;]+/, "style-src 'self' 'unsafe-inline'");
                } else {
                    csp += " style-src 'self' 'unsafe-inline';";
                }
            }

            return csp;
        },
    })


    // Public Scalar reference — no content/url; it will use app.swagger()
    await app.register(ScalarApiReference, {
        routePrefix: '/reference',
        // configuration: { ... } // optional UI tweaks
    })
}