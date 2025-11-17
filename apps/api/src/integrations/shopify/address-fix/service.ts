import crypto from 'crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { MUT_TAGS_ADD, shopifyGraphql } from '../lib/graphql.js';
import {
    MUT_FULFILLMENT_ORDER_HOLD,
    MUT_FULFILLMENT_ORDER_RELEASE_HOLD,
    MUT_METAFIELDS_SET,
    MUT_ORDER_UPDATE,
    MUT_TAGS_REMOVE,
    QUERY_FULFILLMENT_ORDERS,
} from './graphql.js';

export interface AddressFixSession {
    id: string;
    shop_domain: string;
    order_id: string;
    order_gid: string;
    customer_email: string | null;
    original_address: Record<string, any>;
    normalized_address: Record<string, any>;
    token_hash: string;
    token_expires_at: Date;
    fix_status: 'pending' | 'confirmed' | 'cancelled';
    fulfillment_hold_ids: string[];
    sent_to_flow_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

export interface CreateSessionParams {
    shopDomain: string;
    orderId: string;
    orderGid: string;
    customerEmail: string | null;
    originalAddress: Record<string, any>;
    normalizedAddress: Record<string, any>;
}

export class AddressFixService {
    constructor(
        private pool: Pool,
        private logger: FastifyBaseLogger
    ) { }

    /**
     * Create or update an address fix session for an order
     */
    async upsertSession(params: CreateSessionParams): Promise<{ session: AddressFixSession; token: string }> {
        const token = this.generateToken();
        const tokenHash = this.hashToken(token);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        const result = await this.pool.query<AddressFixSession>(
            `
      INSERT INTO shopify_order_address_fixes (
        shop_domain, order_id, order_gid, customer_email,
        original_address, normalized_address, token_hash, token_expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (shop_domain, order_id)
      DO UPDATE SET
        normalized_address = EXCLUDED.normalized_address,
        token_hash = EXCLUDED.token_hash,
        token_expires_at = EXCLUDED.token_expires_at,
        updated_at = now()
      RETURNING *
      `,
            [
                params.shopDomain,
                params.orderId,
                params.orderGid,
                params.customerEmail,
                params.originalAddress,
                params.normalizedAddress,
                tokenHash,
                expiresAt,
            ]
        );

        return { session: result.rows[0], token };
    }

    /**
     * Get session by token
     */
    async getSessionByToken(token: string): Promise<AddressFixSession | null> {
        const tokenHash = this.hashToken(token);
        const result = await this.pool.query<AddressFixSession>(
            `
      SELECT * FROM shopify_order_address_fixes
      WHERE token_hash = $1
        AND token_expires_at > now()
        AND fix_status = 'pending'
      `,
            [tokenHash]
        );

        return result.rows[0] || null;
    }

