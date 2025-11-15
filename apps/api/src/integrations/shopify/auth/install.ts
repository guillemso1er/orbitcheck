import { FastifyReply, FastifyRequest } from 'fastify';
import { SHOPIFY_SCOPE_STRING } from '../lib/scopes.js';

export async function install(request: FastifyRequest, reply: FastifyReply) {
    const { shop } = request.query as { shop: string };
    if (!shop) {
        return reply.code(400).send('Missing shop parameter');
    }
    // Assuming env vars are set
    const clientId = process.env.SHOPIFY_API_KEY!;
    const scopes = SHOPIFY_SCOPE_STRING;
    const redirectUri = `${process.env.APP_BASE_URL}/integrations/shopify/auth/callback`;
    const url = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${shop}`;
    return reply.redirect(url);
}