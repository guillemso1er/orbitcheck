import { API_V1_ROUTES } from "@orbicheck/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import { generateRequestId, rateLimitResponse, securityHeader, sendServerError, unauthorizedResponse, validationErrorResponse } from "./utils.js";

export function registerNormalizeRoutes(app: FastifyInstance, pool: Pool): void {
    app.post(API_V1_ROUTES.NORMALIZE.NORMALIZE_ADDRESS_CHEAP, {
        schema: {
            summary: 'Normalize Address (Cheap)',
            description: 'Performs basic address normalization without geocoding or external lookups.',
            tags: ['Normalization'],
            headers: securityHeader,
            body: {
                type: 'object',
                required: ['address'],
                properties: {
                    address: {
                        type: 'object',
                        required: ['line1', 'city', 'postal_code', 'country'],
                        properties: {
                            line1: { type: 'string' },
                            line2: { type: 'string' },
                            city: { type: 'string' },
                            state: { type: 'string' },
                            postal_code: { type: 'string' },
                            country: { type: 'string', minLength: 2, maxLength: 2 }
                        }
                    }
                }
            },
            response: {
                200: {
                    description: 'Successful normalization response',
                    type: 'object',
                    properties: {
                        normalized: {
                            type: 'object',
                            properties: {
                                line1: { type: 'string' },
                                line2: { type: 'string' },
                                city: { type: 'string' },
                                state: { type: 'string' },
                                postal_code: { type: 'string' },
                                country: { type: 'string' }
                            }
                        },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse,
            }
        }
    }, async (request, rep) => {
        try {
            const request_id = generateRequestId();
            const body = request.body as any;
            const { address } = body;

            // Basic normalization: trim strings and uppercase country
            const normalized = {
                line1: address.line1?.trim() || '',
                line2: address.line2?.trim() || '',
                city: address.city?.trim() || '',
                state: address.state?.trim() || '',
                postal_code: address.postal_code?.trim() || '',
                country: address.country?.toUpperCase() || ''
            };

            const response: any = { normalized, request_id };
            return rep.send(response);
        } catch (error) {
            return sendServerError(request, rep, error, API_V1_ROUTES.NORMALIZE.NORMALIZE_ADDRESS_CHEAP, generateRequestId());
        }
    });
}