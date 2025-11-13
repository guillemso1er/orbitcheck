import { FastifyReply, FastifyRequest } from 'fastify';

export function setCsp() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const shop = (request.query as any).shop as string || (request as any).shopHost || '';
        const shopDomain = shop.replace(/^https?:\/\//, '');
        reply.header('Content-Security-Policy', `frame-ancestors https://admin.shopify.com https://${shopDomain}`);
    };
}