import * as crypto from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { createShopifyService } from '../../../services/shopify.js';
import { missingScopes, parseScopes } from '../lib/scopes.js';

export async function getAccessScopes(request: FastifyRequest, reply: FastifyReply, pool: any) {
    const shop = (request as any).shopDomain || ((request as any).shopHost as string | undefined)?.replace(/^https?:\/\//, '');
    if (!shop) {
        request.log.warn('Missing shop domain for access scopes request');
        return reply.status(400).send({
            error: {
                code: 'MISSING_SHOP_DOMAIN',
                message: 'Shop domain is required but not provided in the request'
            },
            request_id: crypto.randomUUID?.() ?? 'unknown'
        });
    }
    const shopifyService = createShopifyService(pool);
    const tokenData = await shopifyService.getShopToken(shop);
    if (!tokenData) {
        request.log.warn({ shop }, 'Shop not found while checking access scopes');
        return reply.code(404).send({ error: 'Shop not registered' });
    }

    const response = await fetch(`https://${shop}/admin/oauth/access_scopes.json`, {
        headers: {
            'X-Shopify-Access-Token': tokenData.access_token,
        },
    });
    if (!response.ok) {
        request.log.error({ shop, status: response.status }, 'Failed to fetch Shopify access scopes');
        return reply.code(502).send({ error: 'Unable to verify scopes' });
    }
    const { access_scopes } = await response.json();
    const granted = parseScopes((access_scopes as Array<{ handle: string }>).map((scope) => scope.handle));
    const missing = missingScopes(granted);
    if (missing.length) {
        request.log.warn({ shop, missing }, 'Shop missing required Shopify scopes');
    } else {
        request.log.info({ shop }, 'Shop granted all required Shopify scopes');
    }

    return reply.status(200).send({
        access_scopes: granted,
        missing_scopes: missing,
        request_id: crypto.randomUUID?.() ?? 'unknown'
    });
}