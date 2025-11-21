import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import type { ShopifyAddressFixConfirmData, ShopifyAddressFixGetData } from '../generated/fastify/types.gen.js';
import { createAddressFixService } from '../integrations/shopify/address-fix/service.js';
import { createShopifyService } from '../services/shopify.js';

export async function getAddressFixSession(
    request: FastifyRequest<{ Params: ShopifyAddressFixGetData['path'] }>,
    reply: FastifyReply,
    pool: Pool
) {
    const { token } = request.params;
    const service = createAddressFixService(pool, request.log);
    const session = await service.getSessionByToken(token);

    if (!session) {
        return reply.status(404).send({
            error: {
                code: 'SESSION_NOT_FOUND',
                message: 'Address fix session not found or expired'
            }
        });
    }

    return reply.send(session);
}

export async function confirmAddressFixSession(
    request: FastifyRequest<{ Params: ShopifyAddressFixConfirmData['path'], Body: ShopifyAddressFixConfirmData['body'] }>,
    reply: FastifyReply,
    pool: Pool
) {
    const { token } = request.params;
    const { use_corrected, address } = request.body;
    const service = createAddressFixService(pool, request.log);
    const shopifyService = createShopifyService(pool);

    const session = await service.getSessionByToken(token);
    if (!session) {
        return reply.status(404).send({
            error: {
                code: 'SESSION_NOT_FOUND',
                message: 'Address fix session not found or expired'
            }
        });
    }

    if (session.fix_status !== 'pending') {
        return reply.status(400).send({
            error: {
                code: 'SESSION_ALREADY_PROCESSED',
                message: 'Address fix session has already been processed'
            }
        });
    }

    // Get shop access token
    const shopData = await shopifyService.getShopToken(session.shop_domain);
    if (!shopData) {
        return reply.status(404).send({
            error: {
                code: 'SHOP_NOT_FOUND',
                message: 'Shop not found'
            }
        });
    }

    try {
        // Confirm fix in Shopify (update order, release holds, remove tags)
        await service.confirmAddressFix(
            session.shop_domain,
            shopData.access_token,
            session,
            use_corrected,
            address
        );

        // Update session status
        await service.updateSession(session.id, {
            fix_status: 'confirmed'
        });

        return reply.send({ success: true });
    } catch (error) {
        request.log.error({ err: error, session }, 'Failed to confirm address fix');
        return reply.status(500).send({
            error: {
                code: 'CONFIRMATION_FAILED',
                message: 'Failed to confirm address fix'
            }
        });
    }
}
