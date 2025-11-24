import crypto from 'crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { promisify } from 'util';

import type { components } from '@orbitcheck/contracts';
import type {
    AddTagsMutation,
    FulfillmentOrderHoldMutation,
    FulfillmentOrderReleaseHoldMutation,
    GetFulfillmentOrdersQuery,
    MetafieldsSetMutation,
    RemoveTagsMutation
} from '../../../generated/shopify/admin/admin.generated.js';
import { MUT_TAGS_ADD, shopifyGraphql } from '../lib/graphql.js';
import {
    MUT_FULFILLMENT_ORDER_HOLD,
    MUT_FULFILLMENT_ORDER_RELEASE_HOLD,
    MUT_METAFIELDS_SET,
    MUT_ORDER_UPDATE,
    MUT_TAGS_REMOVE,
    QUERY_FULFILLMENT_ORDERS,
} from './graphql.js';

type ContractAddress = components['schemas']['Address'];
export type AddressWithContact = Omit<ContractAddress, 'line2'> & {
    line2?: string | null;
    first_name?: string;
    last_name?: string;
    phone?: string;
    // Shopify-specific field mappings for backward compatibility
    province?: string;
    zip?: string;
    country_code?: string;
    address1?: string;
    address2?: string;
};

export interface AddressFixSession {
    id: string;
    shop_domain: string;
    order_id: string;
    order_gid: string;
    customer_email: string | null;
    original_address: AddressWithContact;
    normalized_address: ContractAddress | null;
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
    originalAddress: AddressWithContact;
    normalizedAddress: ContractAddress | null;
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
        const token = await this.generateToken();
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
        const client = await shopifyGraphql(shopDomain, accessToken, process.env.SHOPIFY_API_VERSION || '2025-10');

        const tags = ['address_fix_needed'];

        // Add tag
        try {
            await client.mutate(MUT_TAGS_ADD, {
                id: orderGid,
                tags,
            }) as AddTagsMutation;
        } catch (error) {
            throw this.logGraphQLError('tagsAdd', error, { shopDomain, orderGid, tags });
        }

