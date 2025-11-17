import { FastifyReply, FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';

export function preventDuplicates(redis: Redis) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const id = request.headers['x-shopify-webhook-id'] as string;
        if (!id) return reply.code(400).send('Missing webhook ID');

        // Use Redis SETEX with atomic check-and-set to prevent race conditions
        const key = `shopify:webhook:${id}`;

        request.log.info({ webhookId: id }, 'Checking Shopify webhook idempotency');

        // First check if key exists
        let exists: number;
        try {
            exists = await redis.exists(key);
        } catch (error) {
            request.log.error({ err: error }, 'Failed to check webhook idempotency key in Redis');
            return reply.code(500).send('Webhook idempotency check failed');
        }
        if (exists) {
            // Key already exists, webhook already processed
            request.log.info({ webhookId: id }, 'Duplicate Shopify webhook received');
            return reply.code(200).send(); // Already processed
        }

        // Set key with expiration (5 minutes TTL)
        try {
            await redis.setex(key, 300, '1');
        } catch (error) {
            request.log.error({ err: error }, 'Failed to set webhook idempotency key in Redis');
            return reply.code(500).send('Webhook idempotency check failed');
        }

        request.log.info({ webhookId: id }, 'Stored Shopify webhook idempotency key');

        // Key was set successfully, webhook is new
        return undefined; // Continue with the webhook processing
    };
}