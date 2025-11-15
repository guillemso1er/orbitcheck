import { FastifyReply, FastifyRequest } from 'fastify';
import { createShopifyService } from '../../../services/shopify.js';
import { captureShopifyEvent } from '../lib/telemetry.js';

export async function appUninstalled(request: FastifyRequest, reply: FastifyReply) {
    const shop = request.headers['x-shopify-shop-domain'] as string;
    if (!shop) {
        request.log.warn('Received app/uninstalled webhook without shop header');
        return reply.code(400).send('Missing shop');
    }
    const shopifyService = createShopifyService((request as any).server.pg.pool);
    await shopifyService.recordGdprEvent(shop, 'app/uninstalled', request.body as Record<string, unknown>);
    captureShopifyEvent(shop, 'uninstalled');
    request.log.info({ shop }, 'Processing Shopify app/uninstalled webhook');
    await shopifyService.deleteShopData(shop);
    request.log.info({ shop }, 'Shop data removed after uninstall');
    return reply.code(200).send();
}