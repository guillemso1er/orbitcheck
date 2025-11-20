import type { FastifyReply, FastifyRequest } from 'fastify';

import { SHOPIFY_SCOPE_STRING } from '../lib/scopes.js';

export async function install(request: FastifyRequest, reply: FastifyReply) {
    const { shop } = request.query as { shop: string };
    if (!shop) {
        return reply.code(400).send('Missing shop parameter');
    }
    // Assuming env vars are set
    const clientId = process.env.SHOPIFY_API_KEY!;
    const scopes = SHOPIFY_SCOPE_STRING;
    const forwardedHost = request.headers['x-forwarded-host'] as string | undefined;
    const host = forwardedHost || request.headers.host || '';
    const protocolHeader = request.headers['x-forwarded-proto'] as string | undefined;
    const protocol = protocolHeader || request.protocol || 'https';
    const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, '') || `${protocol}://${host}`;
    const redirectUri = `${baseUrl}/integrations/shopify/auth/callback`;
    const url = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${shop}`;
    return reply.redirect(url);
}