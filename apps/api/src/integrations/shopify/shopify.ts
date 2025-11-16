// plugins/shopify.ts
import fp from 'fastify-plugin';
import type { Redis as IORedisType } from 'ioredis';
import { setCsp } from './lib/csp.js';
import { rawBody, verifyHmac } from './lib/hmac.js';
import { preventDuplicates } from './lib/idempotency.js';
import { verifyShopifySessionToken } from './lib/jwt.js';


interface ShopifyPluginOpts {
    appKey: string;
    appSecret: string;
    redis: IORedisType;
}

// Important: register this plugin BEFORE registering generated routes.
export default fp<ShopifyPluginOpts>(async function shopifyPlugin(app, opts) {

    const { appKey, appSecret, redis } = opts;

    // Automatically attach the right hooks to Shopify routes that your generator will register.
    app.addHook('onRoute', (routeOptions) => {
        const url = routeOptions.url;

        // Webhook routes: need raw body + HMAC + idempotency
        if (url.startsWith('/integrations/shopify/webhooks/')) {
            // Ensure raw body is available at onRequest stage
            const existingOnRequest = Array.isArray(routeOptions.onRequest)
                ? routeOptions.onRequest
                : routeOptions.onRequest ? [routeOptions.onRequest] : [];
            const existingPreHandler = Array.isArray(routeOptions.preHandler)
                ? routeOptions.preHandler
                : routeOptions.preHandler ? [routeOptions.preHandler] : [];

            routeOptions.onRequest = [rawBody(), ...existingOnRequest];
            routeOptions.preHandler = [
                verifyHmac(appSecret),
                preventDuplicates(redis),
                ...existingPreHandler,
            ];
        }

        // Embedded app API routes: verify Shopify session token
        if (url.startsWith('/integrations/shopify/api/')) {
            const existingPreHandler = Array.isArray(routeOptions.preHandler)
                ? routeOptions.preHandler
                : routeOptions.preHandler ? [routeOptions.preHandler] : [];
            routeOptions.preHandler = [
                verifyShopifySessionToken(appKey, appSecret),
                ...existingPreHandler,
            ];
        }
    });

    // CSP for embedded app pages only
    app.addHook('onSend', async (request, reply, payload) => {
        if (request.url.startsWith('/integrations/shopify')) {
            setCsp()(request, reply);
        }
        return payload;
    });
});

