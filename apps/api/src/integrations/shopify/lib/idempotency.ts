import { FastifyReply, FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';

export function preventDuplicates(redis: Redis) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const id = request.headers['x-shopify-webhook-id'] as string;
        if (!id) return reply.code(400).send('Missing webhook ID');

        // Use Redis SETEX with atomic check-and-set to prevent race conditions
        const key = `shopify:webhook:${id}`;

        // First check if key exists
        const exists = await redis.exists(key);
        if (exists) {
            // Key already exists, webhook already processed
            return reply.code(200).send(); // Already processed
        }

        // Set key with expiration (5 minutes TTL)
        await redis.setex(key, 300, '1');

        // Key was set successfully, webhook is new
        return undefined; // Continue with the webhook processing
    };
}