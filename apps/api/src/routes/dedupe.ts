import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Pool } from "pg";
import crypto from "crypto";
import { normalizeAddress } from "../validators/address";
import { logEvent } from "../hooks";
import { securityHeader, unauthorizedResponse, rateLimitResponse, validationErrorResponse, generateRequestId, sendError, sendServerError } from "./utils";


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
                                    match_type: { type: 'string', enum: ['exact_email', 'exact_phone', 'fuzzy_name', 'fuzzy_email', 'fuzzy_phone'] },
                                    data: { type: 'object' }
                                }
                            }
                        },
                        suggested_action: { type: 'string', enum: ['create_new', 'merge_with', 'review'] },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse
            }
        }
    }, async (req, rep) => {
        try {
            const request_id = generateRequestId();
            const { email, phone, first_name, last_name } = req.body as any;
            const project_id = (req as any).project_id;
            const reason_codes: string[] = [];
            const matches: any[] = [];

            // Deterministic matches
            if (email) {
                const { rows: emailMatches } = await pool.query(
                    'SELECT id, email, phone, first_name, last_name, similarity(email, $1) as score FROM customers WHERE project_id = $2 AND email = $1',
                    [email, project_id]
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

            if (phone) {
                const { rows: phoneMatches } = await pool.query(
                    'SELECT id, email, phone, first_name, last_name, similarity(phone, $1) as score FROM customers WHERE project_id = $2 AND phone = $1',
                    [phone, project_id]
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

            // Fuzzy matches
            const full_name = `${first_name || ''} ${last_name || ''}`.trim();
            if (full_name) {
                const { rows: nameMatches } = await pool.query(
                    `SELECT id, email, phone, first_name, last_name,
                     similarity((first_name || ' ' || last_name), $1) as name_score,
                     similarity(email, $2) as email_score,
                     similarity(phone, $3) as phone_score
                     FROM customers
                     WHERE project_id = $4
                     AND similarity((first_name || ' ' || last_name), $1) > 0.3
                     ORDER BY name_score DESC LIMIT 5`,
                    [full_name, email || '', phone || '', project_id]
                );
                nameMatches.forEach(row => {
                    const score = Math.max(row.name_score, row.email_score || 0, row.phone_score || 0);
                    if (score > 0.3) {
                        matches.push({
                            id: row.id,
                            similarity_score: score,
                            match_type: score === row.name_score ? 'fuzzy_name' : (score === row.email_score ? 'fuzzy_email' : 'fuzzy_phone'),
                            data: row
                        });
                    }
                });
            }
            // Sort matches by score descending
            matches.sort((a, b) => b.similarity_score - a.similarity_score);

            let suggested_action = 'create_new';
            if (matches.length > 0) {
                const bestMatch = matches[0];
                if (bestMatch.similarity_score === 1.0) {
                    suggested_action = 'merge_with';
                } else if (bestMatch.similarity_score > 0.8) {
                    suggested_action = 'review';
                }
            }

            const response = { matches, suggested_action, request_id };
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
                                    match_type: { type: 'string', enum: ['exact_postal', 'fuzzy_address'] },
                                    data: { type: 'object' }
                                }
                            }
                        },
                        suggested_action: { type: 'string', enum: ['create_new', 'merge_with', 'review'] },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse
            }
        }
    }, async (req, rep) => {
        try {
            const request_id = generateRequestId();
            const { line1, line2, city, state, postal_code, country } = req.body as any;
            const project_id = (req as any).project_id;
            const reason_codes: string[] = [];
            const matches: any[] = [];

            // Normalize the input address
            const normAddr = await normalizeAddress({ line1, line2: line2 || '', city, state: state || '', postal_code, country });
            const addrKey = `${normAddr.line1} ${normAddr.line2} ${normAddr.city} ${normAddr.state} ${normAddr.postal_code} ${normAddr.country}`.trim();

            // Deterministic match: exact postal_code + city + country
            const { rows: exactMatches } = await pool.query(
                'SELECT id, line1, line2, city, state, postal_code, country, lat, lng, similarity((line1 || \' \' || line2 || \' \' || city || \' \' || state || \' \' || postal_code || \' \' || country), $1) as score FROM addresses WHERE project_id = $2 AND postal_code = $3 AND lower(city) = lower($4) AND country = $5',
                [addrKey, project_id, normAddr.postal_code, normAddr.city, normAddr.country]
            );
            exactMatches.forEach(row => {
                if (row.id) {
                    matches.push({
                        id: row.id,
                        similarity_score: 1.0,
                        match_type: 'exact_postal',
                        data: row
                    });
                }
            });

            // Fuzzy matches
            const { rows: fuzzyMatches } = await pool.query(
                `SELECT id, line1, line2, city, state, postal_code, country, lat, lng,
                 similarity((line1 || ' ' || line2 || ' ' || city || ' ' || state || ' ' || postal_code || ' ' || country), $1) as score
                 FROM addresses
                 WHERE project_id = $2
                 AND similarity((line1 || ' ' || line2 || ' ' || city || ' ' || state || ' ' || postal_code || ' ' || country), $1) > 0.6
                 ORDER BY score DESC LIMIT 5`,
                [addrKey, project_id]
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
            if (matches.length > 0) {
                const bestMatch = matches[0];
                if (bestMatch.similarity_score === 1.0) {
                    suggested_action = 'merge_with';
                } else if (bestMatch.similarity_score > 0.8) {
                    suggested_action = 'review';
                }
            }

            const response = { matches, suggested_action, request_id };
            await (rep as any).saveIdem?.(response);
            await logEvent(project_id, 'dedupe', '/dedupe/address', reason_codes, 200, { matches_count: matches.length, suggested_action }, pool);
            return rep.send(response);
        } catch (error) {
            return sendServerError(req, rep, error, '/v1/dedupe/address', generateRequestId());
        }
    });
}