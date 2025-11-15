import { FastifyReply, FastifyRequest } from 'fastify';
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
            if (decoded.aud !== appKey) {
                reply.header(RETRY_HEADER, '1');
                return reply.code(401).send('Invalid Shopify app key');
            }
            const dest = decoded.dest as string | undefined;
            if (!dest) {
                reply.header(RETRY_HEADER, '1');
                return reply.code(401).send('Missing destination in session token');
            }
            const shopDomain = new URL(dest).hostname;
            (request as any).shopHost = dest;
            (request as any).shopDomain = shopDomain;
            (request as any).sessionToken = token;
        } catch {
            reply.header(RETRY_HEADER, '1');
            request.log.warn('Shopify session token validation failed');
            return reply.code(401).send('Invalid Shopify session token');
        }
    };
}