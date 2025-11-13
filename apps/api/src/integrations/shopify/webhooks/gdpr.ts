import { FastifyReply, FastifyRequest } from 'fastify';
import { createShopifyService } from '../../../services/shopify.js';

export async function customersDataRequest(_request: FastifyRequest, reply: FastifyReply) {
    // Since we don't store customer data, just respond
    return reply.code(200).send();
}

export async function customersRedact(_request: FastifyRequest, reply: FastifyReply) {
    // Since we don't store customer data, just respond
    return reply.code(200).send();
}

export async function shopRedact(request: FastifyRequest, reply: FastifyReply) {
    const shop = request.headers['x-shopify-shop-domain'] as string;
    // Delete all shop data asynchronously
    setImmediate(async () => {
        const shopifyService = createShopifyService((request as any).server.pg.pool);
        await shopifyService.deleteShopData(shop);
    });
    return reply.code(200).send();
}