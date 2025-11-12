import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import ScalarApiReference from '@scalar/fastify-api-reference'
import type { FastifyInstance, RawServerBase } from 'fastify'

import { managementRoutes, routes } from 'src/routes/routes.js'
import { API_VERSION, ROUTES } from '../config.js'
import { environment } from '../environment.js'

function shouldHideRoute(url: string): boolean {
    return (

        url.startsWith(ROUTES.REFERENCE) ||
        url.startsWith(ROUTES.DOCUMENTATION) ||
        url.startsWith(ROUTES.METRICS) ||
        managementRoutes().some(group =>
            typeof group === 'object' && group !== null &&
            Object.values(group).some(route => typeof route === 'string' && url.startsWith(route))) ||
        url.startsWith(ROUTES.STATUS) ||
        url.startsWith(ROUTES.HEALTH) ||
        url.startsWith(ROUTES.READY) ||
        url.startsWith(ROUTES.AUTH) ||
        Object.values(routes.v1.data.eraseData).some(route => url.startsWith(route)))

        && environment.NODE_ENV === 'production'
}

const apiFaviconSvg = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="331.413 100.998 60 60" width="60px" height="60px">
  <rect x="331.413" y="100.998" width="60" height="60" rx="16" ry="16" fill="#19b6b5" style="stroke-width: 1;" transform="matrix(0.9999999999999999, 0, 0, 0.9999999999999999, 0, -1.4210854715202004e-14)"/>
  <ellipse cx="32" cy="32" rx="26" ry="10" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.4" transform="matrix(0.7071070075035094, -0.7071070075035095, 0.7071070075035094, 0.7071070075035095, 315.9268515173151, 130.70069974286685)" style="stroke-width: 2;"/>
  <path d="M 353.904 125.234 L 361.904 133.234 L 377.904 117.234" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" style="stroke-width: 6;" transform="matrix(0.9999999999999999, 0, 0, 0.9999999999999999, 0, -1.4210854715202004e-14)"/>
  <ellipse cx="32" cy="32" rx="26" ry="10" fill="none" stroke="#ffffff" stroke-width="2.5" transform="matrix(0.7071070075035094, 0.7071070075035095, -0.7071070075035094, 0.7071070075035095, 361.1302820010203, 85.49432431285257)" style="stroke-width: 2.5;"/>
  <circle cx="360.206" cy="143.789" r="3" fill="#ffffff" style="stroke-width: 1;" transform="matrix(0.9999999999999999, 0, 0, 0.9999999999999999, 0, -1.4210854715202004e-14)"/>
  <circle cx="360.703" cy="117.339" r="3" fill="#ffffff" style="stroke-width: 1;" transform="matrix(0.9999999999999999, 0, 0, 0.9999999999999999, 0, -1.4210854715202004e-14)"/>
</svg>`

const faviconDataUrl = `data:image/svg+xml;base64,${Buffer.from(apiFaviconSvg).toString('base64')}`

export async function setupDocumentation<TServer extends RawServerBase = RawServerBase>(app: FastifyInstance<TServer>): Promise<void> {

    app.addHook('onRoute', (routeOptions) => {
        const url = routeOptions.url || ''
        if (shouldHideRoute(url)) {
            routeOptions.schema = routeOptions.schema || {};
            routeOptions.schema.hide = true;
        }
    });

    await app.register(fastifySwagger, {
        openapi: {
            info: {
                title: 'Orbitcheck Docs',
                description: 'API documentation',
                version: API_VERSION,
            },
            components: {
                securitySchemes: {
                    ApiKeyAuth: {            // API Key in header
                        type: 'http',
                        scheme: 'bearer',
                        description: 'Use your  API Key (ok_xxx) for runtime routes as an API Key',

                    },
                    BearerAuth: {            // Personal Access Token (Bearer)
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'PAT',
                        description: 'Use your Personal Access Token (pat_xxx) for management routes ',
                        // documentation hint (e.g., JWT, PAT, opaque)
                    }
                }
            },
            servers: [{ url: environment.BASE_URL, description: `Environment: ${environment.NODE_ENV}` }],
        },
        transform: ({ schema, url }: { schema: any; url: string }) => {
            if (
                shouldHideRoute(url)
            ) {
                return { schema: null as any, url }
            }

            return { schema, url }
        },
    })

    await app.register(fastifySwaggerUi, {
        routePrefix: '/documentation',
        uiConfig: { docExpansion: 'list', deepLinking: false },
        theme: {
            title: 'Orbitcheck Docs',
            favicon: [{
                filename: 'favicon.svg',
                rel: 'icon',
                sizes: '64x64',
                type: 'image/svg+xml',
                content: Buffer.from(apiFaviconSvg, 'utf8')
            }]
        },
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
        configuration: {
            favicon: faviconDataUrl
        }
        // configuration: { ... } // optional UI tweaks
    })
}