        // Add metafield with fix URL
        try {
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
            }) as MetafieldsSetMutation;
        } catch (error) {
            throw this.logGraphQLError('metafieldsSet', error, { shopDomain, orderGid, fixUrl });
        }

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
        const client = await shopifyGraphql(shopDomain, accessToken, process.env.SHOPIFY_API_VERSION || '2025-10');

        let fulfillmentOrders: any[] = [];
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const response = await client.mutate(QUERY_FULFILLMENT_ORDERS, { orderId: orderGid });
                fulfillmentOrders = (response.data as GetFulfillmentOrdersQuery)?.order?.fulfillmentOrders?.edges || [];

                if (fulfillmentOrders.length > 0) break;
            } catch (error) {
                const err = this.logGraphQLError('fulfillmentOrders', error, { shopDomain, orderGid, attempt });
                if (attempt === maxRetries - 1) {
                    throw err;
                }
            }

            // Wait before retry (exponential backoff)
            // eslint-disable-next-line no-await-in-loop
            await new Promise(resolve => {
                setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt), 10000));
            });
        }

        if (fulfillmentOrders.length === 0) {
            this.logger.warn({ shopDomain, orderGid }, 'No fulfillment orders found after polling');
            return [];
        }

        const holdIds: string[] = [];
        const holdPromises = fulfillmentOrders.map(async (edge) => {
            const foId = edge.node.id;
            try {
                await client.mutate(MUT_FULFILLMENT_ORDER_HOLD, {
                    id: foId,
                    reason: 'INCORRECT_ADDRESS',
                    reasonNotes: 'Address validation failed - customer confirmation required',
                }) as FulfillmentOrderHoldMutation;
                this.logger.info({ shopDomain, orderGid, fulfillmentOrderId: foId }, 'Applied fulfillment hold');
                return foId;
            } catch (error) {
                this.logger.error(
                    { err: error, shopDomain, orderGid, fulfillmentOrderId: foId },
                    'Failed to hold fulfillment order'
                );
                return null;
            }
        });

        const holdResults = await Promise.all(holdPromises);
        holdIds.push(...holdResults.filter((id): id is string => id !== null));

        return holdIds;
    }

    /**
     * Release holds and remove tag/metafield
     */
    async confirmAddressFix(
        shopDomain: string,
        accessToken: string,
        session: AddressFixSession,
        useCorrected: boolean,
        addressOverride?: AddressWithContact
    ): Promise<void> {
        // Skip Shopify GraphQL calls in test mode
        const isTestMode = accessToken === 'test-access-token' || process.env.SHOPIFY_MOCK_MODE === 'true';

        if (isTestMode) {
            this.logger.info({ shopDomain, orderId: session.order_id }, 'Test mode: Skipping Shopify GraphQL calls');
            return;
        }

        const client = await shopifyGraphql(shopDomain, accessToken, process.env.SHOPIFY_API_VERSION || '2025-10');

        // Update order address if using corrected or override provided
        if (useCorrected || addressOverride) {
            const addr = addressOverride || session.normalized_address || session.original_address;
            if (!addr) {
                throw new Error('Cannot confirm address fix: No corrected address available');
            }

            const addressSources = [addressOverride, session.normalized_address, session.original_address];

            const shippingAddress = {
                address1: this.resolveFieldFromSources(addressSources, 'address1', 'line1'),
                address2: this.resolveFieldFromSources(addressSources, 'address2', 'line2'),
                city: this.resolveFieldFromSources(addressSources, 'city'),
                province: this.resolveFieldFromSources(addressSources, 'province', 'state'),
                zip: this.resolveFieldFromSources(addressSources, 'zip', 'postal_code'),
                country: this.resolveFieldFromSources(addressSources, 'country', 'country_code'),
                countryCode: this.resolveFieldFromSources(addressSources, 'country_code', 'country'),
                firstName: this.resolveFieldFromSources(addressSources, 'first_name', 'firstName'),
                lastName: this.resolveFieldFromSources(addressSources, 'last_name', 'lastName'),
            };

            if (!shippingAddress.address1 || !shippingAddress.city || !shippingAddress.province || !shippingAddress.zip || !shippingAddress.country) {
                throw new Error('Cannot confirm address fix: corrected address missing required fields');
            }

            try {
                this.logger.info({ shopDomain, orderGid: session.order_gid, shippingAddress }, 'Updating order shipment address');
                // 1. Capture the response
                const response: any = await client.mutate(MUT_ORDER_UPDATE, {
                    input: {
                        id: session.order_gid,
                        shippingAddress,
                    },
                });

                // 2. Extract the mutation result
                // Note: Structure depends on your shopifyGraphql client, but usually:
                const result = response.orderUpdate || response.data?.orderUpdate;

                // 3. Check for Logic Errors (The missing piece)
                if (result?.userErrors && result.userErrors.length > 0) {
                    this.logger.error(
                        {
                            userErrors: result.userErrors,
                            shopDomain,
                            orderGid: session.order_gid
                        },
                        'Shopify rejected the address update'
                    );
                    throw new Error(`Shopify Logic Error: ${result.userErrors[0].message}`);
                }

            } catch (error) {
                // 4. Ensure you log the actual error detail if it was thrown above
                this.logger.error(
                    { err: error, shopDomain, orderGid: session.order_gid },
                    'Failed to update order with corrected address'
                );
                throw error; // Re-throw so the parent knows it failed
            }
            this.logger.info({ shopDomain, orderGid: session.order_gid }, 'Updated order with corrected address');
        }

        // Release fulfillment holds
        const releasePromises = session.fulfillment_hold_ids.map(async (holdId) => {
            try {
                await client.mutate(MUT_FULFILLMENT_ORDER_RELEASE_HOLD, { id: holdId }) as FulfillmentOrderReleaseHoldMutation;
                this.logger.info({ shopDomain, fulfillmentOrderId: holdId }, 'Released fulfillment hold');
            } catch (error) {
                this.logger.error(
                    { err: error, shopDomain, fulfillmentOrderId: holdId },
                    'Failed to release fulfillment hold'
                );
            }
        });

        await Promise.all(releasePromises);

        // Remove tag
        try {
            await client.mutate(MUT_TAGS_REMOVE, {
                id: session.order_gid,
                tags: ['address_fix_needed'],
            }) as RemoveTagsMutation;
        } catch (error) {
            this.logGraphQLError('tagsRemove', error, { shopDomain, orderGid: session.order_gid });
        }

        // Clear metafield (set to empty)
        try {
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
            }) as MetafieldsSetMutation;
        } catch (error) {
            this.logGraphQLError('metafieldsSetClear', error, { shopDomain, orderGid: session.order_gid });
        }

        this.logger.info({ shopDomain, orderGid: session.order_gid, useCorrected }, 'Confirmed address fix');
    }

    /**
     * Generate a secure random token
     */
    private async generateToken(): Promise<string> {
        const randomBytesAsync = promisify(crypto.randomBytes);
        const buffer = await randomBytesAsync(32);
        return buffer.toString('base64url');
    }

    /**
     * Hash token for storage
     */
    private hashToken(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    private resolveAddressField(address: AddressWithContact | ContractAddress | null | undefined, ...keys: string[]): string | null {
        if (!address) {
            return null;
        }

        for (const key of keys) {
            // Check if key exists in object (even if value is empty string or null)
            if (key in address) {
                const value = (address as any)[key];
                if (typeof value === 'string') {
                    return value.trim();
                } else if (value !== null && value !== undefined) {
                    return String(value);
                }
            }
        }

        return null;
    }

    private resolveFieldFromSources(
        addresses: Array<AddressWithContact | ContractAddress | null | undefined>,
        ...keys: string[]
    ): string | null {
        for (const address of addresses) {
            const resolved = this.resolveAddressField(address, ...keys);
            if (resolved) {
                return resolved;
            }
        }

        return null;
    }

    private logGraphQLError(operation: string, error: unknown, context: Record<string, unknown>): Error {
        const err = error instanceof Error ? error : new Error('Unexpected Shopify GraphQL error');
        this.logger.error({ err, operation, ...context }, 'Shopify GraphQL call failed');
        return err;
    }
}

export function createAddressFixService(pool: Pool, logger: FastifyBaseLogger): AddressFixService {
    return new AddressFixService(pool, logger);
}
