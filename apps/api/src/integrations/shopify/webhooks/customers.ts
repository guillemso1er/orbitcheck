import type { FastifyReply, FastifyRequest } from 'fastify';


import { normalizeAddress } from '../../../validators/address.js';

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
export async function customersCreate(request: FastifyRequest, reply: FastifyReply): Promise<any> {
    const customer: ShopifyCustomer = request.body as any;
    const shopDomain = (request as any).shopDomain || (request.headers['x-shopify-shop-domain'] as string);

    request.log.info(
        { shop: shopDomain, customerId: customer.id, topic: request.headers['x-shopify-topic'] },
        'Processing customers/create webhook'
    );

    // Process customer address profiling asynchronously
    const isActivated = customer.default_address && hasRequiredAddressFields(customer.default_address);
    if (isActivated) {
        queueMicrotask(() => {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            (async () => {
                try {
                    await processCustomerAddress(request, shopDomain, customer);
                } catch (error) {
                    request.log.error(
                        { err: error, shop: shopDomain, customerId: customer.id },
                        'Failed to process address fix workflow for customer'
                    );
                }
            })();
        });
    } else {
        request.log.debug(
            { shop: shopDomain, customerId: customer.id },
            'Skipping customer address profiling - insufficient address data'
        );
    }

    return reply.code(200).send();
}

/**
 * Handle Shopify customers/update webhook
 * Refreshes customer address profile when default address changes
 */
export async function customersUpdate(request: FastifyRequest, reply: FastifyReply): Promise<any> {
    const customer: ShopifyCustomer = request.body as any;
    const shopDomain = (request as any).shopDomain || (request.headers['x-shopify-shop-domain'] as string);

    request.log.info(
        { shop: shopDomain, customerId: customer.id, topic: request.headers['x-shopify-topic'] },
        'Processing customers/update webhook'
    );

    // Process customer address profile refresh asynchronously
    if (customer.default_address && hasRequiredAddressFields(customer.default_address)) {
        queueMicrotask(async () => {
            try {
                await processCustomerAddress(request, shopDomain, customer);
            } catch (error) {
                request.log.error(
                    { err: error, shop: shopDomain, customerId: customer.id },
                    'Failed to refresh customer address profile'
                );
            }
        });
    } else {
        request.log.debug(
            { shop: shopDomain, customerId: customer.id },
            'Skipping customer address refresh - insufficient address data'
        );
    }

    return reply.code(200).send();
}

/**
 * Check if address has required fields for validation
 */
function hasRequiredAddressFields(address: ShopifyCustomer['default_address']): boolean {
    return !!(
        address &&
        address.address1?.trim() &&
        address.city?.trim() &&
        address.zip?.trim() &&
        address.country_code?.trim()
    );
}

/**
 * Process and validate customer default address
 * Normalizes address for logging and future reference
 */
async function processCustomerAddress(
    request: FastifyRequest,
    shopDomain: string,
    customer: ShopifyCustomer
): Promise<void> {
    const address = customer.default_address;
    if (!address) return;

    try {
        // Normalize the customer's default address
        const normalized = await normalizeAddress({
            line1: address.address1 || '',
            line2: address.address2 || undefined,
            city: address.city || '',
            state: address.province || undefined,
            postal_code: address.zip || '',
            country: address.country_code || 'US',
        });

        // Log the normalized address for analytics/debugging
        // This data can be used to pre-validate addresses when orders come in
        request.log.info(
            {
                shop: shopDomain,
                customerId: customer.id,
                customerEmail: customer.email,
                originalAddress: {
                    address1: address.address1,
                    city: address.city,
                    province: address.province,
                    zip: address.zip,
                    country_code: address.country_code,
                },
                normalizedAddress: {
                    line1: normalized.line1,
                    city: normalized.city,
                    state: normalized.state,
                    postal_code: normalized.postal_code,
                    country: normalized.country,
                },
            },
            'Customer address normalized for profiling'
        );

        // Note: For now, we're logging the normalized data for future reference
        // In a future enhancement, this could be stored in a dedicated table
        // to pre-validate orders or suggest corrections proactively
    } catch (error) {
        request.log.warn(
            { err: error, shop: shopDomain, customerId: customer.id },
            'Failed to normalize customer address'
        );
    }
}