    /**
     * Update session status and fulfillment hold IDs
     */
    async updateSession(
        sessionId: string,
        updates: {
            fix_status?: 'pending' | 'confirmed' | 'cancelled';
            fulfillment_hold_ids?: string[];
            sent_to_flow_at?: Date;
        }
    ): Promise<void> {
        const fields: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (updates.fix_status) {
            fields.push(`fix_status = $${paramIndex++}`);
            values.push(updates.fix_status);
        }
        if (updates.fulfillment_hold_ids) {
            fields.push(`fulfillment_hold_ids = $${paramIndex++}`);
            values.push(updates.fulfillment_hold_ids);
        }
        if (updates.sent_to_flow_at) {
            fields.push(`sent_to_flow_at = $${paramIndex++}`);
            values.push(updates.sent_to_flow_at);
        }

        if (fields.length === 0) return;

        fields.push(`updated_at = now()`);
        values.push(sessionId);

        await this.pool.query(
            `UPDATE shopify_order_address_fixes SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
            values
        );
    }

    /**
     * Add tag and metafield to Shopify order
     */
    async tagOrderForAddressFix(
        shopDomain: string,
        accessToken: string,
        orderGid: string,
        fixUrl: string
    ): Promise<void> {
        const client = await shopifyGraphql(shopDomain, accessToken, process.env.SHOPIFY_API_VERSION || '2024-10');

        // Add tag
        await client.mutate(MUT_TAGS_ADD, {
            id: orderGid,
            tags: ['address_fix_needed'],
        });

        // Add metafield with fix URL
        await client.mutate(MUT_METAFIELDS_SET, {
            metafields: [
                {
                    ownerId: orderGid,
                    namespace: 'orbitcheck',
                    key: 'address_fix_url',
                    value: fixUrl,
                    type: 'single_line_text_field',
                },
            ],
        });

        this.logger.info({ shopDomain, orderGid }, 'Tagged order for address fix');
    }

    /**
     * Poll for fulfillment orders and apply hold
     */
    async pollAndHoldFulfillmentOrders(
        shopDomain: string,
        accessToken: string,
        orderGid: string,
        maxRetries = 5
    ): Promise<string[]> {
        const client = await shopifyGraphql(shopDomain, accessToken, process.env.SHOPIFY_API_VERSION || '2024-10');

        let fulfillmentOrders: any[] = [];
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const response = await client.mutate(QUERY_FULFILLMENT_ORDERS, { orderId: orderGid });
            fulfillmentOrders = response.data?.order?.fulfillmentOrders?.edges || [];

            if (fulfillmentOrders.length > 0) break;

            // Wait before retry (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt), 10000)));
        }

        if (fulfillmentOrders.length === 0) {
            this.logger.warn({ shopDomain, orderGid }, 'No fulfillment orders found after polling');
            return [];
        }

        const holdIds: string[] = [];
        for (const edge of fulfillmentOrders) {
            const foId = edge.node.id;
            try {
                await client.mutate(MUT_FULFILLMENT_ORDER_HOLD, {
                    id: foId,
                    reason: 'INCORRECT_ADDRESS',
                    reasonNotes: 'Address validation failed - customer confirmation required',
                });
                holdIds.push(foId);
                this.logger.info({ shopDomain, orderGid, fulfillmentOrderId: foId }, 'Applied fulfillment hold');
            } catch (error) {
                this.logger.error(
                    { err: error, shopDomain, orderGid, fulfillmentOrderId: foId },
                    'Failed to hold fulfillment order'
                );
            }
        }

        return holdIds;
    }

    /**
     * Release holds and remove tag/metafield
     */
    async confirmAddressFix(
        shopDomain: string,
        accessToken: string,
        session: AddressFixSession,
        useCorrected: boolean
    ): Promise<void> {
        const client = await shopifyGraphql(shopDomain, accessToken, process.env.SHOPIFY_API_VERSION || '2024-10');

        // Update order address if using corrected
        if (useCorrected) {
            const addr = session.normalized_address;
            await client.mutate(MUT_ORDER_UPDATE, {
                input: {
                    id: session.order_gid,
                    shippingAddress: {
                        address1: addr.address1,
                        address2: addr.address2 || null,
                        city: addr.city,
                        province: addr.province,
                        zip: addr.zip,
                        countryCode: addr.country_code,
                        firstName: addr.first_name || null,
                        lastName: addr.last_name || null,
                    },
                },
            });
            this.logger.info({ shopDomain, orderGid: session.order_gid }, 'Updated order with corrected address');
        }

        // Release fulfillment holds
        for (const holdId of session.fulfillment_hold_ids) {
            try {
                await client.mutate(MUT_FULFILLMENT_ORDER_RELEASE_HOLD, { id: holdId });
                this.logger.info({ shopDomain, fulfillmentOrderId: holdId }, 'Released fulfillment hold');
            } catch (error) {
                this.logger.error(
                    { err: error, shopDomain, fulfillmentOrderId: holdId },
                    'Failed to release fulfillment hold'
                );
            }
        }

        // Remove tag
        await client.mutate(MUT_TAGS_REMOVE, {
            id: session.order_gid,
            tags: ['address_fix_needed'],
        });

        // Clear metafield (set to empty)
        await client.mutate(MUT_METAFIELDS_SET, {
            metafields: [
                {
                    ownerId: session.order_gid,
                    namespace: 'orbitcheck',
                    key: 'address_fix_url',
                    value: '',
                    type: 'single_line_text_field',
                },
            ],
        });

        this.logger.info({ shopDomain, orderGid: session.order_gid, useCorrected }, 'Confirmed address fix');
    }

    /**
     * Generate a secure random token
     */
    private generateToken(): string {
        return crypto.randomBytes(32).toString('base64url');
    }

    /**
     * Hash token for storage
     */
    private hashToken(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }
}

export function createAddressFixService(pool: Pool, logger: FastifyBaseLogger): AddressFixService {
    return new AddressFixService(pool, logger);
}
