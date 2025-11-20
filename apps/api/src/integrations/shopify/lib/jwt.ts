import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';

const RETRY_HEADER = 'X-Shopify-Retry-Invalid-Session-Request';

export function verifyShopifySessionToken(appKey: string, appSecret: string) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const auth = request.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
        if (!token) {
            reply.header(RETRY_HEADER, '1');
            return reply.code(401).send('Missing Shopify session token');
        }
        try {
            const decoded = jwt.verify(token, appSecret, { algorithms: ['HS256'] }) as any;

            request.log.debug({ shop: decoded.dest, aud: decoded.aud }, 'Verifying Shopify session token');

            if (decoded.aud !== appKey) {
                reply.header(RETRY_HEADER, '1');
                request.log.warn({ shop: decoded.dest, expectedAud: appKey, actualAud: decoded.aud }, 'Shopify session token has invalid audience');
                return reply.code(401).send('Invalid Shopify app key');
            }
            const dest = decoded.dest as string | undefined;
            if (!dest) {
                reply.header(RETRY_HEADER, '1');
                request.log.warn('Shopify session token missing destination');
                return reply.code(401).send('Missing destination in session token');
            }
            const shopDomain = new URL(dest).hostname;
            (request as any).shopHost = dest;
            (request as any).shopDomain = shopDomain;
            (request as any).sessionToken = token;

            request.log.info({ shop: shopDomain }, 'Shopify session token verified successfully');
        } catch (error) {
            reply.header(RETRY_HEADER, '1');
            request.log.warn({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Shopify session token validation failed');
            return reply.code(401).send('Invalid Shopify session token');
        }
    };
}