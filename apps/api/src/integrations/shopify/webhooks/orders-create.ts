import { Queue } from 'bullmq';
import { FastifyReply, FastifyRequest } from 'fastify';
import { type Redis as IORedisType } from 'ioredis';
import type { Pool } from 'pg';
import { evaluateOrderForRiskAndRulesDirect } from '../../../services/orders.js';
import { createShopifyService } from '../../../services/shopify.js';
import { validateAddress as validateAddressUtil } from '../../../validators/address.js';
import { createAddressFixService } from '../address-fix/service.js';
import { MUT_TAGS_ADD, shopifyGraphql } from '../lib/graphql.js';
import { captureShopifyEvent } from '../lib/telemetry.js';
import { OrderEvaluatePayload, ShopifyOrder } from '../lib/types.js';

export async function ordersCreate(request: FastifyRequest, reply: FastifyReply, pool: Pool, redis: IORedisType) {
    const o: ShopifyOrder = request.body as any;
    const shopDomain = (request as any).shopDomain || (request.headers['x-shopify-shop-domain'] as string);
    request.log.info({ shop: shopDomain, orderId: o.id, topic: request.headers['x-shopify-topic'] }, 'Processing orders/create webhook');
    const shopifyService = createShopifyService(pool);
    const mode = await shopifyService.getShopMode(shopDomain);
    if (mode === 'disabled') return reply.code(200).send();

    const payload: OrderEvaluatePayload = {
        order_id: String(o.id),
        customer: {
            email: o.contact_email ?? o.email,
            phone: o.phone ?? o?.shipping_address?.phone,
            first_name: o?.shipping_address?.first_name,
            last_name: o?.shipping_address?.last_name,
        },
        shipping_address: {
            line1: o?.shipping_address?.address1,
            line2: o?.shipping_address?.address2,
            city: o?.shipping_address?.city,
            state: o?.shipping_address?.province,
            postal_code: o?.shipping_address?.zip,
            country: o?.shipping_address?.country_code,
            lat: o?.shipping_address?.latitude ?? undefined,
            lng: o?.shipping_address?.longitude ?? undefined,
        },
        total_amount: parseFloat(o.total_price ?? o.current_total_price ?? '0'),
        currency: o.currency,
        payment_method: derivePaymentMethod(o),
    };

    let result: any = null;
    try {
        request.log.debug({ shop: shopDomain, orderId: payload.order_id }, 'Calling local order evaluation function');

        // For Shopify webhooks, we need to provide a project_id
        // For now, we'll use a default project_id - in a real implementation
        // this would be retrieved from the shop settings or user association
        const project_id = 'default';

        // Call the direct evaluation function instead of making HTTP request
        result = await evaluateOrderForRiskAndRulesDirect(payload, project_id, pool, redis);

        request.log.info({
            shop: shopDomain,
            orderId: payload.order_id,
            action: result?.action,
            riskScore: result?.risk_score,
            tagCount: result?.tags?.length || 0
        }, 'Local order evaluation completed');
    } catch (error) {
        request.log.error({
            shop: shopDomain,
            orderId: payload.order_id,
            error: error instanceof Error ? error.message : 'Unknown error'
        }, 'Failed to call local order evaluation function');
        return reply.code(200).send(); // Return 200 to avoid webhook retries
    }

    const tags = Array.isArray(result?.tags) ? result.tags : [];
    if (tags.length) {
        const orderGid = o.admin_graphql_api_id;
        const tokenData = await shopifyService.getShopToken(shopDomain);
        if (!tokenData) {
            request.log.warn({ shop: shopDomain }, 'Missing Shopify token when trying to tag order');
        } else {
            try {
                request.log.debug({ shop: shopDomain, orderId: payload.order_id, tags }, 'Adding tags to Shopify order');
                const client = await shopifyGraphql(shopDomain, tokenData.access_token, process.env.SHOPIFY_API_VERSION!);
                await client.mutate(MUT_TAGS_ADD, { id: orderGid, tags });
                request.log.info({ shop: shopDomain, orderId: payload.order_id, tags }, 'Successfully added tags to Shopify order');
            } catch (error) {
                request.log.error({
                    err: error instanceof Error ? error.message : 'Unknown error',
                    shop: shopDomain,
                    order: orderGid,
                    tags
                }, 'Failed to add Shopify tags');
            }
        }
    }

    const actionEvent = mapActionToEvent(result?.action);
    if (actionEvent) {
        captureShopifyEvent(shopDomain, actionEvent, {
            order_id: payload.order_id,
            action: result?.action,
            risk_score: result?.risk_score,
            tags,
        });
    }

    if (!tags.length) {
        request.log.debug({ shop: shopDomain, order: payload.order_id, action: result?.action }, 'No new order tags returned');
    }

    // Address fix workflow - run asynchronously after main processing
    queueMicrotask(async () => {
        try {
            await handleOrderAddressFix(request, shopDomain, o, pool, redis);
        } catch (error) {
            request.log.error(
                { err: error, shop: shopDomain, orderId: o.id },
                'Failed to process address fix workflow'
            );
        }
    });

    return reply.code(200).send();
}

