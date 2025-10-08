import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fetch from "node-fetch";
import type { Pool } from "pg";

import { ERROR_CODES, ERROR_MESSAGES, EVENT_TYPES, HTTP_STATUS, ORDER_ACTIONS, PAYLOAD_TYPES, REASON_CODES } from "../constants.js";
import { logEvent } from "../hooks.js";
import { verifyJWT } from "./auth.js";
import { generateRequestId, rateLimitResponse, securityHeader, sendError, unauthorizedResponse } from "./utils.js";
import { MGMT_V1_ROUTES } from "@orbicheck/contracts";
// Import route constants from contracts package
// TODO: Update to use @orbicheck/contracts export once build issues are resolved
const ROUTES = {
    WEBHOOKS_TEST: MGMT_V1_ROUTES.WEBHOOKS.TEST_WEBHOOK,
};


export function registerWebhookRoutes(app: FastifyInstance, pool: Pool): void {
    app.post(ROUTES.WEBHOOKS_TEST, {
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        preHandler: async (request: FastifyRequest, rep: FastifyReply, done) => {
            try {
                await verifyJWT(request, rep, pool);
                done();
            } catch (error) {
                done(error instanceof Error ? error : new Error(String(error)));
            }
        },
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

            if (!url || !/^https?:\/\//.test(url)) {
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
                        order_id: 'test-order-123',
                        risk_score: 25,
                        action: ORDER_ACTIONS.APPROVE,
                        reason_codes: [], // Use actual reason code if needed
                        tags: ['low_risk']
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
                    'Content-Type': 'application/json',
                    'User-Agent': 'OrbiCheck-Webhook-Tester/1.0'
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
            const errorMessage = error instanceof globalThis.Error ? (error).message : 'Unknown error';
            await logEvent(project_id, 'webhook_test', MGMT_V1_ROUTES.WEBHOOKS.TEST_WEBHOOK, [REASON_CODES.WEBHOOK_SEND_FAILED], HTTP_STATUS.INTERNAL_SERVER_ERROR, {
                url,
                payload_type,
                error: errorMessage
            }, pool);

            return sendError(rep, HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.WEBHOOK_SEND_FAILED, errorMessage, request_id);
        }
    });
}