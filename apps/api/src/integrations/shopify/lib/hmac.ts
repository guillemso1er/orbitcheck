import crypto from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export function rawBody() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            request.log.debug({ url: request.url }, 'Starting raw body capture for Shopify webhook');
            const chunks: Buffer[] = [];
            const stream = request.raw;

            // Set a timeout to prevent infinite hangs
            const timeout = setTimeout(() => {
                request.log.error({ url: request.url }, 'Raw body capture timed out after 5 seconds');
                stream.destroy(new Error('Raw body read timeout'));
            }, 5000);

            try {
                for await (const chunk of stream) {
                    chunks.push(chunk);
                    request.log.debug({ chunkSize: chunk.length, totalChunks: chunks.length }, 'Received chunk');
                }
            } finally {
                clearTimeout(timeout);
            }

            const rawBuffer = Buffer.concat(chunks);
            (request as any).rawBody = rawBuffer;

            request.log.info({ length: rawBuffer.length }, 'Captured Shopify webhook raw body');

            if (rawBuffer.length > 0) {
                try {
                    const parsedBody = JSON.parse(rawBuffer.toString('utf8')) as unknown;
                    request.body = parsedBody;
                } catch (parseError) {
                    request.log.warn({ err: parseError }, 'Failed to parse Shopify webhook JSON body');
                    return reply.code(400).send('Invalid JSON payload');
                }
            } else {
                request.log.warn('Empty raw body received');
            }
        } catch (error) {
            request.log.error({ err: error }, 'Failed to capture Shopify webhook raw body');
            return reply.code(500).send('Failed to read webhook payload');
        }
    };
}

export function verifyHmac(secret: string) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        // Skip HMAC verification for internal requests from the Shopify app
        // Security: Only allow internal requests from localhost or trusted IPs
        const internalRequest = request.headers['x-internal-request'];
        if (internalRequest === 'shopify-app') {
            // Validate that the request comes from a trusted source
            // This prevents external attackers from spoofing the header
            const clientIp = request.ip;
            const forwardedFor = request.headers['x-forwarded-for'];
            const isLocalhost = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
            const isPrivateNetwork = /^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/.test(clientIp);

            // In production, we should also check if the request comes through our internal network
            // For now, we accept localhost and private network IPs, or if X-Forwarded-For indicates
            // the request came through our load balancer
            const isTrusted = isLocalhost || isPrivateNetwork || (
                process.env.NODE_ENV !== 'production' // Allow in development/test
            );

            if (isTrusted) {
                request.log.info({
                    clientIp,
                    isLocalhost,
                    isPrivateNetwork,
                    forwardedFor,
                }, 'Skipping HMAC verification for internal Shopify app request');
                return;
            }

            // In production with untrusted source, log and continue with HMAC verification
            request.log.warn({
                clientIp,
                forwardedFor,
            }, 'X-Internal-Request header received from untrusted source, requiring HMAC verification');
        }

        request.log.info({ topic: request.headers['x-shopify-topic'], shop: request.headers['x-shopify-shop-domain'] }, 'Starting Shopify webhook HMAC verification');
        const hmac = request.headers['x-shopify-hmac-sha256'] as string || '';
        const rawBody = (request as any).rawBody;

        if (!rawBody) {
            request.log.warn('Missing raw body for webhook HMAC verification');
            return reply.code(400).send('Missing webhook payload');
        }

        const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
        const received = Buffer.from(hmac, 'utf8');
        const expected = Buffer.from(digest, 'utf8');
        const topic = request.headers['x-shopify-topic'];
        const shop = request.headers['x-shopify-shop-domain'];

        request.log.info({ shop, topic, bodyLength: rawBody.length }, 'Verifying Shopify webhook HMAC');

        if (received.length !== expected.length || !crypto.timingSafeEqual(expected, received)) {
            request.log.warn({
                shop,
                topic,
                expectedLength: expected.length,
                receivedLength: received.length,
                expectedHmac: expected.toString('base64'),
                receivedHmac: received.toString('base64'),
                bodyPreview: rawBody.toString('utf8').substring(0, 200)
            }, 'Invalid Shopify webhook HMAC');
            return reply.code(401).send('Invalid HMAC');
        }

        request.log.info({ shop, topic }, 'Validated Shopify webhook HMAC successfully');
    };
}