import { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis as IORedisType } from 'ioredis';
import { createShopifyService } from '../../../services/shopify.js';
import { captureShopifyEvent } from '../lib/telemetry.js';

// Helper function to extract customer ID from webhook payload
function extractCustomerId(payload: Record<string, unknown>): string | null {
    // Shopify sends customer_id in different formats depending on the webhook
    return payload.customer_id as string ||
        payload.id as string ||
        (payload.customer as Record<string, unknown>)?.id as string ||
        null;
}

/**
 * Redacts customer-specific data from logs table
 * Removes PII while preserving audit trail for compliance
 */
async function redactCustomerLogsFromDatabase(
    shop: string,
    customerId: string | null,
    shopifyService: any
): Promise<void> {
    const client = await shopifyService.pool.connect();
    try {
        await client.query('BEGIN');

        // Update logs to redact PII while preserving audit trail
        // This targets logs that might contain customer email, phone, address, or other PII
        await client.query(`
            UPDATE logs
            SET
                meta = meta - 'email' - 'phone' - 'address' - 'name' - 'tax_id',
                meta = meta || jsonb_build_object(
                    'redacted_at', now(),
                    'redacted_customer_id', $1,
                    'original_meta_size', jsonb_object_length(meta)
                )
            WHERE
                meta ?| array['email', 'phone', 'address', 'name', 'tax_id']
                AND meta->>'customer_id' = $1
                AND created_at >= now() - INTERVAL '90 days'  -- GDPR compliance: only recent data
        `, [customerId || 'unknown']);

        // Also update shopify_gdpr_events to mark redaction
        await client.query(`
            UPDATE shopify_gdpr_events
            SET
                payload = payload || jsonb_build_object(
                    'redacted_at', now(),
                    'redacted_customer_id', $1
                )
            WHERE
                topic IN ('customers/data_request', 'customers/redact')
                AND payload->>'customer_id' = $1
        `, [customerId || 'unknown']);

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Failed to redact customer logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
        client.release();
    }
}

/**
 * Redacts customer PII from validation records
 * Removes sensitive data while preserving validation results for analytics
 */
async function redactCustomerValidationData(
    shop: string,
    customerId: string | null,
    shopifyService: any
): Promise<void> {
    const client = await shopifyService.pool.connect();
    try {
        await client.query('BEGIN');

        // Note: In this Shopify integration, validation data is primarily stored in:
        // 1. shopify_gdpr_events (already handled in redactCustomerLogsFromDatabase)
        // 2. Any order logs that might reference the customer
        // 3. Any webhook payloads containing customer data

        // Update order-related logs if they exist and contain customer PII
        await client.query(`
            UPDATE logs
            SET
                meta = meta - 'customer' - 'billing_address' - 'shipping_address',
                meta = meta || jsonb_build_object(
                    'customer_data_redacted', true,
                    'redacted_at', now()
                )
            WHERE
                type = 'order'
                AND (
                    meta ? 'customer' OR
                    meta ? 'billing_address' OR
                    meta ? 'shipping_address'
                )
                AND meta->'customer'->>'id' = $1
        `, [customerId || 'unknown']);

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Failed to redact customer validation data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
        client.release();
    }
}

/**
 * Clears cached data related to this customer from Redis
 * Removes validation results, rate limiting counters, and other cached customer data
 */
