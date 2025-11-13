import { FastifyReply, FastifyRequest } from 'fastify';

const processedIds = new Map<string, number>();

export function preventDuplicates() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const id = request.headers['x-shopify-webhook-id'] as string;
        if (!id) return reply.code(400).send('Missing webhook ID');
        const now = Date.now();
        if (processedIds.has(id)) {
            return reply.code(200).send(); // Already processed
        }
        processedIds.set(id, now);
        // Remove after 24h
        setTimeout(() => processedIds.delete(id), 24 * 60 * 60 * 1000);
    };
}