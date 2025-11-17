import { FastifyReply, FastifyRequest } from 'fastify';
import { createAddressFixService } from '../integrations/shopify/address-fix/service.js';
import { createShopifyService } from '../services/shopify.js';

/**
 * GET /integrations/shopify/address-fix/{token}
 * Retrieve address fix session for customer review
 */
export async function getAddressFixSession(request: FastifyRequest, reply: FastifyReply) {
    const { token } = (request.params as any);
    const pool = (request as any).server.pg.pool;

    const addressFixService = createAddressFixService(pool, request.log);
    const session = await addressFixService.getSessionByToken(token);

    if (!session) {
        return reply.code(404).send({
            error: 'NOT_FOUND',
            message: 'Address fix session not found or expired',
        });
    }

    // Return sanitized session data
    return reply.code(200).send({
        id: session.id,
        shop_domain: session.shop_domain,
        order_id: session.order_id,
        order_gid: session.order_gid,
        customer_email: session.customer_email ? maskEmail(session.customer_email) : null,
        original_address: session.original_address,
        normalized_address: session.normalized_address,
        fix_status: session.fix_status,
        token_expires_at: session.token_expires_at,
        created_at: session.created_at,
    });
}

/**
 * POST /integrations/shopify/address-fix/{token}/confirm
 * Confirm customer's address selection and update Shopify order
 */
export async function confirmAddressFixSession(request: FastifyRequest, reply: FastifyReply) {
    const { token } = (request.params as any);
    const { use_corrected, shop_domain } = (request.body as any);
    const pool = (request as any).server.pg.pool;

    const addressFixService = createAddressFixService(pool, request.log);
    const session = await addressFixService.getSessionByToken(token);

    if (!session) {
        return reply.code(404).send({
            error: 'NOT_FOUND',
            message: 'Address fix session not found or expired',
        });
    }

    // Verify shop domain matches
    if (session.shop_domain !== shop_domain) {
        return reply.code(400).send({
            error: 'INVALID_REQUEST',
            message: 'Shop domain mismatch',
        });
    }

    // Get shop access token
    const shopifyService = createShopifyService(pool);
    const tokenData = await shopifyService.getShopToken(shop_domain);

    if (!tokenData) {
        return reply.code(500).send({
            error: 'SERVER_ERROR',
            message: 'Unable to access shop configuration',
        });
    }

    // Confirm the address fix
    await addressFixService.confirmAddressFix(
        shop_domain,
        tokenData.access_token,
        session,
        use_corrected
    );

    // Update session status
    await addressFixService.updateSession(session.id, {
        fix_status: 'confirmed',
    });

    return reply.code(200).send({
        success: true,
        message: use_corrected
            ? 'Address updated and order released for fulfillment'
            : 'Original address confirmed and order released for fulfillment',
    });
}

/**
 * Mask email address for privacy (show first char and domain)
 */
function maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return email;
    return `${local[0]}***@${domain}`;
}
