import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import type { ShopifyAddressFixConfirmData, ShopifyAddressFixGetData } from '../../../generated/fastify/types.gen.js';
import { createShopifyService } from '../../../services/shopify.js';
import { createAddressFixService } from './service.js';

export async function getAddressFixSession(
    request: FastifyRequest<{ Params: ShopifyAddressFixGetData['path'] }>,
    reply: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
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
): Promise<FastifyReply> {
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
        request.log.info({
            sessionId: session.id,
            shopDomain: session.shop_domain,
            use_corrected,
            hasAddress: !!address,
            accessToken: shopData.access_token.substring(0, 10) + '...'
        }, 'Starting address fix confirmation');

        // Determine the final address to use and save it to normalized_address
        let finalAddress;
        if (use_corrected) {
            // Using the suggested/normalized address
            finalAddress = session.normalized_address;
        } else if (address) {
            // Using the manually edited address - merge with original to preserve contact info
            finalAddress = {
                ...session.original_address, // Start with original (has first_name, last_name, etc.)
                ...address, // Override with manually edited fields
            };
        } else {
            // Fallback to original
            finalAddress = session.original_address;
        }

        // Update the session with the normalized_address before confirming in Shopify
        if (finalAddress) {
            await service.updateSession(session.id, {
                normalized_address: finalAddress
            });
        }

        // Confirm fix in Shopify (update order, release holds, remove tags)
        await service.confirmAddressFix(
            session.shop_domain,
            shopData.access_token,
            session,
            use_corrected,
            address
        );

        // Update session status to confirmed
        await service.updateSession(session.id, {
            fix_status: 'confirmed'
        });

        return reply.send({ success: true });
    } catch (error) {
        request.log.error({
            err: error,
            session,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
            errorName: error instanceof Error ? error.name : undefined,
            errorCode: (error as any)?.code
        }, 'Failed to confirm address fix');

        // Re-throw to let the error handler deal with it
        throw error;
    }
}
