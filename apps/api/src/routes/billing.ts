import { MGMT_V1_ROUTES } from "@orbicheck/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import Stripe from 'stripe';

import { ERROR_CODES, HTTP_STATUS, STRIPE_API_VERSION, STRIPE_DEFAULT_SECRET_KEY } from "../constants.js";
import { environment } from "../environment.js";
import { generateRequestId, rateLimitResponse, sendError, unauthorizedResponse } from "./utils.js";

// Stripe configuration - lazy initialization
let stripe: Stripe | null = null;

function getStripe(): Stripe {
    if (!stripe) {
        console.log('Initializing Stripe with key:', process.env.STRIPE_SECRET_KEY);
        stripe = new Stripe(process.env.STRIPE_SECRET_KEY || STRIPE_DEFAULT_SECRET_KEY, {
            apiVersion: STRIPE_API_VERSION,
        });
    }
    return stripe;
}

export function registerBillingRoutes(app: FastifyInstance, pool: Pool): void {
    app.post(MGMT_V1_ROUTES.BILLING.CREATE_STRIPE_CHECKOUT_SESSION, {
        schema: {
            summary: 'Create Stripe Checkout session',
            description: 'Creates a Stripe Checkout session with base plan and usage-based line items',
            tags: ['Billing'],
            security: [{ BearerAuth: [] }],
            response: {
                200: {
                    description: 'Checkout session created',
                    type: 'object',
                    properties: {
                        session_url: { type: 'string', format: 'uri' },
                        session_id: { type: 'string' },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse
            }
        }
    }, async (request, rep) => {
        const user_id = request.user_id!;
        const request_id = generateRequestId();

        try {
            // Get account information
            const accountResult = await pool.query(
                'SELECT id, stripe_customer_id, plan_tier, included_validations, included_stores FROM accounts WHERE user_id = $1',
                [user_id]
            );

            if (accountResult.rows.length === 0) {
                return await sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.NOT_FOUND, 'Account not found', request_id);
            }

            const account = accountResult.rows[0];

            // Get store count for usage-based pricing
            const storesResult = await pool.query(
                'SELECT COUNT(*) as store_count FROM stores WHERE account_id = $1 AND status = $2',
                [account.id, 'active']
            );

            const storeCount = parseInt(storesResult.rows[0].store_count);
            const additionalStores = Math.max(0, storeCount - account.included_stores);

            // Define pricing IDs (these would be configured in environment)
            const basePlanPriceId = process.env.STRIPE_BASE_PLAN_PRICE_ID!;
            const usagePriceId = process.env.STRIPE_USAGE_PRICE_ID!;
            const storeAddonPriceId = process.env.STRIPE_STORE_ADDON_PRICE_ID!;

            const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

            // Base plan
            lineItems.push({
                price: basePlanPriceId,
                quantity: 1,
            });

            // Additional store addons
            if (additionalStores > 0) {
                lineItems.push({
                    price: storeAddonPriceId,
                    quantity: additionalStores,
                });
            }

            // Usage-based validations (if applicable)
            // This could be calculated based on current usage vs included
            // For now, we'll keep it simple

            const sessionParams: Stripe.Checkout.SessionCreateParams = {
                payment_method_types: ['card'],
                line_items: lineItems,
                mode: 'subscription',
                success_url: `${process.env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.FRONTEND_URL}/billing/cancelled`,
                client_reference_id: account.id,
                customer_email: account.stripe_customer_id ? undefined : request.session.user_id, // Add email if no customer yet
                allow_promotion_codes: true,
                metadata: {
                    account_id: account.id,
                    user_id,
                },
            };

            // If customer exists, attach to session
            if (account.stripe_customer_id) {
                sessionParams.customer = account.stripe_customer_id;
            }

            const session = await getStripe().checkout.sessions.create(sessionParams);

            return rep.send({
                session_url: session.url,
                session_id: session.id,
                request_id
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to create checkout session';
            return sendError(rep, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.SERVER_ERROR, errorMessage, request_id);
        }
    });

    app.post(MGMT_V1_ROUTES.BILLING.CREATE_STRIPE_CUSTOMER_PORTAL_SESSION, {
        schema: {
            summary: 'Create Stripe Customer Portal session',
            description: 'Creates a Stripe Customer Portal session for managing billing',
            tags: ['Billing'],
            security: [{ BearerAuth: [] }],
            response: {
                200: {
                    description: 'Portal session created',
                    type: 'object',
                    properties: {
                        portal_url: { type: 'string', format: 'uri' },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse
            }
        }
    }, async (request, rep) => {
        const user_id = request.user_id!;
        const request_id = generateRequestId();

        try {
            // Get account and customer info
            const accountResult = await pool.query(
                'SELECT stripe_customer_id FROM accounts WHERE user_id = $1',
                [user_id]
            );

            if (accountResult.rows.length === 0 || !accountResult.rows[0].stripe_customer_id) {
                return await sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.NOT_FOUND, 'No billing account found', request_id);
            }

            const customerId = accountResult.rows[0].stripe_customer_id;

            const session = await getStripe().billingPortal.sessions.create({
                customer: customerId,
                return_url: `${process.env.FRONTEND_URL}/billing`,
            });

            return rep.send({
                portal_url: session.url,
                request_id
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to create portal session';
            return sendError(rep, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.SERVER_ERROR, errorMessage, request_id);
        }
    });
}