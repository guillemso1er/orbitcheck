// plugins/shopify.ts
import { Readable } from 'node:stream';

// 1. Import the type
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis as IORedisType } from 'ioredis';

import { setCsp } from './lib/csp.js';
import { rawBody, verifyHmac } from './lib/hmac.js';
import { preventDuplicates } from './lib/idempotency.js';


interface ShopifyPluginOpts {
    appSecret: string;
    redis: IORedisType;
}

// 2. Define logic cleanly without forcing a specific type here.
// Let TS infer 'app' and 'opts' based on usage or generic passed to fp.
const shopifyPlugin = async (app: any, opts: ShopifyPluginOpts): Promise<void> => {
    // Note: app: any (or FastifyInstance) allows us to bypass the specific 
    // version mismatch of 'propfind'/'mkcalendar' methods inside the body.
    // Ideally, use FastifyInstance but don't export that specific shape.

    const { appSecret, redis } = opts;

    const captureRawBody = rawBody();
    const hmacVerifier = verifyHmac(appSecret);
    const duplicatePreventer = preventDuplicates(redis);

    app.addHook('preParsing', async (request: any, reply: any, payload: any) => {
        if (request.url.startsWith('/integrations/shopify/webhooks/')) {
            request.log.info('Capturing raw body for Shopify webhook before parsing');
            await captureRawBody(request, reply);
            if (reply.sent) {
                request.log.warn('Raw body capture short-circuited Shopify webhook request');
                return payload;
            }

            const rawBuffer = request.rawBody as Buffer;
            if (rawBuffer) {
                return Readable.from(rawBuffer);
            }
        }
        return payload;
    });

    app.addHook('preHandler', async (request: any, reply: any) => {
        if (!request.url.startsWith('/integrations/shopify/webhooks/')) {
            return;
        }

        request.log.info('Starting HMAC verification for Shopify webhook');
        await hmacVerifier(request, reply);
        if (reply.sent) {
            return;
        }

        await duplicatePreventer(request, reply);
        if (reply.sent) {
            request.log.info('Shopify webhook request treated as duplicate');
            return;
        }
    });

    app.addHook('onSend', async (request: any, reply: any, payload: any) => {
        if (request.url.startsWith('/integrations/shopify')) {
            setCsp()(request, reply);
        }
        return payload;
    });
};

export default fp(shopifyPlugin) as FastifyPluginAsync<ShopifyPluginOpts>;