/**
 * Handle address validation and fix workflow for Shopify order
 */
async function handleOrderAddressFix(
    request: FastifyRequest,
    shopDomain: string,
    order: ShopifyOrder,
    pool: Pool,
    redis: IORedisType
): Promise<void> {
    const shippingAddr = order.shipping_address;
    if (!shippingAddr || !shippingAddr.address1 || !shippingAddr.city || !shippingAddr.zip) {
        request.log.debug({ shop: shopDomain, orderId: order.id }, 'Skipping address fix - insufficient address data');
        return;
    }

    // Validate the shipping address
    const validationResult = await validateAddressUtil(
        {
            line1: shippingAddr.address1,
            line2: shippingAddr.address2 || undefined,
            city: shippingAddr.city,
            state: shippingAddr.province || undefined,
            postal_code: shippingAddr.zip,
            country: shippingAddr.country_code || 'US',
        },
        pool,
        redis
    );

    // If address is valid and deliverable, no fix needed
    if (validationResult.valid && !validationResult.reason_codes.includes('undeliverable')) {
        request.log.debug({ shop: shopDomain, orderId: order.id }, 'Address is valid - no fix needed');
        return;
    }

    // Create address fix session
    const shopifyService = createShopifyService(pool);
    const tokenData = await shopifyService.getShopToken(shopDomain);
    if (!tokenData) {
        request.log.warn({ shop: shopDomain }, 'No Shopify token for address fix');
        return;
    }

    const addressFixService = createAddressFixService(pool, request.log);
    const { session, token } = await addressFixService.upsertSession({
        shopDomain,
        orderId: String(order.id),
        orderGid: order.admin_graphql_api_id,
        customerEmail: order.contact_email || order.email || null,
        originalAddress: {
            address1: shippingAddr.address1,
            address2: shippingAddr.address2,
            city: shippingAddr.city,
            province: shippingAddr.province,
            zip: shippingAddr.zip,
            country_code: shippingAddr.country_code,
            first_name: shippingAddr.first_name,
            last_name: shippingAddr.last_name,
        },
        normalizedAddress: validationResult.normalized || {
            address1: shippingAddr.address1,
            city: shippingAddr.city,
            province: shippingAddr.province,
            zip: shippingAddr.zip,
            country_code: shippingAddr.country_code,
        },
    });

    // Generate fix URL (will be used in Shopify Flow)
    const fixUrl = `${process.env.APP_URL || 'https://orbitcheck.io'}/apps/address-fix?token=${token}`;

    // Tag order and add metafield
    await addressFixService.tagOrderForAddressFix(
        shopDomain,
        tokenData.access_token,
        order.admin_graphql_api_id,
        fixUrl
    );

    // Queue job to poll and hold fulfillment orders
    const addressFixQueue = new Queue('address_fix', { connection: redis });
    await addressFixQueue.add('hold-fulfillment', {
        shopDomain,
        orderId: String(order.id),
        orderGid: order.admin_graphql_api_id,
        sessionId: session.id,
        pool,
        logger: request.log,
    });

    request.log.info(
        { shop: shopDomain, orderId: order.id, sessionId: session.id },
        'Created address fix session and queued hold job'
    );
}

function derivePaymentMethod(o: ShopifyOrder): string | undefined {
    const gateway = o.gateway?.toLowerCase();
    if (gateway?.includes('stripe') || gateway?.includes('shopify_payments')) return 'card';
    if (gateway?.includes('cod')) return 'cod';
    if (gateway?.includes('bank') || gateway?.includes('transfer')) return 'bank_transfer';
    return undefined;
}

function mapActionToEvent(action?: string | null): string | null {
    switch (action) {
        case 'approve':
            return 'first_validation';
        case 'hold':
            return 'correction';
        case 'block':
            return 'block';
        default:
            return null;
    }
}