import { FastifyReply, FastifyRequest } from 'fastify';
import * as crypto from 'node:crypto';
import { createShopifyService } from '../../../services/shopify.js';
import { Mode } from '../lib/types.js';

export async function getShopSettings(request: FastifyRequest, reply: FastifyReply) {
    const shop = (request as any).shopDomain || ((request as any).shopHost as string | undefined)?.replace(/^https?:\/\//, '');
    const shopifyService = createShopifyService((request as any).server.pg.pool);
    const mode = await shopifyService.getShopMode(shop);
    return reply.status(200).send({
        mode,
        request_id: crypto.randomUUID?.() ?? 'unknown'
    });
}

export async function updateShopSettings(request: FastifyRequest, reply: FastifyReply) {
    const shop = (request as any).shopDomain || ((request as any).shopHost as string | undefined)?.replace(/^https?:\/\//, '');
    const { mode } = request.body as { mode: Mode };
    const shopifyService = createShopifyService((request as any).server.pg.pool);
    await shopifyService.setShopMode(shop, mode);
    return reply.status(200).send({
        mode,
        request_id: crypto.randomUUID?.() ?? 'unknown'
    });
}