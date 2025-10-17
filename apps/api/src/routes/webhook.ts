import crypto from "node:crypto";

import { MGMT_V1_ROUTES } from "@orbicheck/contracts";
import type { FastifyInstance } from "fastify";
import fetch from "node-fetch";
import type { Pool } from "pg";
import Stripe from 'stripe';

import { CONTENT_TYPES, CRYPTO_KEY_BYTES, ERROR_CODES, ERROR_MESSAGES, EVENT_TYPES, HTTP_STATUS, MESSAGES, ORDER_ACTIONS, PAYLOAD_TYPES, REASON_CODES, STRIPE_API_VERSION, STRIPE_DEFAULT_SECRET_KEY, URL_PATTERNS, USER_AGENT_WEBHOOK_TESTER, WEBHOOK_TEST_LOW_RISK_TAG, WEBHOOK_TEST_ORDER_ID, WEBHOOK_TEST_RISK_SCORE } from "../constants.js";
import { logEvent } from "../hooks.js";
import { generateRequestId, rateLimitResponse, securityHeader, sendError, unauthorizedResponse } from "./utils.js";
// Import route constants from contracts package
const ROUTES = MGMT_V1_ROUTES.WEBHOOKS;

// Stripe configuration for webhook verification - lazy initialization
let stripe: Stripe | null = null;

function getStripe(): Stripe {
    if (!stripe) {
        stripe = new Stripe(process.env.STRIPE_SECRET_KEY || STRIPE_DEFAULT_SECRET_KEY, {
            apiVersion: STRIPE_API_VERSION,
        });
    }
    return stripe;
}


