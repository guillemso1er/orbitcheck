import type { Job } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';

import { createAddressFixService } from '../integrations/shopify/address-fix/service.js';
import { createShopifyService } from '../services/shopify.js';

export interface AddressFixJobData {
    shopDomain: string;
    orderId: string;
    orderGid: string;
    sessionId: string;
}

/**
 * Factory for BullMQ processor for address fix fulfillment hold workflow
 */
export function createAddressFixProcessor(pool: Pool, logger: FastifyBaseLogger) {
    return async function addressFixProcessor(job: Job<AddressFixJobData>): Promise<void> {
        const { shopDomain, orderGid, sessionId } = job.data;

        logger.info({ shopDomain, orderGid, sessionId }, 'Processing address fix job');

        try {
            // Get shop access token
            const shopifyService = createShopifyService(pool);
            const tokenData = await shopifyService.getShopToken(shopDomain);

            if (!tokenData) {
                throw new Error(`No access token found for shop: ${shopDomain}`);
            }

            // Poll for fulfillment orders and apply holds
            const addressFixService = createAddressFixService(pool, logger);
            const holdIds = await addressFixService.pollAndHoldFulfillmentOrders(
                shopDomain,
                tokenData.access_token,
                orderGid,
                5 // max retries
            );

            // Update session with hold IDs
            if (holdIds.length > 0) {
                await addressFixService.updateSession(sessionId, {
                    fulfillment_hold_ids: holdIds,
                });
                logger.info({ shopDomain, orderGid, holdCount: holdIds.length }, 'Applied fulfillment holds');
            } else {
                logger.warn({ shopDomain, orderGid }, 'No fulfillment orders found to hold');
            }
        } catch (error) {
            logger.error(
                { err: error, shopDomain, orderGid, sessionId },
                'Failed to process address fix job'
            );
            throw error; // Let BullMQ handle retries
        }
    };
}
