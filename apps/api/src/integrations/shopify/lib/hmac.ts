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
    };
}

export function verifyHmac(secret: string) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const hmac = request.headers['x-shopify-hmac-sha256'] as string || '';
        const digest = crypto.createHmac('sha256', secret).update((request as any).rawBody).digest('base64');
        if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac))) {
            return reply.code(401).send();
        }
    };
}