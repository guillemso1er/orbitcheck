import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fetch from "node-fetch";
import { Pool } from "pg";
import { logEvent } from "../hooks";
import { verifyJWT } from "./auth";
import { HTTP_STATUS, ERROR_CODES, ERROR_MESSAGES, PAYLOAD_TYPES, EVENT_TYPES, REASON_CODES, ORDER_ACTIONS } from "../constants";
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
        const { url, payload_type = PAYLOAD_TYPES.VALIDATION, custom_payload } = req.body as {
            url: string;
            payload_type?: typeof PAYLOAD_TYPES[keyof typeof PAYLOAD_TYPES];
            custom_payload?: any;
        };
        try {
            const request_id = generateRequestId();

            if (!url || !/^https?:\/\//.test(url)) {
                return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_URL, ERROR_MESSAGES[ERROR_CODES.INVALID_URL], request_id);
            }

            let payload: any;
            const timestamp = new Date().toISOString();
            const common = {
                project_id,
                timestamp,
                request_id
            };

            switch (payload_type) {
                case PAYLOAD_TYPES.VALIDATION:
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
                case PAYLOAD_TYPES.ORDER:
                    payload = {
                        ...common,
                        event: EVENT_TYPES.ORDER_EVALUATED,
                        order_id: 'test-order-123',
                        risk_score: 25,
                        action: ORDER_ACTIONS.APPROVE,
                        reason_codes: [], // Use actual reason code if needed
                        tags: ['low_risk']
                    };
                    break;
                case PAYLOAD_TYPES.CUSTOM:
                    if (!custom_payload) {
                        return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.MISSING_PAYLOAD, ERROR_MESSAGES[ERROR_CODES.MISSING_PAYLOAD], request_id);
                    }
                    payload = { ...common, ...custom_payload };
                    break;
                default:
                    return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_TYPE, ERROR_MESSAGES[ERROR_CODES.INVALID_TYPE], request_id);
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

            await logEvent(project_id, 'webhook_test', '/webhooks/test', [], HTTP_STATUS.OK, {
                url,
                payload_type,
                response_status: response.status
            }, pool);

            return rep.send(result);
        } catch (err) {
            const request_id = generateRequestId();
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            await logEvent(project_id, 'webhook_test', '/webhooks/test', [REASON_CODES.WEBHOOK_SEND_FAILED], HTTP_STATUS.INTERNAL_SERVER_ERROR, {
                url,
                payload_type,
                error: errorMsg
            }, pool);

            return sendError(rep, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.WEBHOOK_SEND_FAILED, errorMsg, request_id);
        }
    });
}