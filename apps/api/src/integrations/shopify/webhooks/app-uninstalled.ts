import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { createShopifyService } from '../../../services/shopify.js';
import { captureShopifyEvent } from '../lib/telemetry.js';

export async function appUninstalled(request: FastifyRequest, reply: FastifyReply, pool: Pool) {
    const shop = request.headers['x-shopify-shop-domain'] as string;
    if (!shop) {
        request.log.warn('Received app/uninstalled webhook without shop header');
        return reply.code(400).send('Missing shop');
    }

    request.log.info({ shop }, 'Received Shopify app/uninstalled webhook');

    try {
        const shopifyService = createShopifyService(pool);
        request.log.debug({ shop }, 'Recording GDPR uninstall event');
        const recordStart = Date.now();
        await shopifyService.recordGdprEvent(shop, 'app/uninstalled', request.body as Record<string, unknown>);
        request.log.debug({ shop, duration: Date.now() - recordStart }, 'GDPR event recorded');

        captureShopifyEvent(shop, 'uninstalled');
        request.log.info({ shop }, 'Processing Shopify app/uninstalled webhook');
        request.log.debug({ shop }, 'Deleting Shopify shop data');

        const deleteStart = Date.now();
        await shopifyService.deleteShopData(shop);
        request.log.info({ shop, duration: Date.now() - deleteStart }, 'Shop data removed after uninstall');

        return reply.code(200).send();
    } catch (error) {
        request.log.error({ shop, err: error }, 'Failed to handle Shopify app/uninstalled webhook');
        return reply.code(500).send({ error: { code: 'SHOPIFY_APP_UNINSTALLED_FAILED', message: 'Failed to process uninstall webhook' } });
    }
}