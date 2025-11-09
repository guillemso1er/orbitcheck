import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import Stripe from 'stripe';
import { MGMT_V1_ROUTES } from "@orbitcheck/contracts";
import type { CreateCheckoutSessionResponses, CreateCustomerPortalSessionResponses } from "../generated/fastify/types.gen.js";
import { STRIPE_API_VERSION, STRIPE_DEFAULT_SECRET_KEY } from "../config.js";
import { HTTP_STATUS } from "../errors.js";
import { generateRequestId, sendError } from "../routes/utils.js";

let stripe: Stripe | null = null;

function getStripe(): Stripe {
    if (!stripe) {
        stripe = new Stripe(process.env.STRIPE_SECRET_KEY || STRIPE_DEFAULT_SECRET_KEY, {
            apiVersion: STRIPE_API_VERSION,
        });
    }
    return stripe;
}

export async function createStripeCheckoutSession(
    request: FastifyRequest,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    const user_id = (request as any).user_id!;
    const request_id = generateRequestId();

    try {
        // Get account information
        const accountResult = await pool.query(
            'SELECT id, stripe_customer_id, plan_tier, included_validations, included_stores FROM accounts WHERE user_id = $1',
            [user_id]
        );

        if (accountResult.rows.length === 0) {
            return await sendError(rep, HTTP_STATUS.BAD_REQUEST, 'NOT_FOUND', 'Account not found', request_id);
        }

        const account = accountResult.rows[0];

        // Get store count for usage-based pricing
        const storesResult = await pool.query(
            'SELECT COUNT(*) as store_count FROM stores WHERE account_id = $1 AND status = $2',
            [account.id, 'active']
        );

        const storeCount = parseInt(storesResult.rows[0].store_count);
        const additionalStores = Math.max(0, storeCount - account.included_stores);

        // Define pricing IDs
        const basePlanPriceId = process.env.STRIPE_BASE_PLAN_PRICE_ID!;
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

        const sessionParams: Stripe.Checkout.SessionCreateParams = {
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'subscription',
            success_url: `${process.env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_URL}/billing/cancelled`,
            client_reference_id: account.id,
            customer_email: account.stripe_customer_id ? undefined : (request.session as any).user_id,
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

        const response: CreateCheckoutSessionResponses[200] = {
            session_url: session.url,
            session_id: session.id,
            request_id
        };
        return rep.send(response);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to create checkout session';
        return sendError(rep, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'SERVER_ERROR', errorMessage, request_id);
    }
}

export async function createStripeCustomerPortalSession(
    request: FastifyRequest,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    const user_id = (request as any).user_id!;
    const request_id = generateRequestId();

    try {
        // Get account and customer info
        const accountResult = await pool.query(
            'SELECT stripe_customer_id FROM accounts WHERE user_id = $1',
            [user_id]
        );

        if (accountResult.rows.length === 0 || !accountResult.rows[0].stripe_customer_id) {
            return await sendError(rep, HTTP_STATUS.BAD_REQUEST, 'NOT_FOUND', 'No billing account found', request_id);
        }

        const customerId = accountResult.rows[0].stripe_customer_id;

        const session = await getStripe().billingPortal.sessions.create({
            customer: customerId,
            return_url: `${process.env.FRONTEND_URL}/billing`,
        });

        const response: CreateCustomerPortalSessionResponses[200] = {
            portal_url: session.url,
            request_id
        };
        return rep.send(response);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to create portal session';
        return sendError(rep, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'SERVER_ERROR', errorMessage, request_id);
    }
}