export function registerWebhookRoutes(app: FastifyInstance, pool: Pool): void {
    app.get(ROUTES.LIST_WEBHOOKS, {
        schema: {
            summary: 'List webhooks',
            description: 'Retrieves all webhooks for the authenticated project',
            tags: ['Webhooks'],
            security: [{ BearerAuth: [] }],
            response: {
                200: {
                    description: 'List of webhooks',
                    type: 'object',
                    properties: {
                        data: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    url: { type: 'string', format: 'uri' },
                                    events: { type: 'array', items: { type: 'string' } },
                                    status: { type: 'string', enum: ['active', 'inactive', 'deleted'] },
                                    created_at: { type: 'string', format: 'date-time' },
                                    last_fired_at: { type: 'string', format: 'date-time', nullable: true }
                                }
                            }
                        },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse
            }
        }
    }, async (request, rep) => {
        const project_id = request.project_id!;
        const request_id = generateRequestId();

        try {
            const result = await pool.query(
                'SELECT id, url, events, status, created_at, last_fired_at FROM webhooks WHERE project_id = $1 AND status != $2 ORDER BY created_at DESC',
                [project_id, 'deleted']
            );

            await logEvent(project_id, 'webhook_list', ROUTES.LIST_WEBHOOKS, [], HTTP_STATUS.OK, {}, pool);

            return rep.send({
                data: result.rows,
                request_id
            });
        } catch (error) {
            const errorMessage = error instanceof globalThis.Error ? error.message : MESSAGES.DATABASE_ERROR;
            await logEvent(project_id, 'webhook_list', ROUTES.LIST_WEBHOOKS, [REASON_CODES.WEBHOOK_SEND_FAILED], HTTP_STATUS.INTERNAL_SERVER_ERROR, { error: errorMessage }, pool);
            return sendError(rep, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.SERVER_ERROR, errorMessage, request_id);
        }
    });

    app.post(ROUTES.CREATE_WEBHOOK, {
        schema: {
            summary: 'Create webhook',
            description: 'Creates a new webhook subscription for the authenticated project',
            tags: ['Webhooks'],
            security: [{ BearerAuth: [] }],
            body: {
                type: 'object',
                required: ['url', 'events'],
                properties: {
                    url: {
                        type: 'string',
                        format: 'uri',
                        description: 'The webhook URL to send events to'
                    },
                    events: {
                        type: 'array',
                        items: {
                            type: 'string'
                        },
                        description: 'Events to subscribe to'
                    }
                }
            },
            response: {
                201: {
                    description: 'Webhook created successfully',
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        url: { type: 'string', format: 'uri' },
                        events: { type: 'array', items: { type: 'string' } },
                        secret: { type: 'string' },
                        status: { type: 'string' },
                        created_at: { type: 'string', format: 'date-time' },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse
            }
        }
    }, async (request, rep) => {
        const project_id = request.project_id!;
        const body = request.body as any;
        const { url, events } = body;
        const request_id = generateRequestId();

        try {
            // Validate URL
            if (!url || !URL_PATTERNS.HTTPS_OPTIONAL.test(url)) {
                return await sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_URL, ERROR_MESSAGES[ERROR_CODES.INVALID_URL], request_id);
            }

            // Validate events
            const validEvents = Object.values(EVENT_TYPES);
            const invalidEvents = events.filter((event: string) => !validEvents.includes(event as any));
            if (invalidEvents.length > 0) {
                return await sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_TYPE, MESSAGES.INVALID_EVENTS + invalidEvents.join(', '), request_id);
            }

            const secret = await new Promise<string>((resolve, reject) => {
                crypto.randomBytes(CRYPTO_KEY_BYTES, (error, buf) => {
                    if (error) reject(error);
                    else resolve(buf.toString('hex'));
                });
            });

            const result = await pool.query(
                'INSERT INTO webhooks (project_id, url, events, secret, status) VALUES ($1, $2, $3, $4, $5) RETURNING id, url, events, secret, status, created_at',
                [project_id, url, events, secret, 'active']
            );

            const webhook = result.rows[0];

            await logEvent(project_id, 'webhook_create', ROUTES.CREATE_WEBHOOK, [], HTTP_STATUS.CREATED, { webhook_id: webhook.id }, pool);

            return rep.status(HTTP_STATUS.CREATED).send({
                ...webhook,
                request_id
            });
        } catch (error) {
            const errorMessage = error instanceof globalThis.Error ? error.message : MESSAGES.DATABASE_ERROR;
            await logEvent(project_id, 'webhook_create', ROUTES.CREATE_WEBHOOK, [REASON_CODES.WEBHOOK_SEND_FAILED], HTTP_STATUS.INTERNAL_SERVER_ERROR, { error: errorMessage }, pool);
            return sendError(rep, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.SERVER_ERROR, errorMessage, request_id);
        }
    });

    app.delete(ROUTES.DELETE_WEBHOOK, {
        schema: {
            summary: 'Delete webhook',
            description: 'Deletes a webhook subscription',
            tags: ['Webhooks'],
            security: [{ BearerAuth: [] }],
            parameters: [
                {
                    name: 'id',
                    in: 'path',
                    required: true,
                    description: 'ID of the webhook to delete',
                    schema: { type: 'string' }
                }
            ],
            response: {
                200: {
                    description: 'Webhook deleted successfully',
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        status: { type: 'string' },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                404: { description: 'Webhook not found' }
            }
        }
    }, async (request, rep) => {
        const project_id = request.project_id!;
        const { id } = request.params as any;
        const request_id = generateRequestId();

        try {
            const result = await pool.query(
                'UPDATE webhooks SET status = $1 WHERE id = $2 AND project_id = $3 AND status != $1 RETURNING id, status',
                ['deleted', id, project_id]
            );

            if (result.rowCount === 0) {
                return await sendError(rep, HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, MESSAGES.WEBHOOK_NOT_FOUND, request_id);
            }

            const webhook = result.rows[0];

            await logEvent(project_id, 'webhook_delete', ROUTES.DELETE_WEBHOOK, [], HTTP_STATUS.OK, { webhook_id: webhook.id }, pool);

            return rep.send({
                ...webhook,
                request_id
            });
        } catch (error) {
            const errorMessage = error instanceof globalThis.Error ? error.message : MESSAGES.DATABASE_ERROR;
            await logEvent(project_id, 'webhook_delete', ROUTES.DELETE_WEBHOOK, [REASON_CODES.WEBHOOK_SEND_FAILED], HTTP_STATUS.INTERNAL_SERVER_ERROR, { error: errorMessage }, pool);
            return sendError(rep, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.SERVER_ERROR, errorMessage, request_id);
        }
    });

    app.post(ROUTES.TEST_WEBHOOK, {
        schema: {
            summary: 'Test Webhook',
            description: 'Sends a sample payload to the provided webhook URL and returns the response. Useful for testing webhook configurations.',
            tags: ['Webhooks'],
            headers: securityHeader,
            body: {
                type: 'object',
                required: ['url', 'payload_type'],
                properties: {
                    url: {
                        type: 'string',
                        description: 'The webhook URL to send the payload to',
                        format: 'uri'
                    },
                    payload_type: {
                        type: 'string',
                        enum: ['validation', 'order', 'custom'],
                        description: 'Type of sample payload to send',
                        default: 'validation'
                    },
                    custom_payload: {
                        type: 'object',
                        description: 'Custom payload if payload_type is "custom"',
                        additionalProperties: true
                    }
                }
            },
            response: {
                200: {
                    description: 'Webhook test result',
                    type: 'object',
                    properties: {
                        sent_to: { type: 'string' },
                        payload: {
                            type: 'object',
                            additionalProperties: true
                        },
                        response: {
                            type: 'object',
                            properties: {
                                status: { type: 'integer' },
                                status_text: { type: 'string' },
                                headers: { type: 'object' },
                                body: { type: 'string' }
                            }
                        },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                400: { description: 'Invalid URL or payload' },
                500: { description: 'Failed to send request' }
            }
        }
    }, async (request, rep) => {
        const project_id = request.project_id!;
        const body = request.body as any;
        const { url, payload_type = PAYLOAD_TYPES.VALIDATION, custom_payload } = body;
        try {
            const request_id = generateRequestId();

            if (!url || !URL_PATTERNS.HTTPS_OPTIONAL.test(url)) {
                return await sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_URL, ERROR_MESSAGES[ERROR_CODES.INVALID_URL], request_id);
            }

            let payload: Record<string, unknown>;
            const timestamp = new Date().toISOString();
            const common = {
                project_id,
                timestamp,
                request_id
            };

            switch (payload_type) {
                case PAYLOAD_TYPES.VALIDATION: {
                    payload = {
                        ...common,
                        event: EVENT_TYPES.VALIDATION_RESULT,
                        type: 'email',
                        result: {
                            valid: true,
                            normalized: 'user@example.com',
                            reason_codes: [], // Use actual reason code if needed
                            meta: { domain: 'example.com' }
                        }
                    };
                    break;
                }
                case PAYLOAD_TYPES.ORDER: {
                    payload = {
                        ...common,
                        event: EVENT_TYPES.ORDER_EVALUATED,
                        order_id: WEBHOOK_TEST_ORDER_ID,
                        risk_score: WEBHOOK_TEST_RISK_SCORE,
                        action: ORDER_ACTIONS.APPROVE,
                        reason_codes: [], // Use actual reason code if needed
                        tags: [WEBHOOK_TEST_LOW_RISK_TAG]
                    };
                    break;
                }
                case PAYLOAD_TYPES.CUSTOM: {
                    if (!custom_payload) {
                        return await sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.MISSING_PAYLOAD, ERROR_MESSAGES[ERROR_CODES.MISSING_PAYLOAD], request_id);
                    }
                    payload = { ...common, ...custom_payload };
                    break;
                }
                default: {
                    return await sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_TYPE, ERROR_MESSAGES[ERROR_CODES.INVALID_TYPE], request_id);
                }
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': CONTENT_TYPES.APPLICATION_JSON,
                    'User-Agent': USER_AGENT_WEBHOOK_TESTER
                },
                body: JSON.stringify(payload)
            });

            const responseBody = await response.text();
            const responseHeaders: Record<string, string> = {};
            for (const [key, value] of response.headers.entries()) {
                responseHeaders[key] = value;
            }

            const result: any = {
                sent_to: url,
                payload,
                response: {
                    status: response.status,
                    status_text: response.statusText,
                    headers: responseHeaders,
                    body: responseBody
                },
                request_id
            };

            await logEvent(project_id, 'webhook_test', MGMT_V1_ROUTES.WEBHOOKS.TEST_WEBHOOK, [], HTTP_STATUS.OK, {
                url,
                payload_type,
                response_status: response.status
            }, pool);

            return rep.send(result);
        } catch (error) {
            const request_id = generateRequestId();
            const errorMessage = error instanceof globalThis.Error ? (error).message : MESSAGES.UNKNOWN_ERROR;
            await logEvent(project_id, 'webhook_test', MGMT_V1_ROUTES.WEBHOOKS.TEST_WEBHOOK, [REASON_CODES.WEBHOOK_SEND_FAILED], HTTP_STATUS.INTERNAL_SERVER_ERROR, {
                url,
                payload_type,
                error: errorMessage
            }, pool);

            return sendError(rep, HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.WEBHOOK_SEND_FAILED, errorMessage, request_id);
        }
    });

    // Stripe webhook endpoint for billing events
    app.post('/api/stripe/webhook', {
        schema: {
            summary: 'Stripe webhook endpoint',
            description: 'Handles Stripe webhook events for billing',
            tags: ['Billing'],
            response: {
                200: {
                    description: 'Webhook processed successfully'
                },
                400: { description: 'Invalid webhook signature or payload' }
            }
        }
    }, async (request, rep) => {
        const sig = request.headers['stripe-signature'] as string;
        const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!endpointSecret) {
            request.log.error('Stripe webhook secret not configured');
            return rep.status(HTTP_STATUS.BAD_REQUEST).send({ error: 'Webhook secret not configured' });
        }

        let event: Stripe.Event;

        try {
            event = getStripe().webhooks.constructEvent(request.body as string | Buffer, sig, endpointSecret);
        } catch (err) {
            request.log.error({ err }, 'Webhook signature verification failed');
            return rep.status(HTTP_STATUS.BAD_REQUEST).send({ error: 'Webhook signature verification failed' });
        }

        try {
            switch (event.type) {
                case 'checkout.session.completed': {
                    const session = event.data.object as Stripe.Checkout.Session;
                    const accountId = session.client_reference_id;

                    if (!accountId) {
                        request.log.warn('No client_reference_id in checkout session');
                        break;
                    }

                    // Store subscription and item IDs
                    if (session.subscription && session.subscription instanceof Object) {
                        const subscriptionId = (session.subscription as any).id;
                        const itemIds = session.line_items?.data.map(item => item.price?.id).filter(Boolean) || [];

                        await pool.query(
                            'UPDATE accounts SET stripe_subscription_id = $1, stripe_item_ids = $2, billing_status = $3 WHERE id = $4',
                            [subscriptionId, JSON.stringify(itemIds), 'active', accountId]
                        );

                        request.log.info({ accountId, subscriptionId, itemIds }, 'Subscription created');
                    }

                    // Create customer if not exists
                    if (session.customer) {
                        await pool.query(
                            'UPDATE accounts SET stripe_customer_id = $1 WHERE id = $2 AND stripe_customer_id IS NULL',
                            [session.customer, accountId]
                        );
                    }
                    break;
                }

                case 'invoice.payment_succeeded': {
                    const invoice = event.data.object as Stripe.Invoice;
                    const subscriptionId = (invoice as any).subscription;
                    if (subscriptionId && typeof subscriptionId === 'string') {
                        // Update billing status to active on successful payment
                        await pool.query(
                            'UPDATE accounts SET billing_status = $1 WHERE stripe_subscription_id = $2',
                            ['active', subscriptionId]
                        );
                    }
                    break;
                }

                case 'invoice.payment_failed': {
                    const invoice = event.data.object as Stripe.Invoice;
                    const subscriptionId = (invoice as any).subscription;
                    if (subscriptionId && typeof subscriptionId === 'string') {
                        // Update billing status to past_due on failed payment
                        await pool.query(
                            'UPDATE accounts SET billing_status = $1 WHERE stripe_subscription_id = $2',
                            ['past_due', subscriptionId]
                        );
                    }
                    break;
                }

                case 'customer.subscription.updated': {
                    const subscription = event.data.object as Stripe.Subscription;
                    const accountResult = await pool.query(
                        'SELECT id FROM accounts WHERE stripe_subscription_id = $1',
                        [subscription.id]
                    );

                    if (accountResult.rows.length > 0) {
                        const account = accountResult.rows[0];

                        // Update plan and included quantities
                        const itemIds = subscription.items.data.map(item => item.price.id);
                        let includedValidations = 0;
                        let includedStores = 0;

                        // Parse plan details from subscription items (this would need to match your pricing structure)
                        for (const item of subscription.items.data) {
                            // This is a simplified example - you'd need to map price IDs to plan features
                            if (item.price.id.includes('plan')) {
                                includedValidations = item.quantity || 0;
                            } else if (item.price.id.includes('store')) {
                                includedStores = item.quantity || 0;
                            }
                        }

                        await pool.query(
                            'UPDATE accounts SET stripe_item_ids = $1, included_validations = $2, included_stores = $3 WHERE id = $4',
                            [JSON.stringify(itemIds), includedValidations, includedStores, account.id]
                        );

                        request.log.info({ accountId: account.id, itemIds, includedValidations, includedStores }, 'Subscription updated');
                    }
                    break;
                }

                case 'customer.subscription.deleted': {
                    // Restrict production access when subscription is cancelled
                    await pool.query(
                        'UPDATE accounts SET billing_status = $1 WHERE stripe_subscription_id = $2',
                        ['cancelled', event.data.object.id]
                    );
                    break;
                }

                default:
                    request.log.info({ eventType: event.type }, 'Unhandled Stripe event');
            }

            return rep.status(HTTP_STATUS.OK).send({ received: true });
        } catch (error) {
            request.log.error({ err: error, eventType: event.type }, 'Error processing Stripe webhook');
            return rep.status(HTTP_STATUS.BAD_REQUEST).send({ error: 'Webhook processing failed' });
        }
    });
}