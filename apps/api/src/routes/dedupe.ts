import crypto from "node:crypto";

import { API_V1_ROUTES } from "@orbicheck/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { DEDUPE_ACTIONS, ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS, MATCH_TYPES, MERGE_TYPES, SIMILARITY_EXACT, SIMILARITY_FUZZY_THRESHOLD } from "../constants.js";
import { logEvent } from "../hooks.js";
import { normalizeAddress } from "../validators/address.js";
import { generateRequestId, rateLimitResponse, securityHeader, sendServerError, unauthorizedResponse, validationErrorResponse } from "./utils.js";

export function registerDedupeRoutes(app: FastifyInstance, pool: Pool): void {
    app.post(API_V1_ROUTES.DEDUPE.DEDUPLICATE_CUSTOMER, {
        schema: {
            summary: 'Deduplicate Customer',
            description: 'Searches for existing customers using deterministic (exact) and fuzzy matching on email, phone, and name.',
            tags: ['Deduplication'],
            headers: securityHeader,
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
            const { email, phone, first_name, last_name } = body;
            const project_id = (request as any).project_id;
            const reason_codes: string[] = [];
            const matches: any[] = [];

            // Deterministic matches using normalized fields
            const normEmail = email ? email.trim().toLowerCase() : null;
            const normPhone = phone ? phone.replaceAll(/[^\d+]/g, '') : null; // Simple E.164 prep

            if (normEmail) {
                const { rows: emailMatches } = await pool.query(
                    'SELECT id, email, phone, first_name, last_name FROM customers WHERE project_id = $2 AND normalized_email = $1',
                    [normEmail, project_id]
                );
                for (const row of emailMatches) {
                    if (row.id) {
                        matches.push({
                            id: row.id,
                            similarity_score: 1,
                            match_type: MATCH_TYPES.EXACT_EMAIL,
                            data: row
                        });
                    }
                }
            }

            if (normPhone) {
                const { rows: phoneMatches } = await pool.query(
                    'SELECT id, email, phone, first_name, last_name FROM customers WHERE project_id = $2 AND normalized_phone = $1',
                    [normPhone, project_id]
                );
                for (const row of phoneMatches) {
                    if (row.id) {
                        matches.push({
                            id: row.id,
                            similarity_score: 1,
                            match_type: MATCH_TYPES.EXACT_PHONE,
                            data: row
                        });
                    }
                }
            }

            // Fuzzy matches with 0.85 threshold on name
            const full_name = `${first_name || ''} ${last_name || ''}`.trim();
            if (full_name) {
                const { rows: nameMatches } = await pool.query(
                    `SELECT id, email, phone, first_name, last_name,
                     similarity((first_name || ' ' || last_name), $1) as name_score
                     FROM customers
                     WHERE project_id = $2
                     AND similarity((first_name || ' ' || last_name), $1) > 0.85
                     ORDER BY name_score DESC LIMIT 5`,
                    [full_name, project_id]
                );
                for (const row of nameMatches) {
                    const score = row.name_score;
                    if (score > 0.85) {
                        matches.push({
                            id: row.id,
                            similarity_score: score,
                            match_type: MATCH_TYPES.FUZZY_NAME,
                            data: row
                        });
                    }
                }
            }
            // Sort matches by score descending
            matches.sort((a, b) => b.similarity_score - a.similarity_score);

            let suggested_action: 'create_new' | 'merge_with' | 'review' = DEDUPE_ACTIONS.CREATE_NEW;
            let canonical_id: string | null = null;
            if (matches.length > 0) {
                const bestMatch = matches[0];
                if (bestMatch.similarity_score === SIMILARITY_EXACT) {
                    suggested_action = DEDUPE_ACTIONS.MERGE_WITH;
                    canonical_id = bestMatch.id;
                } else if (bestMatch.similarity_score > SIMILARITY_FUZZY_THRESHOLD) {
                    suggested_action = DEDUPE_ACTIONS.REVIEW;
                    canonical_id = bestMatch.id; // Suggest the highest score as canonical
                }
            }

            const response: any = { matches, suggested_action, canonical_id, request_id };
            await (rep as any).saveIdem?.(response);
            await logEvent(project_id, 'dedupe', '/dedupe/customer', reason_codes, HTTP_STATUS.OK, { matches_count: matches.length, suggested_action }, pool);
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
            const { line1, line2, city, state, postal_code, country } = body;
            const project_id = (request as any).project_id;
            const reason_codes: string[] = [];
            const matches: any[] = [];

            // Normalize the input address
            const normAddr = await normalizeAddress({ line1, line2: line2 || '', city, state: state || '', postal_code, country });
            const addrHash = crypto.createHash('sha256').update(JSON.stringify(normAddr)).digest('hex');

            // Deterministic match: exact address_hash
            const { rows: hashMatches } = await pool.query(
                'SELECT id, line1, line2, city, state, postal_code, country, lat, lng FROM addresses WHERE project_id = $2 AND address_hash = $1',
                [addrHash, project_id]
            );
            for (const row of hashMatches) {
                if (row.id) {
                    matches.push({
                        id: row.id,
                        similarity_score: 1,
                        match_type: MATCH_TYPES.EXACT_ADDRESS,
                        data: row
                    });
                }
            }

            // Fallback deterministic: exact postal_code + city + country
            if (matches.length === 0) {
                const { rows: exactMatches } = await pool.query(
                    'SELECT id, line1, line2, city, state, postal_code, country, lat, lng FROM addresses WHERE project_id = $2 AND postal_code = $3 AND lower(city) = lower($4) AND country = $5',
                    [project_id, normAddr.postal_code, normAddr.city, normAddr.country]
                );
                for (const row of exactMatches) {
                    if (row.id && !matches.some(m => m.id === row.id)) {
                        matches.push({
                            id: row.id,
                            similarity_score: 1,
                            match_type: MATCH_TYPES.EXACT_POSTAL,
                            data: row
                        });
                    }
                }
            }

            // Fuzzy matches with 0.85 threshold on line1, city
            const { rows: fuzzyMatches } = await pool.query(
                `SELECT id, line1, line2, city, state, postal_code, country, lat, lng,
                 greatest(similarity(line1, $2), similarity(city, $3)) as score
                 FROM addresses
                 WHERE project_id = $1
                 AND (similarity(line1, $2) > 0.85 OR similarity(city, $3) > 0.85)
                 ORDER BY score DESC LIMIT 5`,
                [project_id, normAddr.line1, normAddr.city]
            );
            for (const row of fuzzyMatches) {
                if (row.id && !matches.some(m => m.id === row.id)) {  // Avoid duplicates
                    matches.push({
                        id: row.id,
                        similarity_score: row.score,
                        match_type: MATCH_TYPES.FUZZY_ADDRESS,
                        data: row
                    });
                }
            }

            // Sort matches by score descending
            matches.sort((a, b) => b.similarity_score - a.similarity_score);

            let suggested_action: 'create_new' | 'merge_with' | 'review' = DEDUPE_ACTIONS.CREATE_NEW;
            let canonical_id: string | null = null;
            if (matches.length > 0) {
                const bestMatch = matches[0];
                if (bestMatch.similarity_score === SIMILARITY_EXACT) {
                    suggested_action = DEDUPE_ACTIONS.MERGE_WITH;
                    canonical_id = bestMatch.id;
                } else if (bestMatch.similarity_score > SIMILARITY_FUZZY_THRESHOLD) {
                    suggested_action = DEDUPE_ACTIONS.REVIEW;
                    canonical_id = bestMatch.id; // Suggest the highest score as canonical
                }
            }

            const response: any = { matches, suggested_action, canonical_id, request_id };
            await (rep as any).saveIdem?.(response);
            await logEvent(project_id, 'dedupe', '/dedupe/address', reason_codes, HTTP_STATUS.OK, { matches_count: matches.length, suggested_action }, pool);
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