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
        const digest = crypto.createHmac('sha256', secret).update((request as any).rawBody).digest('base64');
        const received = Buffer.from(hmac, 'utf8');
        const expected = Buffer.from(digest, 'utf8');
        const topic = request.headers['x-shopify-topic'];
        const shop = request.headers['x-shopify-shop-domain'];
        if (received.length !== expected.length || !crypto.timingSafeEqual(expected, received)) {
            request.log.warn({ shop, topic }, 'Invalid Shopify webhook HMAC');
            return reply.code(401).send('Invalid HMAC');
        }
        request.log.debug({ shop, topic }, 'Validated Shopify webhook HMAC');
    };
}