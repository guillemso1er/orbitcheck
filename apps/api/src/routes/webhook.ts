import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Pool } from "pg";
import fetch from "node-fetch";
import crypto from "crypto";
import { logEvent } from "../hooks";

const errorSchema = {
    type: 'object',
    properties: {
        error: {
            type: 'object',
            properties: {
                code: { type: 'string' },
                message: { type: 'string' }
            }
        }
    }
};

const securityHeader = {
    type: 'object',
    properties: {
        'authorization': { type: 'string' },
        'idempotency-key': { type: 'string' }
    },
    required: ['authorization']
};

const unauthorizedResponse = { 401: { description: 'Unauthorized', ...errorSchema } };
const rateLimitResponse = { 429: { description: 'Rate Limit Exceeded', ...errorSchema } };

export function registerWebhookRoutes(app: FastifyInstance, pool: Pool) {
    app.post('/webhooks/test', {
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
                        payload: { type: 'object' },
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
    }, async (req, rep) => {
        const project_id = (req as any).project_id;
        const { url, payload_type = 'validation', custom_payload } = req.body as {
            url: string;
            payload_type?: 'validation' | 'order' | 'custom';
            custom_payload?: any;
        };
        const request_id = crypto.randomUUID();

        if (!url || !/^https?:\/\//.test(url)) {
            return rep.status(400).send({
                error: { code: 'invalid_url', message: 'Valid HTTPS/HTTP URL required' },
                request_id
            });
        }

        let payload: any;
        const timestamp = new Date().toISOString();
        const common = {
            project_id,
            timestamp,
            request_id
        };

        switch (payload_type) {
            case 'validation':
                payload = {
                    ...common,
                    event: 'validation_result',
                    type: 'email',
                    result: {
                        valid: true,
                        normalized: 'user@example.com',
                        reason_codes: ['email.valid'],
                        meta: { domain: 'example.com' }
                    }
                };
                break;
            case 'order':
                payload = {
                    ...common,
                    event: 'order_evaluated',
                    order_id: 'test-order-123',
                    risk_score: 25,
                    action: 'approve',
                    reason_codes: ['order.approved'],
                    tags: ['low_risk']
                };
                break;
            case 'custom':
                if (!custom_payload) {
                    return rep.status(400).send({
                        error: { code: 'missing_payload', message: 'Custom payload required for custom type' },
                        request_id
                    });
                }
                payload = { ...common, ...custom_payload };
                break;
            default:
                return rep.status(400).send({
                    error: { code: 'invalid_type', message: 'Invalid payload_type' },
                    request_id
                });
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'OrbiCheck-Webhook-Tester/1.0'
                },
                body: JSON.stringify(payload)
            });

            const responseBody = await response.text();
            const responseHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                responseHeaders[key] = value;
            });

            const result = {
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

            await logEvent(project_id, 'webhook_test', '/webhooks/test', [], 200, {
                url,
                payload_type,
                response_status: response.status
            }, pool);

            return rep.send(result);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            await logEvent(project_id, 'webhook_test', '/webhooks/test', ['webhook.send_failed'], 500, {
                url,
                payload_type,
                error: errorMsg
            }, pool);

            return rep.status(500).send({
                error: { code: 'send_failed', message: errorMsg },
                request_id
            });
        }
    });
}