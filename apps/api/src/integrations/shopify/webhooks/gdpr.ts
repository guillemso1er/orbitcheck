import { FastifyReply, FastifyRequest } from 'fastify';
import { createShopifyService } from '../../../services/shopify.js';
import { captureShopifyEvent } from '../lib/telemetry.js';

export async function customersDataRequest(_request: FastifyRequest, reply: FastifyReply) {
    const shop = (_request.headers['x-shopify-shop-domain'] as string) || ((_request as any).shopDomain as string);
    if (!shop) {
        _request.log.warn('Missing shop header for customers/data_request webhook');
        return reply.code(400).send('Missing shop');
    }
    const shopifyService = createShopifyService((_request as any).server.pg.pool);
    await shopifyService.recordGdprEvent(shop, 'customers/data_request', _request.body as Record<string, unknown>);
    captureShopifyEvent(shop, 'gdpr_customers_data_request');
    _request.log.info({ shop }, 'Handled Shopify customers/data_request webhook');
    return reply.code(200).send();
}

export async function customersRedact(_request: FastifyRequest, reply: FastifyReply) {
    const shop = (_request.headers['x-shopify-shop-domain'] as string) || ((_request as any).shopDomain as string);
    if (!shop) {
        _request.log.warn('Missing shop header for customers/redact webhook');
        return reply.code(400).send('Missing shop');
    }
    const shopifyService = createShopifyService((_request as any).server.pg.pool);
    await shopifyService.recordGdprEvent(shop, 'customers/redact', _request.body as Record<string, unknown>);
    captureShopifyEvent(shop, 'gdpr_customers_redact');
    _request.log.info({ shop }, 'Handled Shopify customers/redact webhook');
    return reply.code(200).send();
}

export async function shopRedact(request: FastifyRequest, reply: FastifyReply) {
    const shop = request.headers['x-shopify-shop-domain'] as string;
    if (!shop) {
        request.log.warn('Missing shop header for shop/redact webhook');
        return reply.code(400).send('Missing shop');
    }
    const shopifyService = createShopifyService((request as any).server.pg.pool);
    await shopifyService.recordGdprEvent(shop, 'shop/redact', request.body as Record<string, unknown>);
    captureShopifyEvent(shop, 'gdpr_shop_redact');
    request.log.info({ shop }, 'Acknowledged Shopify shop/redact webhook');
    setImmediate(async () => {
        request.log.info({ shop }, 'Purging shop data due to shop/redact');
        await shopifyService.deleteShopData(shop);
    });
    return reply.code(200).send();
}