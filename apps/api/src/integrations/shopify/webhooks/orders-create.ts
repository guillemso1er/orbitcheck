import { Queue } from 'bullmq';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type Redis as IORedisType } from 'ioredis';
import type { Pool } from 'pg';

import { env } from '../../../environment.js';
import type { ShopifyOrder } from '../../../generated/fastify/index.js';
import type { AddTagsMutation, GetShopNameQuery } from '../../../generated/shopify/admin/admin.generated.js';
import { CompositeEmailService, KlaviyoEmailService, ShopifyFlowEmailService } from '../../../services/email/email-service.js';
import { evaluateOrderForRiskAndRulesDirect } from '../../../services/orders.js';
import { createShopifyService } from '../../../services/shopify.js';
import { validateAddress as validateAddressUtil } from '../../../validators/address.js';
import { createAddressFixService } from '../address-fix/service.js';
import { MUT_TAGS_ADD, QUERY_SHOP_NAME, shopifyGraphql } from '../lib/graphql.js';
import { captureShopifyEvent } from '../lib/telemetry.js';
import type { OrderEvaluatePayload } from '../lib/types.js';

export async function ordersCreate(request: FastifyRequest, reply: FastifyReply, pool: Pool, redis: IORedisType): Promise<any> {
    const o: ShopifyOrder = request.body as any;
    const shopDomain = (request as any).shopDomain || (request.headers['x-shopify-shop-domain'] as string);
    request.log.info({ shop: shopDomain, orderId: o.id, topic: request.headers['x-shopify-topic'] }, 'Processing orders/create webhook');
    const shopifyService = createShopifyService(pool);
    const mode = await shopifyService.getShopMode(shopDomain);
    if (mode === 'disabled') return reply.code(200).send();

    // In 'notify' mode, we evaluate and log but do not tag or fix
    const isActivated = mode === 'activated';
    const isNotify = mode === 'notify';
    const shouldProcess = isActivated || isNotify;

    request.log.info({ shop: shopDomain, mode, isActivated, isNotify, shouldProcess }, 'Shopify app mode resolved');

    const payload: OrderEvaluatePayload = {
        order_id: String(o.id),
        customer: {
            email: o.contact_email || o.email || undefined,
            phone: o.phone || o?.shipping_address?.phone || undefined,
            first_name: o?.shipping_address?.first_name || undefined,
            last_name: o?.shipping_address?.last_name || undefined,
        },
        shipping_address: {
            line1: o?.shipping_address?.address1 || undefined,
            line2: o?.shipping_address?.address2 || undefined,
            city: o?.shipping_address?.city || undefined,
            state: o?.shipping_address?.province || undefined,
            postal_code: o?.shipping_address?.zip || undefined,
            country: o?.shipping_address?.country_code || undefined,
            lat: o?.shipping_address?.latitude || undefined,
            lng: o?.shipping_address?.longitude || undefined,
        },
        total_amount: parseFloat(o.total_price || o.current_total_price || '0'),
        currency: o.currency || 'USD',
        payment_method: undefined, // TODO: Add payment method detection when available in webhook payload
    };

    let result: any = null;
    try {
        request.log.debug({ shop: shopDomain, orderId: payload.order_id }, 'Calling local order evaluation function');

        // Resolve project_id from shopify_shops instead of hardcoded 'default'
        const shopResult = await pool.query(
            'SELECT project_id FROM shopify_shops WHERE shop_domain = $1',
            [shopDomain]
        );

        if (shopResult.rows.length === 0) {
            request.log.error({ shop: shopDomain }, 'Shop not found in database for order evaluation');
            return reply.code(200).send(); // Return 200 to avoid webhook retries
        }

        const project_id = shopResult.rows[0].project_id;

        if (!project_id) {
            request.log.warn(
                { shop: shopDomain, orderId: payload.order_id },
                'Shop has no project_id - onboarding may be incomplete'
            );
            // Use a fallback or skip evaluation
            return reply.code(200).send();
        }

        // Call the direct evaluation function with resolved project_id
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
    if (tags.length && shouldProcess) {
        let orderGid = o.admin_graphql_api_id;
        if (!orderGid && o.id) {
            request.log.warn({ shop: shopDomain, orderId: o.id }, 'Missing admin_graphql_api_id, constructing from ID');
            orderGid = `gid://shopify/Order/${o.id}`;
        }

        if (!orderGid) {
            request.log.error({ shop: shopDomain, order: o }, 'Cannot tag order: Missing both admin_graphql_api_id and id');
            return reply.code(200).send();
        }

        const tokenData = await shopifyService.getShopToken(shopDomain);
        if (!tokenData) {
            request.log.warn({ shop: shopDomain }, 'Missing Shopify token when trying to tag order');
        } else {
            try {
                request.log.debug({ shop: shopDomain, orderId: payload.order_id, tags }, 'Adding tags to Shopify order');
                const client = await shopifyGraphql(shopDomain, tokenData.access_token, process.env.SHOPIFY_API_VERSION!);
                await client.mutate(MUT_TAGS_ADD, { id: orderGid, tags }) as AddTagsMutation;
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
    if (shouldProcess) {
        queueMicrotask(() => {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            (async () => {
                try {
                    await handleOrderAddressFix(request, shopDomain, o, pool, redis, mode);
                } catch (error) {
                    request.log.error(
                        { err: error, shop: shopDomain, orderId: o.id },
                        'Failed to process address fix workflow'
                    );
                }
            })();
        });
    }

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
    redis: IORedisType,
    mode: string
): Promise<void> {
    const shippingAddr = order.shipping_address;
    if (!shippingAddr || !shippingAddr.address1 || !shippingAddr.city || !shippingAddr.zip) {
        request.log.debug({ shop: shopDomain, orderId: order.id }, 'Skipping address fix - insufficient address data');
        return;
    }

    request.log.info({ shop: shopDomain, orderId: order.id }, 'Starting address validation for fix workflow');

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
    request.log.info({ shop: shopDomain, orderId: order.id, valid: validationResult.valid, reason_codes: validationResult.reason_codes }, 'Address validation result');
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
        orderGid: order.admin_graphql_api_id || `gid://shopify/Order/${order.id}`,
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
        normalizedAddress: validationResult.normalized || null,
    });

    // Generate fix URL (will be used in Shopify Flow)
    const fixUrl = `${env.FRONTEND_URL}/apps/address-fix?token=${token}`;

    // Tag order and add metafield
    await addressFixService.tagOrderForAddressFix(
        shopDomain,
        tokenData.access_token,
        order.admin_graphql_api_id || `gid://shopify/Order/${order.id}`,
        fixUrl
    );

    // Queue job to poll and hold fulfillment orders
    // Only hold fulfillment if mode is 'activated'
    if (mode === 'activated') {
        const addressFixQueue = new Queue('address_fix', { connection: redis });
        await addressFixQueue.add('hold-fulfillment', {
            shopDomain,
            orderId: String(order.id),
            orderGid: order.admin_graphql_api_id || `gid://shopify/Order/${order.id}`,
            sessionId: session.id,
        });
        request.log.info(
            { shop: shopDomain, orderId: order.id, sessionId: session.id },
            'Queued hold-fulfillment job (activated mode)'
        );
    } else {
        request.log.info(
            { shop: shopDomain, orderId: order.id, sessionId: session.id, mode },
            'Skipping hold-fulfillment job (notify mode)'
        );
    }

    request.log.info(
        { shop: shopDomain, orderId: order.id, sessionId: session.id },
        'Created address fix session'
    );

    // Fetch shop name if not available
    let shopName: string | undefined;
    try {
        const client = await shopifyGraphql(shopDomain, tokenData.access_token, process.env.SHOPIFY_API_VERSION!);
        const shopData = await client.query(QUERY_SHOP_NAME, {});
        shopName = (shopData.data as GetShopNameQuery).shop.name;
    } catch (error) {
        request.log.warn({ shop: shopDomain, err: error }, 'Failed to fetch shop name');
    }

    // Send email notification
    const emailService = new CompositeEmailService([
        new KlaviyoEmailService(request.log),
        new ShopifyFlowEmailService(request.log)
    ]);

    await emailService.sendAddressFixEmail({
        shopDomain,
        shopName,
        customerEmail: order.contact_email || order.email || '',
        customerName: [shippingAddr.first_name, shippingAddr.last_name].filter(Boolean).join(' '),
        fixUrl,
        orderId: String(order.id),
        orderGid: order.admin_graphql_api_id || `gid://shopify/Order/${order.id}`,
        orderName: `Order #${order.id}`,
        address1: shippingAddr.address1,
        address2: shippingAddr.address2 || undefined,
        city: shippingAddr.city,
        province: shippingAddr.province || '',
        zip: shippingAddr.zip,
        country: shippingAddr.country_code || ''
    });
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