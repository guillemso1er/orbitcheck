import { FastifyReply, FastifyRequest } from 'fastify';
import { createShopifyService } from '../../../services/shopify.js';

export async function callback(request: FastifyRequest, reply: FastifyReply) {
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

    // Store in DB
    const shopifyService = createShopifyService((request as any).server.pg.pool);
    await shopifyService.storeShopToken(shop, access_token, scope.split(','));

    // Redirect to app
    return reply.redirect(`https://${shop}/admin/apps/${clientId}`);
}