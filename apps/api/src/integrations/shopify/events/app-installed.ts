import { FastifyReply, FastifyRequest } from 'fastify';
import { createShopifyService } from '../../../services/shopify.js';
import { missingScopes, parseScopes } from '../lib/scopes.js';
import { captureShopifyEvent } from '../lib/telemetry.js';

type AppInstalledPayload = {
    shop: string;
    accessToken: string;
    grantedScopes: string[] | string;
};

export async function appInstalled(request: FastifyRequest, reply: FastifyReply) {
    const { shop, accessToken, grantedScopes } = request.body as AppInstalledPayload;

    if (!shop || typeof shop !== 'string' || !accessToken || typeof accessToken !== 'string') {
        request.log.warn({ body: request.body }, 'Invalid Shopify app installed payload');
        return reply.code(400).send({
            error: {
                code: 'INVALID_INSTALL_PAYLOAD',
                message: 'The Shopify installation payload is missing the shop or access token.',
            },
        });
    }

    const normalizedScopes = parseScopes(grantedScopes);
    const missing = missingScopes(normalizedScopes);
    if (missing.length > 0) {
        request.log.warn({ shop, missing }, 'Shopify installation missing required scopes');
        return reply.code(400).send({
            error: {
                code: 'MISSING_REQUIRED_SCOPES',
                message: `Missing required scopes: ${missing.join(', ')}`,
            },
        });
    }

    const shopifyService = createShopifyService((request as any).server.pg.pool);
    await shopifyService.storeShopToken(shop, accessToken, normalizedScopes);
    captureShopifyEvent(shop, 'signup', { scopes: normalizedScopes });

    request.log.info({ shop }, 'Registered Shopify installation from app-installed event');

    return reply.code(200).send({ status: 'ok' });
}
