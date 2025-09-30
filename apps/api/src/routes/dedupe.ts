import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Pool } from "pg";
import crypto from "crypto";
import { normalizeAddress } from "../validators/address";
import { logEvent } from "../hooks";
import { securityHeader, unauthorizedResponse, rateLimitResponse, validationErrorResponse, generateRequestId, sendServerError } from "./utils";

export function registerDedupeRoutes(app: FastifyInstance, pool: Pool) {
    app.post('/v1/dedupe/customer', {
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
    }, async (req: FastifyRequest, rep: FastifyReply) => {
        try {
            const request_id = generateRequestId();
            const { email, phone, first_name, last_name } = req.body as any;
            const project_id = (req as any).project_id;
            const reason_codes: string[] = [];
            const matches: any[] = [];

            // Deterministic matches using normalized fields
            let normEmail = email ? email.trim().toLowerCase() : null;
            let normPhone = phone ? phone.replace(/[^0-9+]/g, '') : null; // Simple E.164 prep

            if (normEmail) {
                const { rows: emailMatches } = await pool.query(
                    'SELECT id, email, phone, first_name, last_name FROM customers WHERE project_id = $2 AND normalized_email = $1',
                    [normEmail, project_id]
                );
                emailMatches.forEach(row => {
                    if (row.id) {
                        matches.push({
                            id: row.id,
                            similarity_score: 1.0,
                            match_type: 'exact_email',
                            data: row
                        });
                    }
                });
            }

            if (normPhone) {
                const { rows: phoneMatches } = await pool.query(
                    'SELECT id, email, phone, first_name, last_name FROM customers WHERE project_id = $2 AND normalized_phone = $1',
                    [normPhone, project_id]
                );
                phoneMatches.forEach(row => {
                    if (row.id) {
                        matches.push({
                            id: row.id,
                            similarity_score: 1.0,
                            match_type: 'exact_phone',
                            data: row
                        });
                    }
                });
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
                nameMatches.forEach(row => {
                    const score = row.name_score;
                    if (score > 0.85) {
                        matches.push({
                            id: row.id,
                            similarity_score: score,
                            match_type: 'fuzzy_name',
                            data: row
                        });
                    }
                });
            }
            // Sort matches by score descending
            matches.sort((a, b) => b.similarity_score - a.similarity_score);

            let suggested_action = 'create_new';
            let canonical_id: string | null = null;
            if (matches.length > 0) {
                const bestMatch = matches[0];
                if (bestMatch.similarity_score === 1.0) {
                    suggested_action = 'merge_with';
                    canonical_id = bestMatch.id;
                } else if (bestMatch.similarity_score > 0.85) {
                    suggested_action = 'review';
                    canonical_id = bestMatch.id; // Suggest the highest score as canonical
                }
            }

            const response = { matches, suggested_action, canonical_id, request_id };
            await (rep as any).saveIdem?.(response);
            await logEvent(project_id, 'dedupe', '/dedupe/customer', reason_codes, 200, { matches_count: matches.length, suggested_action }, pool);
            return rep.send(response);
        } catch (error) {
            return sendServerError(req, rep, error, '/v1/dedupe/customer', generateRequestId());
        }
    });

    app.post('/v1/dedupe/address', {
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
    }, async (req: FastifyRequest, rep: FastifyReply) => {
        try {
            const request_id = generateRequestId();
            const { line1, line2, city, state, postal_code, country } = req.body as any;
            const project_id = (req as any).project_id;
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
            hashMatches.forEach(row => {
                if (row.id) {
                    matches.push({
                        id: row.id,
                        similarity_score: 1.0,
                        match_type: 'exact_address',
                        data: row
                    });
                }
            });

            // Fallback deterministic: exact postal_code + city + country
            if (matches.length === 0) {
                const { rows: exactMatches } = await pool.query(
                    'SELECT id, line1, line2, city, state, postal_code, country, lat, lng FROM addresses WHERE project_id = $2 AND postal_code = $3 AND lower(city) = lower($4) AND country = $5',
                    [project_id, normAddr.postal_code, normAddr.city, normAddr.country]
                );
                exactMatches.forEach(row => {
                    if (row.id && !matches.some(m => m.id === row.id)) {
                        matches.push({
                            id: row.id,
                            similarity_score: 1.0,
                            match_type: 'exact_postal',
                            data: row
                        });
                    }
                });
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
            fuzzyMatches.forEach(row => {
                if (row.id && !matches.some(m => m.id === row.id)) {  // Avoid duplicates
                    matches.push({
                        id: row.id,
                        similarity_score: row.score,
                        match_type: 'fuzzy_address',
                        data: row
                    });
                }
            });

            // Sort matches by score descending
            matches.sort((a, b) => b.similarity_score - a.similarity_score);

            let suggested_action = 'create_new';
            let canonical_id: string | null = null;
            if (matches.length > 0) {
                const bestMatch = matches[0];
                if (bestMatch.similarity_score === 1.0) {
                    suggested_action = 'merge_with';
                    canonical_id = bestMatch.id;
                } else if (bestMatch.similarity_score > 0.85) {
                    suggested_action = 'review';
                    canonical_id = bestMatch.id; // Suggest the highest score as canonical
                }
            }

            const response = { matches, suggested_action, canonical_id, request_id };
            await (rep as any).saveIdem?.(response);
            await logEvent(project_id, 'dedupe', '/dedupe/address', reason_codes, 200, { matches_count: matches.length, suggested_action }, pool);
            return rep.send(response);
        } catch (error) {
            return sendServerError(req, rep, error, '/v1/dedupe/address', generateRequestId());
        }
    });

    // New endpoint for merging deduplicated records
    app.post('/v1/dedupe/merge', {
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
    }, async (req: FastifyRequest, rep: FastifyReply) => {
        try {
            const request_id = generateRequestId();
            const { type, ids, canonical_id } = req.body as { type: string; ids: string[]; canonical_id: string };
            const project_id = (req as any).project_id;
            const table = type === 'customer' ? 'customers' : 'addresses';
            const count = ids.length;

            // Verify all IDs belong to project
            const { rows: verifyRows } = await pool.query(
                `SELECT id FROM ${table} WHERE project_id = $1 AND id = ANY($2)`,
                [project_id, [...ids, canonical_id]]
            );
            if (verifyRows.length !== count + 1) {
                return rep.status(400).send({ error: { code: 'invalid_ids', message: 'Invalid or mismatched IDs' } });
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

            const response = { success: true, merged_count: count, canonical_id, request_id };
            await (rep as any).saveIdem?.(response);
            await logEvent(project_id, 'dedupe', '/dedupe/merge', [], 200, { type, merged_count: count }, pool);
            return rep.send(response);
        } catch (error) {
            return sendServerError(req, rep, error, '/v1/dedupe/merge', generateRequestId());
        }
    });
}