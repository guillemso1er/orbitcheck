
import { API_V1_ROUTES } from "@orbitcheck/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { dedupeAddress, dedupeCustomer } from "../dedupe.js";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../errors.js";
import { logEvent } from "../hooks.js";
import { MERGE_TYPES } from "../validation.js";
import { generateRequestId, rateLimitResponse, runtimeSecurityHeader as securityHeader, sendServerError, unauthorizedResponse, validationErrorResponse } from "./utils.js";

export function registerDedupeRoutes(app: FastifyInstance, pool: Pool): void {
    app.post(API_V1_ROUTES.DEDUPE.DEDUPLICATE_CUSTOMER, {
        schema: {
            summary: 'Deduplicate Customer',
            description: 'Searches for existing customers using deterministic (exact) and fuzzy matching on email, phone, and name.',
            tags: ['Deduplication'],
            headers: securityHeader,
            security: [{ ApiKeyAuth: [] }],
            body: {
                type: 'object',
                required: ['email', 'first_name', 'last_name'],
                properties: {
                    email: { type: 'string' },
                    phone: { type: 'string' },
                    first_name: { type: 'string' },
                    last_name: { type: 'string' }
                }
            },
            response: {
                200: {
                    description: 'Deduplication results',
                    type: 'object',
                    properties: {
                        matches: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    similarity_score: { type: 'number' },
                                    match_type: { type: 'string', enum: ['exact_email', 'exact_phone', 'fuzzy_name'] },
                                    data: { type: 'object' }
                                }
                            }
                        },
                        suggested_action: { type: 'string', enum: ['create_new', 'merge_with', 'review'] },
                        canonical_id: { type: 'string', nullable: true, description: 'Suggested canonical ID for merge/review' },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse
            }
        }
    }, async (request: FastifyRequest, rep: FastifyReply) => {
        try {
            const request_id = generateRequestId();
            const body = request.body as any;
            const project_id = (request as any).project_id;
            const reason_codes: string[] = [];

            const result = await dedupeCustomer(body, project_id, pool);
            const response: any = { ...result, request_id };
            await (rep as any).saveIdem?.(response);
            await logEvent(project_id, 'dedupe', '/dedupe/customer', reason_codes, HTTP_STATUS.OK, { matches_count: result.matches.length, suggested_action: result.suggested_action }, pool);
            return rep.send(response);
        } catch (error) {
            return sendServerError(request, rep, error, API_V1_ROUTES.DEDUPE.DEDUPLICATE_CUSTOMER, generateRequestId());
        }
    });

    app.post(API_V1_ROUTES.DEDUPE.DEDUPLICATE_ADDRESS, {
        schema: {
            summary: 'Deduplicate Address',
            description: 'Searches for existing addresses using deterministic (exact postal/city/country) and fuzzy matching on address components.',
            tags: ['Deduplication'],
            headers: securityHeader,
            security: [{ ApiKeyAuth: [] }],
            body: {
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
            },
            response: {
                200: {
                    description: 'Deduplication results',
                    type: 'object',
                    properties: {
                        matches: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    similarity_score: { type: 'number' },
                                    match_type: { type: 'string', enum: ['exact_address', 'exact_postal', 'fuzzy_address'] },
                                    data: { type: 'object' }
                                }
                            }
                        },
                        suggested_action: { type: 'string', enum: ['create_new', 'merge_with', 'review'] },
                        canonical_id: { type: 'string', nullable: true, description: 'Suggested canonical ID for merge/review' },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse
            }
        }
    }, async (request: FastifyRequest, rep: FastifyReply) => {
        try {
            const request_id = generateRequestId();
            const body = request.body as any;
            const project_id = (request as any).project_id;
            const reason_codes: string[] = [];

            const result = await dedupeAddress(body, project_id, pool);
            const response: any = { ...result, request_id };
            await (rep as any).saveIdem?.(response);
            await logEvent(project_id, 'dedupe', '/dedupe/address', reason_codes, HTTP_STATUS.OK, { matches_count: result.matches.length, suggested_action: result.suggested_action }, pool);
            return rep.send(response);
        } catch (error) {
            return sendServerError(request, rep, error, API_V1_ROUTES.DEDUPE.DEDUPLICATE_ADDRESS, generateRequestId());
        }
    });

    // New endpoint for merging deduplicated records
    app.post(API_V1_ROUTES.DEDUPE.MERGE_DEDUPLICATED_RECORDS, {
        schema: {
            summary: 'Merge Deduplicated Records',
            description: 'Merges multiple customer or address records into a canonical one. Updates the canonical with latest data, marks others as merged.',
            tags: ['Deduplication'],
            headers: securityHeader,
            security: [{ ApiKeyAuth: [] }],
            body: {
                type: 'object',
                required: ['type', 'ids', 'canonical_id'],
                properties: {
                    type: { type: 'string', enum: ['customer', 'address'] },
                    ids: { type: 'array', items: { type: 'string' }, description: 'IDs to merge' },
                    canonical_id: { type: 'string', description: 'ID of the canonical record to keep' }
                }
            },
            response: {
                200: {
                    description: 'Merge result',
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        merged_count: { type: 'integer' },
                        canonical_id: { type: 'string' },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse
            }
        }
    }, async (request: FastifyRequest, rep: FastifyReply) => {
        try {
            const request_id = generateRequestId();
            const body = request.body as any;
            const { type, ids, canonical_id } = body;
            const project_id = (request as any).project_id;
            const table = type === MERGE_TYPES.CUSTOMER ? 'customers' : 'addresses';
            const count = ids.length;

            // Verify all IDs belong to project
            const { rows: verifyRows } = await pool.query(
                `SELECT id FROM ${table} WHERE project_id = $1 AND id = ANY($2)`,
                [project_id, [...ids, canonical_id]]
            );
            if (verifyRows.length !== count + 1) {
                return rep.status(HTTP_STATUS.BAD_REQUEST).send({ error: { code: ERROR_CODES.INVALID_IDS, message: ERROR_MESSAGES[ERROR_CODES.INVALID_IDS] } });
            }

            // Merge: update canonical, mark others as merged (assume merged_to column exists from migration)
            await pool.query(
                `UPDATE ${table} SET updated_at = now() WHERE id = $1 AND project_id = $2`,
                [canonical_id, project_id]
            );
            await pool.query(
                `UPDATE ${table} SET updated_at = now(), merged_to = $1 WHERE id = ANY($2) AND id != $1 AND project_id = $3`,
                [canonical_id, ids, project_id]
            );

            const response: any = { success: true, merged_count: count, canonical_id, request_id };
            await (rep as any).saveIdem?.(response);
            await logEvent(project_id, 'dedupe', '/dedupe/merge', [], HTTP_STATUS.OK, { type, merged_count: count }, pool);
            return rep.send(response);
        } catch (error) {
            return sendServerError(request, rep, error, API_V1_ROUTES.DEDUPE.MERGE_DEDUPLICATED_RECORDS, generateRequestId());
        }
    });
}