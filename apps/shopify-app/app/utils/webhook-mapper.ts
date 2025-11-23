import type { ShopifyAddress, ShopifyCustomer, ShopifyOrder, ShopifyShop } from "@orbitcheck/contracts";

import type { Customer, MailingAddress, Order } from "../types/admin.types";

export function parseGid(gid: string | null | undefined): number | null {
    if (!gid) return null;
    const parts = gid.split('/');
    const id = parts[parts.length - 1];
    const parsed = parseInt(id, 10);
    return isNaN(parsed) ? null : parsed;
}

// Helper to map Address
function mapAddress(addr: MailingAddress | null | undefined): ShopifyAddress | undefined {
    if (!addr) return undefined;
    return {
        first_name: addr.firstName,
        last_name: addr.lastName,
        address1: addr.address1,
        address2: addr.address2,
        city: addr.city,
        province: addr.province,
        province_code: addr.provinceCode,
        zip: addr.zip,
        country: addr.country, // GraphQL often returns name in 'country' field
        country_code: addr.countryCodeV2,
        company: addr.company,
        phone: addr.phone,
        latitude: addr.latitude,
        longitude: addr.longitude,
        name: addr.name,
    };
}

export function mapOrderGraphQLToContract(order: Order): ShopifyOrder {
    if (!order) throw new Error("Order data is missing");

    return {
        id: parseGid(order.id)!,
        admin_graphql_api_id: order.id,
        app_id: parseGid(order.app?.id) || null,
        contact_email: order.email, // GraphQL 'email' is often contact email
        email: order.email,
        phone: order.phone,
        created_at: order.createdAt,
        updated_at: order.updatedAt,
        closed_at: order.closedAt,
        cancelled_at: order.cancelledAt,
        cancel_reason: order.cancelReason,
        currency: order.currencyCode,
        buyer_accepts_marketing: null, // Not always directly available on Order root in simple queries, might need Customer
        current_total_price: order.currentTotalPriceSet?.shopMoney?.amount,
        current_total_price_set: order.currentTotalPriceSet ? {
            shop_money: {
                amount: order.currentTotalPriceSet.shopMoney.amount,
                currency_code: order.currentTotalPriceSet.shopMoney.currencyCode
            },
            presentment_money: {
                amount: order.currentTotalPriceSet.presentmentMoney.amount,
                currency_code: order.currentTotalPriceSet.presentmentMoney.currencyCode
            }
        } : undefined,
        current_subtotal_price: order.currentSubtotalPriceSet?.shopMoney?.amount,
        current_subtotal_price_set: order.currentSubtotalPriceSet ? {
            shop_money: {
                amount: order.currentSubtotalPriceSet.shopMoney.amount,
                currency_code: order.currentSubtotalPriceSet.shopMoney.currencyCode
            },
            presentment_money: {
                amount: order.currentSubtotalPriceSet.presentmentMoney.amount,
                currency_code: order.currentSubtotalPriceSet.presentmentMoney.currencyCode
            }
        } : undefined,
        current_shipping_price_set: order.currentShippingPriceSet ? {
            shop_money: {
                amount: order.currentShippingPriceSet.shopMoney.amount,
                currency_code: order.currentShippingPriceSet.shopMoney.currencyCode
            },
            presentment_money: {
                amount: order.currentShippingPriceSet.presentmentMoney.amount,
                currency_code: order.currentShippingPriceSet.presentmentMoney.currencyCode
            }
        } : undefined,
        total_price: order.totalPriceSet?.shopMoney?.amount,
        subtotal_price: order.subtotalPriceSet?.shopMoney?.amount,
        financial_status: order.displayFinancialStatus, // or financialStatus
        fulfillment_status: order.displayFulfillmentStatus, // or fulfillmentStatus
        customer: order.customer ? mapCustomerGraphQLToContract(order.customer) : undefined,
        billing_address: mapAddress(order.billingAddress),
        shipping_address: mapAddress(order.shippingAddress),
        client_details: order.clientIp ? { browser_ip: order.clientIp } : undefined, // Simplified
        line_items: order.lineItems?.edges?.map((edge: any) => ({
            id: parseGid(edge.node.id),
            title: edge.node.title,
            quantity: edge.node.quantity,
            price: edge.node.originalUnitPriceSet?.shopMoney?.amount,
            // Add more fields as needed
        })) || [],
        shipping_lines: order.shippingLines?.edges?.map((edge: any) => ({
            id: parseGid(edge.node.id),
            title: edge.node.title,
            price: edge.node.originalPriceSet?.shopMoney?.amount,
        })) || [],
        discount_codes: [], // Complex to map fully without more data
        tax_lines: [], // Complex to map
        note: order.note,
        tags: order.tags?.join(', '),
    };
}

export function mapCustomerGraphQLToContract(customer: Customer): ShopifyCustomer {
    if (!customer) throw new Error("Customer data is missing");

    return {
        id: parseGid(customer.id)!,
        admin_graphql_api_id: customer.id,
        email: customer.defaultEmailAddress?.emailAddress ?? null,
        phone: customer.defaultPhoneNumber?.phoneNumber ?? null,
        created_at: customer.createdAt,
        updated_at: customer.updatedAt,
        first_name: customer.firstName,
        last_name: customer.lastName,
        state: customer.state,
        note: customer.note,
        verified_email: customer.verifiedEmail,
        tags: customer.tags?.join(', '),
        orders_count: Number(customer.numberOfOrders),
        total_spent: customer.amountSpent?.amount,
        default_address: mapAddress(customer.defaultAddress),
        addresses: (customer.addresses?.map((addr: any) => mapAddress(addr)).filter((a: any) => a !== undefined) || []) as ShopifyAddress[],
        currency: customer.amountSpent?.currencyCode,
        email_marketing_consent: customer.defaultEmailAddress ? {
            state: customer.defaultEmailAddress.marketingState,
            opt_in_level: customer.defaultEmailAddress.marketingOptInLevel,
            consent_updated_at: customer.defaultEmailAddress.marketingUpdatedAt,
        } : null,
        sms_marketing_consent: customer.defaultPhoneNumber ? {
            state: customer.defaultPhoneNumber.marketingState,
            opt_in_level: customer.defaultPhoneNumber.marketingOptInLevel,
            consent_updated_at: customer.defaultPhoneNumber.marketingUpdatedAt,
            consent_collected_from: customer.defaultPhoneNumber.marketingCollectedFrom,
        } : null,
    };
}

export function mapShopPayloadToContract(shop: any): ShopifyShop {
    return {
        id: shop.id,
        admin_graphql_api_id: shop.admin_graphql_api_id, // Payload might not have this, optional in contract
        name: shop.name,
        email: shop.email,
        domain: shop.domain,
        myshopify_domain: shop.myshopify_domain,
        province: shop.province,
        country: shop.country,
        address1: shop.address1,
        address2: shop.address2,
        zip: shop.zip,
        city: shop.city,
        phone: shop.phone,
        latitude: shop.latitude,
        longitude: shop.longitude,
        primary_locale: shop.primary_locale,
        created_at: shop.created_at,
        updated_at: shop.updated_at,
        country_code: shop.country_code,
        country_name: shop.country_name,
        currency: shop.currency,
        customer_email: shop.customer_email,
        timezone: shop.timezone,
        iana_timezone: shop.iana_timezone,
        shop_owner: shop.shop_owner,
    };
}
