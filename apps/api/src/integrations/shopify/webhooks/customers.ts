import { FastifyReply, FastifyRequest } from 'fastify';

interface ShopifyCustomer {
    id: number;
    email: string;
    default_address?: {
        address1?: string;
        address2?: string;
        city?: string;
        province?: string;
        zip?: string;
        country_code?: string;
        first_name?: string;
        last_name?: string;
    };
}

/**
 * Handle Shopify customers/create webhook
 * Validates and normalizes customer default address for future order processing
 */
export async function customersCreate(request: FastifyRequest, reply: FastifyReply) {
    const customer: ShopifyCustomer = request.body as any;
    const shopDomain = (request as any).shopDomain || (request.headers['x-shopify-shop-domain'] as string);

    request.log.info(
        { shop: shopDomain, customerId: customer.id, topic: request.headers['x-shopify-topic'] },
        'Processing customers/create webhook'
    );

    // TODO: Implement customer address profiling
    // This would call a service method to validate and store normalized address data
    // for use when processing future orders from this customer

    return reply.code(200).send();
}

/**
 * Handle Shopify customers/update webhook
 * Refreshes customer address profile when default address changes
 */
export async function customersUpdate(request: FastifyRequest, reply: FastifyReply) {
    const customer: ShopifyCustomer = request.body as any;
    const shopDomain = (request as any).shopDomain || (request.headers['x-shopify-shop-domain'] as string);

    request.log.info(
        { shop: shopDomain, customerId: customer.id, topic: request.headers['x-shopify-topic'] },
        'Processing customers/update webhook'
    );

    // TODO: Implement customer address profile refresh
    // This would update stored normalized address data when customer updates their default address

    return reply.code(200).send();
}