async function clearCustomerCacheData(
    shop: string,
    customerId: string | null,
    redis: IORedisType
): Promise<void> {
    try {
        // Create patterns for customer-related cache keys
        const customerPatterns = [
            `*${customerId}*`,
            `*customer:${customerId}*`,
            `*shop:${shop}*customer*`,
            `*${shop}*${customerId}*`
        ];

        // For each pattern, find and delete matching keys
        for (const pattern of customerPatterns) {
            const keys = await redis.keys(pattern);
            if (keys.length > 0) {
                await redis.del(...keys);
            }
        }

        // Also clear any rate limiting or idempotency keys that might contain customer data
        const rateLimitPatterns = [
            `rate:*:${shop}*`,
            `idem:*:${shop}*`
        ];

        for (const pattern of rateLimitPatterns) {
            const keys = await redis.keys(pattern);
            if (keys.length > 0) {
                await redis.del(...keys);
            }
        }

    } catch (error) {
        throw new Error(`Failed to clear customer cache data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function customersDataRequest(_request: FastifyRequest, reply: FastifyReply) {
    const shop = (_request.headers['x-shopify-shop-domain'] as string) || ((_request as any).shopDomain as string);
    const payload = _request.body as Record<string, unknown>;
    const customerId = extractCustomerId(payload);

    if (!shop) {
        _request.log.warn('Missing shop header for customers/data_request webhook');
        return reply.code(400).send('Missing shop');
    }

    _request.log.info({
        shop,
        customerId,
        requestType: 'data_request'
    }, 'Processing Shopify customers/data_request webhook');

    const shopifyService = createShopifyService((_request as any).server.pg.pool);

    try {
        await shopifyService.recordGdprEvent(shop, 'customers/data_request', payload);
        captureShopifyEvent(shop, 'gdpr_customers_data_request', { customerId });

        // Retrieve customer data from database
        _request.log.info({
            shop,
            customerId
        }, 'Starting customer data retrieval for GDPR request');

        const customerData = await shopifyService.getCustomerData(shop, customerId || 'unknown');

        if (!customerData) {
            _request.log.warn({
                shop,
                customerId,
                event: 'customers/data_request'
            }, 'No customer data found for GDPR request');
        } else {
            _request.log.info({
                shop,
                customerId,
                data_keys: Object.keys(customerData),
                gdpr_events_count: Array.isArray(customerData.gdpr_events) ? customerData.gdpr_events.length : 0
            }, 'Customer data retrieved for GDPR request');

            // Send data back to Shopify asynchronously to avoid webhook timeout
            setImmediate(async () => {
                try {
                    _request.log.info({
                        shop,
                        customerId
                    }, 'Sending customer data to Shopify via GraphQL');

                    const success = await shopifyService.sendCustomerDataToShopify(shop, customerId || 'unknown', customerData);

                    if (success) {
                        _request.log.info({
                            shop,
                            customerId
                        }, 'Successfully sent customer data to Shopify');

                        // Record successful data delivery
                        await shopifyService.recordGdprEvent(shop, 'customers/data_request_sent', {
                            customer_id: customerId,
                            data_sent: true,
                            sent_at: new Date().toISOString(),
                            data_summary: {
                                shop_data: !!customerData.shop,
                                settings_data: !!customerData.settings,
                                gdpr_events_count: Array.isArray(customerData.gdpr_events) ? customerData.gdpr_events.length : 0
                            }
                        });
                    } else {
                        _request.log.error({
                            shop,
                            customerId
                        }, 'Failed to send customer data to Shopify');

                        // Record failed data delivery
                        await shopifyService.recordGdprEvent(shop, 'customers/data_request_failed', {
                            customer_id: customerId,
                            data_sent: false,
                            error: 'Failed to send data to Shopify',
                            failed_at: new Date().toISOString()
                        });
                    }
                } catch (dataError) {
                    _request.log.error({
                        shop,
                        customerId,
                        error: dataError instanceof Error ? dataError.message : 'Unknown error'
                    }, 'Error while sending customer data to Shopify');

                    // Record failed data delivery with error details
                    await shopifyService.recordGdprEvent(shop, 'customers/data_request_error', {
                        customer_id: customerId,
                        data_sent: false,
                        error: dataError instanceof Error ? dataError.message : 'Unknown error',
                        error_at: new Date().toISOString()
                    });
                }
            });
        }

        _request.log.info({
            shop,
            customerId,
            event: 'customers/data_request'
        }, 'Processed GDPR data request webhook');

        return reply.code(200).send();
    } catch (error) {
        _request.log.error({
            shop,
            customerId,
            error: error instanceof Error ? error.message : 'Unknown error'
        }, 'Failed to process customers/data_request webhook');
        return reply.code(500).send('Internal server error');
    }
}

export async function customersRedact(_request: FastifyRequest, reply: FastifyReply) {
    const shop = (_request.headers['x-shopify-shop-domain'] as string) || ((_request as any).shopDomain as string);
    const payload = _request.body as Record<string, unknown>;
    const customerId = extractCustomerId(payload);

    if (!shop) {
        _request.log.warn('Missing shop header for customers/redact webhook');
        return reply.code(400).send('Missing shop');
    }

    _request.log.info({
        shop,
        customerId,
        requestType: 'redact'
    }, 'Processing Shopify customers/redact webhook');

    const shopifyService = createShopifyService((_request as any).server.pg.pool);

    try {
        await shopifyService.recordGdprEvent(shop, 'customers/redact', payload);
        captureShopifyEvent(shop, 'gdpr_customers_redact', { customerId });

        // Delete all PII related to this specific customer
        _request.log.info({
            shop,
            customerId
        }, 'Starting customer data redaction for GDPR request');

        // Perform data redaction asynchronously to avoid webhook timeout
        setImmediate(async () => {
            try {
                _request.log.info({
                    shop,
                    customerId
                }, 'Redacting customer data from database');

                // Record the redaction request for audit purposes
                await shopifyService.recordGdprEvent(shop, 'customers/redact_started', {
                    customer_id: customerId,
                    redaction_started_at: new Date().toISOString(),
                    payload: payload
                });

                // Start data redaction process
                try {
                    // 1. Delete or anonymize customer-specific data from logs
                    await redactCustomerLogsFromDatabase(shop, customerId, shopifyService);

                    // 2. Remove any PII from validation records
                    await redactCustomerValidationData(shop, customerId, shopifyService);

                    // 3. Clear any cached data related to this customer
                    await clearCustomerCacheData(shop, customerId, (_request as any).server.redis);

                    _request.log.info({
                        shop,
                        customerId,
                        step: 'redaction_completed'
                    }, 'Customer data redaction completed successfully');

                } catch (redactionError) {
                    _request.log.error({
                        shop,
                        customerId,
                        error: redactionError instanceof Error ? redactionError.message : 'Unknown error',
                        step: 'redaction_failed'
                    }, 'Error during customer data redaction');

                    // Record failed redaction with error details
                    await shopifyService.recordGdprEvent(shop, 'customers/redact_error', {
                        customer_id: customerId,
                        error: redactionError instanceof Error ? redactionError.message : 'Unknown error',
                        error_at: new Date().toISOString()
                    });

                    throw redactionError;
                }

                _request.log.info({
                    shop,
                    customerId
                }, 'Customer data redaction completed');

                // Record successful redaction
                await shopifyService.recordGdprEvent(shop, 'customers/redact_completed', {
                    customer_id: customerId,
                    redaction_completed_at: new Date().toISOString()
                });

            } catch (redactionError) {
                _request.log.error({
                    shop,
                    customerId,
                    error: redactionError instanceof Error ? redactionError.message : 'Unknown error'
                }, 'Error during customer data redaction');

                // Record failed redaction
                await shopifyService.recordGdprEvent(shop, 'customers/redact_failed', {
                    customer_id: customerId,
                    error: redactionError instanceof Error ? redactionError.message : 'Unknown error',
                    failed_at: new Date().toISOString()
                });
            }
        });

        _request.log.info({
            shop,
            customerId,
            event: 'customers/redact'
        }, 'Recorded GDPR customer redaction event');

        return reply.code(200).send();
    } catch (error) {
        _request.log.error({
            shop,
            customerId,
            error: error instanceof Error ? error.message : 'Unknown error'
        }, 'Failed to process customers/redact webhook');
        return reply.code(500).send('Internal server error');
    }
}

export async function shopRedact(request: FastifyRequest, reply: FastifyReply) {
    const shop = request.headers['x-shopify-shop-domain'] as string;
    const payload = request.body as Record<string, unknown>;

    if (!shop) {
        request.log.warn('Missing shop header for shop/redact webhook');
        return reply.code(400).send('Missing shop');
    }


    request.log.info({
        shop,
        requestType: 'shop_redact'
    }, 'Processing Shopify shop/redact webhook');

    const shopifyService = createShopifyService((request as any).server.pg.pool);

    try {
        await shopifyService.recordGdprEvent(shop, 'shop/redact', payload);
        captureShopifyEvent(shop, 'gdpr_shop_redact');

        request.log.info({ shop }, 'Acknowledged Shopify shop/redact webhook');

        // Perform data deletion asynchronously to avoid webhook timeout
        setImmediate(async () => {
            try {
                request.log.info({ shop }, 'Starting shop data purge due to shop/redact');
                await shopifyService.deleteShopData(shop);
                request.log.info({ shop }, 'Completed shop data purge');
            } catch (deletionError) {
                request.log.error({
                    shop,
                    error: deletionError instanceof Error ? deletionError.message : 'Unknown error'
                }, 'Failed to purge shop data after shop/redact webhook');
            }
        });

        return reply.code(200).send();
    } catch (error) {
        request.log.error({
            shop,
            error: error instanceof Error ? error.message : 'Unknown error'
        }, 'Failed to process shop/redact webhook');
        return reply.code(500).send('Internal server error');
    }
}