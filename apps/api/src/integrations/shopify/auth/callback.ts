import { FastifyReply, FastifyRequest } from 'fastify';
import { createShopifyService } from '../../../services/shopify.js';
import { missingScopes, parseScopes } from '../lib/scopes.js';
import { captureShopifyEvent } from '../lib/telemetry.js';

export async function callback(request: FastifyRequest, reply: FastifyReply, pool: any) {
    const { code, shop, state } = request.query as { code: string; shop: string; state: string };
    if (!code || !shop || state !== shop) {
        return reply.code(400).send('Invalid parameters');
    }
    // Exchange code for token
    const clientId = process.env.SHOPIFY_API_KEY!;
    const clientSecret = process.env.SHOPIFY_API_SECRET!;
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
        }),
    });
    if (!res.ok) {
        return reply.code(500).send('Failed to exchange token');
    }
    const { access_token, scope } = await res.json();
    const grantedScopes = parseScopes(scope);
    const missing = missingScopes(grantedScopes);
    if (missing.length > 0) {
        request.log.error({ shop, missing }, 'Shopify install granted incomplete scopes');
        return reply.code(400).send(`Missing required scopes: ${missing.join(', ')}`);
    }

    // Store in DB
    const shopifyService = createShopifyService(pool);
    await shopifyService.storeShopToken(shop, access_token, grantedScopes);
    captureShopifyEvent(shop, 'signup', { scopes: grantedScopes });

    // Redirect to app
    return reply.redirect(`https://${shop}/admin/apps/${clientId}`);
}