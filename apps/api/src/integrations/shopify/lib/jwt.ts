import { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';

export function verifyShopifySessionToken(appKey: string, appSecret: string) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const auth = request.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
        if (!token) {
            return reply.code(401).send();
        }
        try {
            const decoded = jwt.verify(token, appSecret, { algorithms: ['HS256'] }) as any;
            if (decoded.aud !== appKey) {
                return reply.code(401).send();
            }
            (request as any).shopHost = decoded.dest; // e.g., https://mystore.myshopify.com
        } catch {
            return reply.code(401).send();
        }
    };
}