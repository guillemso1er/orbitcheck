import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fetch from "node-fetch";
import { Pool } from "pg";
import { logEvent } from "../hooks";
import { verifyJWT } from "./auth";
import { generateRequestId, rateLimitResponse, securityHeader, sendError, unauthorizedResponse } from "./utils";


export function registerWebhookRoutes(app: FastifyInstance, pool: Pool) {
    app.post('/webhooks/test', {
        preHandler: async (req: FastifyRequest, rep: FastifyReply) => await verifyJWT(req, rep, pool),
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
    }, async (req, rep) => {
        const project_id = (req as any).project_id;
        const { url, payload_type = 'validation', custom_payload } = req.body as {
            url: string;
            payload_type?: 'validation' | 'order' | 'custom';
            custom_payload?: any;
        };
        try {
            const request_id = generateRequestId();

            if (!url || !/^https?:\/\//.test(url)) {
                return sendError(rep, 400, 'invalid_url', 'Valid HTTPS/HTTP URL required', request_id);
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
                        return sendError(rep, 400, 'missing_payload', 'Custom payload required for custom type', request_id);
                    }
                    payload = { ...common, ...custom_payload };
                    break;
                default:
                    return sendError(rep, 400, 'invalid_type', 'Invalid payload_type', request_id);
            }

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
            const request_id = generateRequestId();
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            await logEvent(project_id, 'webhook_test', '/webhooks/test', ['webhook.send_failed'], 500, {
                url,
                payload_type,
                error: errorMsg
            }, pool);

            return sendError(rep, 500, 'send_failed', errorMsg, request_id);
        }
    });
}