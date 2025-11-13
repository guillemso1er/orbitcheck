import { FastifyReply, FastifyRequest } from 'fastify';
import { createShopifyService } from '../../../services/shopify.js';
import { MUT_TAGS_ADD, shopifyGraphql } from '../lib/graphql.js';
import { OrderEvaluatePayload, ShopifyOrder } from '../lib/types.js';

export async function ordersCreate(request: FastifyRequest, reply: FastifyReply) {
    const o: ShopifyOrder = request.body as any;
    const shopDomain = request.headers['x-shopify-shop-domain'] as string;
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

    const result = await fetch('https://api.orbitcheck.io/v1/orders/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(r => r.json()).catch(() => null);

    const tags = Array.isArray(result?.tags) ? result.tags : [];
    if (tags.length) {
        const orderGid = o.admin_graphql_api_id;
        const tokenData = await shopifyService.getShopToken(shopDomain);
        if (tokenData) {
            const client = await shopifyGraphql(shopDomain, tokenData.access_token, process.env.SHOPIFY_API_VERSION!);
            await client.mutate(MUT_TAGS_ADD, { id: orderGid, tags });
        }
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