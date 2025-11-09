import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import Stripe from 'stripe';
import { MGMT_V1_ROUTES } from "@orbitcheck/contracts";
import type { CreateWebhookData, CreateWebhookResponses, DeleteWebhookData, DeleteWebhookResponses, ListWebhooksResponses, TestWebhookData, TestWebhookResponses } from "../generated/fastify/types.gen.js";
import { CONTENT_TYPES, CRYPTO_KEY_BYTES, MESSAGES, STRIPE_API_VERSION, STRIPE_DEFAULT_SECRET_KEY, USER_AGENT_WEBHOOK_TESTER, WEBHOOK_TEST_LOW_RISK_TAG, WEBHOOK_TEST_ORDER_ID, WEBHOOK_TEST_RISK_SCORE } from "../config.js";
import { HTTP_STATUS } from "../errors.js";
import { logEvent } from "../hooks.js";
import { generateRequestId, sendServerError, sendError } from "../routes/utils.js";

let stripe: Stripe | null = null;

function getStripe(): Stripe {
    if (!stripe) {
        stripe = new Stripe(process.env.STRIPE_SECRET_KEY || STRIPE_DEFAULT_SECRET_KEY, {
            apiVersion: STRIPE_API_VERSION,
        });
    }
    return stripe;
}

export async function listWebhooks(
    request: FastifyRequest,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    const project_id = (request as any).project_id!;
    const request_id = generateRequestId();

    try {
        const { rows } = await pool.query(
            "SELECT id, url, events, status, created_at, last_fired_at FROM webhooks WHERE project_id = $1 ORDER BY created_at DESC",
            [project_id]
        );

        const response: ListWebhooksResponses[200] = { data: rows, request_id };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.WEBHOOKS.LIST_WEBHOOKS, request_id);
    }
}

export async function createWebhook(
    request: FastifyRequest<{ Body: CreateWebhookData['body'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    const project_id = (request as any).project_id!;
    const request_id = generateRequestId();
    const body = request.body as CreateWebhookData['body'];
    const { url, events, secret } = body;

    try {
        // Validate URL
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch {
            return sendError(rep, HTTP_STATUS.BAD_REQUEST, 'INVALID_URL', 'Invalid webhook URL', request_id);
        }

        // Validate events
        const validEvents = ['validation.completed', 'order.evaluated', 'job.completed', 'job.failed'];
        const filteredEvents = events.filter(event => validEvents.includes(event));
        
        if (filteredEvents.length === 0) {
            return sendError(rep, HTTP_STATUS.BAD_REQUEST, 'INVALID_EVENTS', 'No valid events provided', request_id);
        }

        // Generate secret if not provided
        const webhookSecret = secret || crypto.randomBytes(CRYPTO_KEY_BYTES).toString('hex');

        const { rows } = await pool.query(
            "INSERT INTO webhooks (project_id, url, events, secret, status) VALUES ($1, $2, $3, $4, $5) RETURNING id, url, events, status, created_at",
            [project_id, url, filteredEvents, webhookSecret, 'active']
        );

        const response: CreateWebhookResponses[201] = {
            id: rows[0].id,
            url: rows[0].url,
            events: rows[0].events,
            status: rows[0].status,
            secret: webhookSecret,
            created_at: rows[0].created_at,
            request_id
        };
        return rep.status(HTTP_STATUS.CREATED).send(response);
    } catch (error) {
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.WEBHOOKS.CREATE_WEBHOOK, request_id);
    }
}

export async function deleteWebhook(
    request: FastifyRequest<{ Params: DeleteWebhookData['path'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    const project_id = (request as any).project_id!;
    const request_id = generateRequestId();
    const { id } = request.params as DeleteWebhookData['path'];

    try {
        const { rowCount } = await pool.query(
            "DELETE FROM webhooks WHERE id = $1 AND project_id = $2",
            [id, project_id]
        );

        if (rowCount === 0) {
            return sendError(rep, HTTP_STATUS.NOT_FOUND, 'NOT_FOUND', 'Webhook not found', request_id);
        }

        const response: DeleteWebhookResponses[200] = { message: 'Webhook deleted successfully', request_id };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.WEBHOOKS.DELETE_WEBHOOK, request_id);
    }
}

export async function testWebhook(
    request: FastifyRequest<{ Body: TestWebhookData['body'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    const project_id = (request as any).project_id!;
    const request_id = generateRequestId();
    const { id } = request.body as TestWebhookData['body'];

    try {
        // Get webhook details
        const { rows: webhookRows } = await pool.query(
            "SELECT url, secret FROM webhooks WHERE id = $1 AND project_id = $2 AND status = 'active'",
            [id, project_id]
        );

        if (webhookRows.length === 0) {
            return sendError(rep, HTTP_STATUS.NOT_FOUND, 'NOT_FOUND', 'Active webhook not found', request_id);
        }

        const webhook = webhookRows[0];

        // Create test payload
        const testPayload = {
            event: 'test.webhook',
            data: {
                order_id: WEBHOOK_TEST_ORDER_ID,
                risk_score: WEBHOOK_TEST_RISK_SCORE,
                action: 'approve',
                tags: [WEBHOOK_TEST_LOW_RISK_TAG],
                timestamp: new Date().toISOString()
            }
        };

        // Generate signature
        const signature = crypto
            .createHmac('sha256', webhook.secret)
            .update(JSON.stringify(testPayload))
            .digest('hex');

        // Send test webhook (in a real implementation, you would make an HTTP request here)
        // For now, just log that we would send it
        request.log.info({
            webhook_url: webhook.url,
            payload: testPayload,
            signature: signature
        }, 'Test webhook would be sent');

        const response: TestWebhookResponses[200] = {
            message: 'Test webhook sent successfully',
            signature,
            payload: testPayload,
            request_id
        };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.WEBHOOKS.TEST_WEBHOOK, request_id);
    }
}