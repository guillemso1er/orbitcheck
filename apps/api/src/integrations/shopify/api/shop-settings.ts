import * as crypto from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { createShopifyService } from '../../../services/shopify.js';
import type { Mode } from '../lib/types.js';

export async function getShopSettings(request: FastifyRequest, reply: FastifyReply, pool: any) {
    const shop = (request as any).shopDomain || ((request as any).shopHost as string | undefined)?.replace(/^https?:\/\//, '');

    if (!shop) {
        return reply.status(400).send({
            error: {
                code: 'MISSING_SHOP_DOMAIN',
                message: 'Shop domain is required but not provided in the request'
            },
            request_id: crypto.randomUUID?.() ?? 'unknown'
        });
    }

    const shopifyService = createShopifyService(pool);
    const mode = await shopifyService.getShopMode(shop);
    return reply.status(200).send({
        mode,
        request_id: crypto.randomUUID?.() ?? 'unknown'
    });
}

export async function updateShopSettings(request: FastifyRequest, reply: FastifyReply, pool: any) {
    const shop = (request as any).shopDomain || ((request as any).shopHost as string | undefined)?.replace(/^https?:\/\//, '');

    if (!shop) {
        return reply.status(400).send({
            error: {
                code: 'MISSING_SHOP_DOMAIN',
                message: 'Shop domain is required but not provided in the request'
            },
            request_id: crypto.randomUUID?.() ?? 'unknown'
        });
    }

    const { mode } = request.body as { mode: Mode };
    const shopifyService = createShopifyService(pool);
    await shopifyService.setShopMode(shop, mode);
    return reply.status(200).send({
        mode,
        request_id: crypto.randomUUID?.() ?? 'unknown'
    });
}