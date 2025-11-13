import { FastifyReply, FastifyRequest } from 'fastify';
import { createShopifyService } from '../../../services/shopify.js';

export async function appUninstalled(request: FastifyRequest, reply: FastifyReply) {
    const shop = request.headers['x-shopify-shop-domain'] as string;
    // Delete shop tokens/settings
    const shopifyService = createShopifyService((request as any).server.pg.pool);
    await shopifyService.deleteShopData(shop);
    return reply.code(200).send();
}