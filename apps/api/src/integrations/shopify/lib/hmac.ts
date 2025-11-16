import crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';

export function rawBody() {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
        const chunks: Buffer[] = [];
        const stream = request.raw;
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        (request as any).rawBody = Buffer.concat(chunks);
        request.log.debug({ length: (request as any).rawBody.length }, 'Captured Shopify webhook raw body');
    };
}

export function verifyHmac(secret: string) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
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

        request.log.debug({ shop, topic, bodyLength: rawBody.length }, 'Verifying Shopify webhook HMAC');

        if (received.length !== expected.length || !crypto.timingSafeEqual(expected, received)) {
            request.log.warn({
                shop,
                topic,
                expectedLength: expected.length,
                receivedLength: received.length
            }, 'Invalid Shopify webhook HMAC');
            return reply.code(401).send('Invalid HMAC');
        }

        request.log.info({ shop, topic }, 'Validated Shopify webhook HMAC successfully');
    };
}