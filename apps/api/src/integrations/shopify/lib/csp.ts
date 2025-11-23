import type { FastifyReply, FastifyRequest } from 'fastify';

export function setCsp() {
    return (request: FastifyRequest, reply: FastifyReply) => {
        const shopQuery = (request.query as any).shop as string | undefined;
        const implicitDomain = (request as any).shopDomain || ((request as any).shopHost as string | undefined);
        const shopDomain = (shopQuery || implicitDomain || '').replace(/^https?:\/\//, '');
        reply.header('Content-Security-Policy', `frame-ancestors https://admin.shopify.com https://${shopDomain}`);
    };
}