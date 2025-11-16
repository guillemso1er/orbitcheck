import { FastifyReply, FastifyRequest } from 'fastify';
import { createShopifyService } from '../../../services/shopify.js';
import { MUT_TAGS_ADD, shopifyGraphql } from '../lib/graphql.js';
import { captureShopifyEvent } from '../lib/telemetry.js';
import { OrderEvaluatePayload, OrderEvaluateResponse, ShopifyOrder } from '../lib/types.js';

export async function ordersCreate(request: FastifyRequest, reply: FastifyReply) {
    const o: ShopifyOrder = request.body as any;
    const shopDomain = (request as any).shopDomain || (request.headers['x-shopify-shop-domain'] as string);
    request.log.info({ shop: shopDomain, orderId: o.id, topic: request.headers['x-shopify-topic'] }, 'Processing orders/create webhook');
    const shopifyService = createShopifyService((request as any).server.pg.pool);
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

    let result: OrderEvaluateResponse | null = null;
    try {
        request.log.debug({ shop: shopDomain, orderId: payload.order_id }, 'Calling OrbitCheck order evaluation API');
        const response = await fetch('https://api.orbitcheck.io/v1/orders/evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            request.log.warn({
                shop: shopDomain,
                orderId: payload.order_id,
                status: response.status,
                statusText: response.statusText
            }, 'OrbitCheck API returned error status');
            return reply.code(200).send(); // Return 200 to avoid webhook retries
        }

        result = await response.json();
        request.log.info({
            shop: shopDomain,
            orderId: payload.order_id,
            action: result?.action,
            riskScore: result?.risk_score,
            tagCount: result?.tags?.length || 0
        }, 'OrbitCheck evaluation completed');
    } catch (error) {
        request.log.error({
            shop: shopDomain,
            orderId: payload.order_id,
            error: error instanceof Error ? error.message : 'Unknown error'
        }, 'Failed to call OrbitCheck API');
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

    return reply.code(200).send();
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