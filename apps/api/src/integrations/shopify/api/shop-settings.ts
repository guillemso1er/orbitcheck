import { FastifyReply, FastifyRequest } from 'fastify';
import { createShopifyService } from '../../../services/shopify.js';
import { Mode } from '../lib/types.js';

export async function getShopSettings(request: FastifyRequest, _reply: FastifyReply) {
    const shop = (request as any).shopHost.replace(/^https?:\/\//, '');
    const shopifyService = createShopifyService((request as any).server.pg.pool);
    const mode = await shopifyService.getShopMode(shop);
    return { mode };
}

export async function updateShopSettings(request: FastifyRequest, _reply: FastifyReply) {
    const shop = (request as any).shopHost.replace(/^https?:\/\//, '');
    const { mode } = request.body as { mode: Mode };
    const shopifyService = createShopifyService((request as any).server.pg.pool);
    await shopifyService.setShopMode(shop, mode);
    return { mode };
}