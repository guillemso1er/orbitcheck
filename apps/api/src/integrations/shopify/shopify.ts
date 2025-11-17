// plugins/shopify.ts
import fp from 'fastify-plugin';
import type { Redis as IORedisType } from 'ioredis';
import { Readable } from 'node:stream';
import { setCsp } from './lib/csp.js';
import { rawBody, verifyHmac } from './lib/hmac.js';
import { preventDuplicates } from './lib/idempotency.js';


interface ShopifyPluginOpts {
    appSecret: string;
    redis: IORedisType;
}

// Important: register this plugin BEFORE registering generated routes.
export default fp<ShopifyPluginOpts>(async function shopifyPlugin(app, opts) {
    const { appSecret, redis } = opts;

    const captureRawBody = rawBody();
    const hmacVerifier = verifyHmac(appSecret);
    const duplicatePreventer = preventDuplicates(redis);

    // Webhook routes: capture raw body BEFORE Fastify's body parsing
    // Using preParsing hook ensures we get the stream before it's consumed
    app.addHook('preParsing', async (request, reply, payload) => {
        if (request.url.startsWith('/integrations/shopify/webhooks/')) {
            request.log.info('Capturing raw body for Shopify webhook before parsing');
            await captureRawBody(request, reply);
            if (reply.sent) {
                request.log.warn('Raw body capture short-circuited Shopify webhook request');
                return payload;
            }
            request.log.info('Raw body captured, creating new stream for Fastify parser');
            // Create a new readable stream from the captured buffer so Fastify can parse it
            const rawBuffer = (request as any).rawBody as Buffer;
            if (rawBuffer) {
                const newStream = Readable.from(rawBuffer);
                return newStream;
            }
        }
        return payload;
    });

    // Webhook routes: verify HMAC and enforce idempotency before hitting handlers
    app.addHook('preHandler', async (request, reply) => {
        if (!request.url.startsWith('/integrations/shopify/webhooks/')) {
            return;
        }

        request.log.info('Starting HMAC verification for Shopify webhook');
        await hmacVerifier(request, reply);
        if (reply.sent) {
            request.log.warn('Shopify webhook request halted during HMAC verification');
            return;
        }
        request.log.info('HMAC verified, checking idempotency');

        await duplicatePreventer(request, reply);
        if (reply.sent) {
            request.log.info('Shopify webhook request treated as duplicate');
            return;
        }
        request.log.info('Idempotency check passed, proceeding to handler');
    });

    // CSP for embedded app pages only
    app.addHook('onSend', async (request, reply, payload) => {
        if (request.url.startsWith('/integrations/shopify')) {
            setCsp()(request, reply);
        }
        return payload;
    });
});


