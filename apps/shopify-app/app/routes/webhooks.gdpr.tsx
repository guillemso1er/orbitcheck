import {
    shopifyGdprCustomersDataRequestWebhook,
    shopifyGdprCustomersRedactWebhook,
    shopifyGdprShopRedactWebhook,
} from "@orbitcheck/contracts";
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrbitcheckClient } from "../utils/orbitcheck.server.js";

const orbitcheckClient = getOrbitcheckClient();

/**
 * GDPR compliance webhook handler
 *
 * Handles all three mandatory GDPR compliance topics:
 * - customers/data_request: Request to export customer data
 * - customers/redact: Request to delete/anonymize customer PII
 * - shop/redact: Request to delete all shop data (48 hours after uninstall)
 *
 * See: https://shopify.dev/docs/apps/build/privacy-law-compliance
 */
export const action = async ({ request }: ActionFunctionArgs) => {
    const { shop, topic, payload, apiVersion, webhookId } = await authenticate.webhook(request);

    console.log(`[GDPR] Received ${topic} webhook for ${shop}`, {
        topic,
        shop,
        apiVersion,
        webhookId,
        timestamp: new Date().toISOString(),
    });

    // Build common headers for API calls
    const headers = {
        "Content-Type": "application/json",
        "X-Shopify-Topic": typeof topic === "string" ? topic : String(topic),
        "X-Shopify-Shop-Domain": shop,
        "X-Shopify-Api-Version": apiVersion ?? "",
        "X-Shopify-Webhook-Id": webhookId ?? "",
        // Internal auth header to bypass HMAC verification for app-to-API communication
        "X-Internal-Request": "shopify-app",
    };

    try {
        // Route to appropriate handler based on topic
        switch (topic) {
            case "CUSTOMERS_DATA_REQUEST": {
                // Customer or shop owner requested their data
                const dataRequestPayload = payload as {
                    shop_id?: number;
                    shop_domain?: string;
                    orders_requested?: number[];
                    customer?: { id?: number; email?: string; phone?: string };
                    data_request?: { id?: number };
                };

                console.log(`[GDPR] Processing customers/data_request for ${shop}`, {
                    customerId: dataRequestPayload.customer?.id,
                    dataRequestId: dataRequestPayload.data_request?.id,
                });

                await shopifyGdprCustomersDataRequestWebhook<true>({
                    client: orbitcheckClient,
                    body: {
                        shop_id: dataRequestPayload.shop_id ?? 0,
                        shop_domain: dataRequestPayload.shop_domain ?? shop,
                        orders_requested: dataRequestPayload.orders_requested,
                        customer: dataRequestPayload.customer ?? {},
                        data_request: dataRequestPayload.data_request ?? {},
                    },
                    headers,
                    throwOnError: true,
                });

                console.log(`[GDPR] Successfully forwarded customers/data_request for ${shop}`);
                break;
            }

            case "CUSTOMERS_REDACT": {
                // Request to delete/anonymize customer PII
                const redactPayload = payload as {
                    shop_id?: number;
                    shop_domain?: string;
                    customer?: { id?: number; email?: string; phone?: string };
                    orders_to_redact?: number[];
                };

                console.log(`[GDPR] Processing customers/redact for ${shop}`, {
                    customerId: redactPayload.customer?.id,
                    ordersToRedact: redactPayload.orders_to_redact?.length ?? 0,
                });

                await shopifyGdprCustomersRedactWebhook<true>({
                    client: orbitcheckClient,
                    body: {
                        shop_id: redactPayload.shop_id ?? 0,
                        shop_domain: redactPayload.shop_domain ?? shop,
                        customer: redactPayload.customer ?? {},
                        orders_to_redact: redactPayload.orders_to_redact,
                    },
                    headers,
                    throwOnError: true,
                });

                console.log(`[GDPR] Successfully forwarded customers/redact for ${shop}`);
                break;
            }

            case "SHOP_REDACT": {
                // Request to delete all shop data (sent 48 hours after uninstall)
                const shopRedactPayload = payload as {
                    shop_id?: number;
                    shop_domain?: string;
                };

                console.log(`[GDPR] Processing shop/redact for ${shop}`, {
                    shopId: shopRedactPayload.shop_id,
                });

                await shopifyGdprShopRedactWebhook<true>({
                    client: orbitcheckClient,
                    body: {
                        shop_id: shopRedactPayload.shop_id ?? 0,
                        shop_domain: shopRedactPayload.shop_domain ?? shop,
                    },
                    headers,
                    throwOnError: true,
                });

                console.log(`[GDPR] Successfully forwarded shop/redact for ${shop}`);
                break;
            }

            default:
                console.warn(`[GDPR] Received unexpected GDPR topic: ${topic} for ${shop}`);
        }
    } catch (error) {
        const msg = (error as Error).message;
        if (msg === "fetch failed" || msg.includes("ECONNREFUSED")) {
            console.warn(
                `[GDPR] Failed to forward ${topic} webhook to OrbitCheck API: API appears to be down.`,
                { shop, topic }
            );
        } else {
            console.error(`[GDPR] Failed to forward ${topic} webhook to OrbitCheck API`, {
                shop,
                topic,
                error: msg,
            });
        }
        // Don't throw - return 200 to Shopify to prevent retries that would fail anyway
        // The GDPR event is still recorded by Shopify even if our processing fails
    }

    // Always return 200 OK immediately as per Shopify requirements
    // Processing happens asynchronously in the API
    return new Response();
};
