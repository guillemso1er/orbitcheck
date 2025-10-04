import crypto from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type { Pool } from "pg";

import { DEDUPE_ACTIONS, HIGH_VALUE_THRESHOLD, HTTP_STATUS, MATCH_TYPES, ORDER_ACTIONS, ORDER_TAGS, PAYMENT_METHODS, REASON_CODES, RISK_ADDRESS_DEDUPE, RISK_BLOCK_THRESHOLD, RISK_COD, RISK_COD_HIGH, RISK_CUSTOMER_DEDUPE, RISK_GEO_OUT, RISK_GEOCODE_FAIL, RISK_HIGH_VALUE, RISK_HOLD_THRESHOLD, RISK_INVALID_ADDR, RISK_INVALID_EMAIL_PHONE, RISK_PO_BOX, RISK_POSTAL_MISMATCH, SIMILARITY_EXACT } from "../constants.js";
import { logEvent } from "../hooks.js";
import { validateAddress } from "../validators/address.js";
import { validateEmail } from "../validators/email.js";
import { validatePhone } from "../validators/phone.js";
import { generateRequestId, rateLimitResponse, securityHeader, sendServerError, unauthorizedResponse, validationErrorResponse } from "./utils.js";


const customerMatchSchema = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        email: { type: 'string', nullable: true },
        phone: { type: 'string', nullable: true },
        first_name: { type: 'string', nullable: true },
        last_name: { type: 'string', nullable: true },
        similarity_score: { type: 'number' },
        match_type: { type: 'string' }
    }
};

const addressMatchSchema = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        line1: { type: 'string', nullable: true },
        line2: { type: 'string', nullable: true },
        city: { type: 'string', nullable: true },
        state: { type: 'string', nullable: true },
        postal_code: { type: 'string', nullable: true },
        country: { type: 'string', nullable: true },
        lat: { type: 'number', nullable: true },
        lng: { type: 'number', nullable: true },
        similarity_score: { type: 'number' },
        match_type: { type: 'string' }
    }
};

export function registerOrderRoutes(app: FastifyInstance, pool: Pool, redis: Redis) {
    app.post('/v1/orders/evaluate', {
        schema: {
            summary: 'Evaluate Order for Risk and Rules',
            description: 'Evaluates an order for deduplication, validation, and applies business rules like P.O. box blocking, fraud scoring, and auto-hold/tagging. Returns risk assessment and action recommendations.',
            tags: ['Order Evaluation'],
            headers: securityHeader,
            body: {
                type: 'object',
                required: ['order_id', 'customer', 'shipping_address', 'total_amount', 'currency'],
                properties: {
                    order_id: { type: 'string', description: 'Unique order identifier' },
                    customer: {
                        type: 'object',
                        properties: {
                            email: { type: 'string' },
                            phone: { type: 'string' },
                            first_name: { type: 'string' },
                            last_name: { type: 'string' }
                        }
                    },
                    shipping_address: {
                        type: 'object',
                        required: ['line1', 'city', 'postal_code', 'country'],
                        properties: {
                            line1: { type: 'string' },
                            line2: { type: 'string' },
                            city: { type: 'string' },
                            state: { type: 'string' },
                            postal_code: { type: 'string' },
                            country: { type: 'string' }
                        }
                    },
                    total_amount: { type: 'number' },
                    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
                    payment_method: { type: 'string', enum: ['card', 'cod', 'bank_transfer'] }
                }
            },
            response: {
                200: {
                    description: 'Order evaluation results',
                    type: 'object',
                    properties: {
                        order_id: { type: 'string' },
                        risk_score: { type: 'number', minimum: 0, maximum: 100 },
                        action: { type: 'string', enum: ['approve', 'hold', 'block'] },
                        tags: { type: 'array', items: { type: 'string' } },
                        reason_codes: { type: 'array', items: { type: 'string' } },
                        customer_dedupe: {
                            type: 'object',
                            properties: {
                                // FIX: Define the schema for the items in the matches array
                                matches: { type: 'array', items: customerMatchSchema },
                                suggested_action: { type: 'string' },
                                canonical_id: { type: 'string', nullable: true }
                            }
                        },
                        address_dedupe: {
                            type: 'object',
                            properties: {
                                // FIX: Define the schema for the items in the matches array
                                matches: { type: 'array', items: addressMatchSchema },
                                suggested_action: { type: 'string' },
                                canonical_id: { type: 'string', nullable: true }
                            }
                        },
                        validations: {
                            type: 'object',
                            properties: {
                                email: { type: 'object', properties: { valid: { type: 'boolean' }, reason_codes: { type: 'array', items: { type: 'string' } }, disposable: { type: 'boolean' } } },
                                phone: { type: 'object', properties: { valid: { type: 'boolean' }, reason_codes: { type: 'array', items: { type: 'string' } }, country: { type: 'string', nullable: true } } },
                                address: { type: 'object', properties: { valid: { type: 'boolean' }, reason_codes: { type: 'array', items: { type: 'string' } }, po_box: { type: 'boolean' }, postal_city_match: { type: 'boolean' }, in_bounds: { type: 'boolean' } } }
                            }
                        },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse
            }
        }
    }, async (request: FastifyRequest, rep: FastifyReply) => {
        const request_id = generateRequestId();
        try {
            const body = request.body as any;
            const project_id = (request as any).project_id;
            const reason_codes: string[] = [];
            const tags: string[] = [];
            let risk_score = 0;

            const { order_id, customer, shipping_address, total_amount, currency, payment_method } = body;

            const customer_matches: any[] = [];
            const seenIds = new Set<string>();
            if (customer) {
                const normEmail = customer.email ? customer.email.trim().toLowerCase() : null;
                const normPhone = customer.phone ? customer.phone.replaceAll(/[^\d+]/g, '') : null;
                const full_name = `${customer.first_name || ''} ${customer.last_name || ''}`.trim();

                // Exact email match
                if (normEmail) {
                    const { rows } = await pool.query(
                        `SELECT id, email, phone, first_name, last_name, 1.0 as similarity_score FROM customers WHERE project_id = $1 AND normalized_email = $2`,
                        [project_id, normEmail]
                    );
                    for (const row of rows) {
                        if (!seenIds.has(row.id)) {
                            // FINAL FIX: Manually build a new, plain object to ensure serialization.
                            customer_matches.push({
                                id: row.id,
                                email: row.email,
                                phone: row.phone,
                                first_name: row.first_name,
                                last_name: row.last_name,
                                similarity_score: 1,
                                match_type: MATCH_TYPES.EXACT_EMAIL
                            });
                            seenIds.add(row.id);
                        }
                    }
                }

                // Fuzzy name match
                if (full_name) {
                    const { rows } = await pool.query(
                        `SELECT id, email, phone, first_name, last_name,
                         similarity((first_name || ' ' || last_name), $2) as similarity_score
                         FROM customers
                         WHERE project_id = $1 AND similarity((first_name || ' ' || last_name), $2) > 0.85
                         ORDER BY similarity_score DESC LIMIT 5`,
                        [project_id, full_name]
                    );
                    for (const row of rows) {
                        if (!seenIds.has(row.id)) {
                            // FINAL FIX: Manually build a new, plain object to ensure serialization.
                            customer_matches.push({
                                id: row.id,
                                email: row.email,
                                phone: row.phone,
                                first_name: row.first_name,
                                last_name: row.last_name,
                                similarity_score: row.similarity_score,
                                match_type: MATCH_TYPES.FUZZY_NAME
                            });
                            seenIds.add(row.id);
                        }
                    }
                }
                customer_matches.sort((a, b) => b.similarity_score - a.similarity_score);
            }
            if (customer_matches.length > 0) {
                risk_score += RISK_CUSTOMER_DEDUPE;
                tags.push(ORDER_TAGS.POTENTIAL_DUPLICATE_CUSTOMER);
                reason_codes.push(REASON_CODES.ORDER_CUSTOMER_DEDUPE_MATCH);
            }

            // 2. Address dedupe
            let address_matches: any[] = [];
            const addressValidation = await validateAddress(shipping_address, pool, redis);
            const normAddr = addressValidation.normalized;
            const addrHash = crypto.createHash('sha256').update(JSON.stringify(normAddr)).digest('hex');

            const hashQuery = 'SELECT id, line1, line2, city, state, postal_code, country, lat, lng FROM addresses WHERE project_id = $1 AND address_hash = $2 LIMIT 1';
            const { rows: hashMatches } = await pool.query(hashQuery, [project_id, addrHash]);
            if (hashMatches.length > 0) {
                const row = hashMatches[0];
                // FINAL FIX: Manually build a new, plain object for addresses as well.
                address_matches.push({
                    id: row.id,
                    line1: row.line1,
                    city: row.city,
                    state: row.state,
                    postal_code: row.postal_code,
                    country: row.country,
                    similarity_score: 1,
                    match_type: MATCH_TYPES.EXACT_ADDRESS
                });
            } else {
                const postalQuery = 'SELECT id, line1, line2, city, state, postal_code, country, lat, lng, 1.0 as similarity_score, \'exact_postal\' as match_type FROM addresses WHERE project_id = $1 AND postal_code = $2 AND lower(city) = lower($3) AND country = $4 LIMIT 1';
                const { rows: postalMatches } = await pool.query(postalQuery, [project_id, normAddr.postal_code, normAddr.city, normAddr.country]);
                if (postalMatches.length > 0) {
                    address_matches.push({
                        id: postalMatches[0].id,
                        line1: postalMatches[0].line1,
                        line2: postalMatches[0].line2,
                        city: postalMatches[0].city,
                        state: postalMatches[0].state,
                        postal_code: postalMatches[0].postal_code,
                        country: postalMatches[0].country,
                        lat: postalMatches[0].lat,
                        lng: postalMatches[0].lng,
                        similarity_score: SIMILARITY_EXACT,
                        match_type: MATCH_TYPES.EXACT_POSTAL
                    });
                }

                const fuzzyQuery = `SELECT id, line1, line2, city, state, postal_code, country, lat, lng,
                                    greatest(similarity(line1, $2), similarity(city, $3)) as similarity_score,
                                    'fuzzy_address' as match_type
                                    FROM addresses
                                    WHERE project_id = $1 AND (similarity(line1, $2) > 0.85 OR similarity(city, $3) > 0.85)
                                    ORDER BY similarity_score DESC LIMIT 3`;
                const { rows: fuzzyMatches } = await pool.query(fuzzyQuery, [project_id, normAddr.line1, normAddr.city]);
                address_matches = address_matches.concat(
                    fuzzyMatches
                        .filter(m => !address_matches.some(am => am.id === m.id))
                        .map(row => ({
                            id: row.id,
                            line1: row.line1,
                            line2: row.line2,
                            city: row.city,
                            state: row.state,
                            postal_code: row.postal_code,
                            country: row.country,
                            lat: row.lat,
                            lng: row.lng,
                            similarity_score: row.similarity_score,
                            match_type: MATCH_TYPES.FUZZY_ADDRESS
                        })) // Ensure all fuzzy matches are also clean objects
                );
            }

            // LOGGING: Log the results of the address deduplication
            app.log.info({ request_id, address_matches }, "Address dedupe matches found");

            if (address_matches.length > 0) {
                risk_score += RISK_ADDRESS_DEDUPE;
                tags.push(ORDER_TAGS.POTENTIAL_DUPLICATE_ADDRESS);
                reason_codes.push(REASON_CODES.ORDER_ADDRESS_DEDUPE_MATCH);
            }

            // 3. Full address validation
            const { po_box, postal_city_match, in_bounds, geo, reason_codes: addrReasons, valid } = addressValidation;
            reason_codes.push(...addrReasons);
            if (po_box) {
                risk_score += RISK_PO_BOX;
                tags.push(ORDER_TAGS.PO_BOX_DETECTED);
                reason_codes.push(REASON_CODES.ORDER_PO_BOX_BLOCK);
            }
            if (!postal_city_match) {
                risk_score += RISK_POSTAL_MISMATCH;
                reason_codes.push(REASON_CODES.ORDER_ADDRESS_MISMATCH);
            }
            if (geo && !in_bounds) {
                risk_score += RISK_GEO_OUT;
                tags.push(ORDER_TAGS.VIRTUAL_ADDRESS);
                reason_codes.push(REASON_CODES.ORDER_GEO_OUT_OF_BOUNDS);
            }
            if (!geo) {
                risk_score += RISK_GEOCODE_FAIL;
                reason_codes.push(REASON_CODES.ORDER_GEOCODE_FAILED);
            }
            if (!valid) {
                risk_score += RISK_INVALID_ADDR;
                tags.push(ORDER_TAGS.INVALID_ADDRESS);
                reason_codes.push(REASON_CODES.ORDER_INVALID_ADDRESS);
            }

            // 4. Full customer validation
            let email_valid = { valid: true, reason_codes: [] as string[], disposable: false };
            let phone_valid = { valid: true, reason_codes: [] as string[], country: null as string | null };
            if (customer.email) {
                const emailValue = await validateEmail(customer.email, redis);
                email_valid = { valid: emailValue.valid, reason_codes: emailValue.reason_codes, disposable: emailValue.disposable };
                reason_codes.push(...emailValue.reason_codes);
                if (!emailValue.valid || emailValue.disposable) {
                    risk_score += RISK_INVALID_EMAIL_PHONE;
                    if (emailValue.disposable) {
                        tags.push(ORDER_TAGS.DISPOSABLE_EMAIL);
                        reason_codes.push(REASON_CODES.ORDER_DISPOSABLE_EMAIL);
                    }
                }
            }
            if (customer.phone) {
                const phoneValue = await validatePhone(customer.phone, undefined, redis);
                phone_valid = { valid: phoneValue.valid, reason_codes: phoneValue.reason_codes, country: phoneValue.country };
                reason_codes.push(...phoneValue.reason_codes);
                if (!phoneValue.valid) {
                    risk_score += RISK_INVALID_EMAIL_PHONE;
                    reason_codes.push(REASON_CODES.ORDER_INVALID_PHONE);
                }
            }

            // 5. Order dedupe (exact order_id)
            const { rows: orderMatch } = await pool.query(
                'SELECT id FROM orders WHERE project_id = $1 AND order_id = $2',
                [project_id, order_id]
            );
            if (orderMatch.length > 0) {
                risk_score += 50;
                tags.push(ORDER_TAGS.DUPLICATE_ORDER);
                reason_codes.push(REASON_CODES.ORDER_DUPLICATE_DETECTED);
            }

            // 6. Business rules and heuristics
            if (payment_method === PAYMENT_METHODS.COD) {
                risk_score += RISK_COD;
                tags.push(ORDER_TAGS.COD_ORDER);
                reason_codes.push(REASON_CODES.ORDER_COD_RISK);
                // Full COD/RTO heuristic: new customer + COD + mismatch region + throwaway email
                const isNewCustomer = customer_matches.length === 0;
                const hasMismatch = !postal_city_match || (phone_valid.country && phone_valid.country !== normAddr.country);
                const isThrowaway = email_valid.disposable;
                if (isNewCustomer && hasMismatch && isThrowaway) {
                    risk_score += RISK_COD_HIGH;
                    tags.push(ORDER_TAGS.HIGH_RISK_RTO);
                    reason_codes.push(REASON_CODES.ORDER_HIGH_RISK_RTO);
                }
            }

            if (total_amount > HIGH_VALUE_THRESHOLD) {
                risk_score += RISK_HIGH_VALUE;
                tags.push(ORDER_TAGS.HIGH_VALUE_ORDER);
                reason_codes.push(REASON_CODES.ORDER_HIGH_VALUE);
            }

            // 7. Determine action
            let action: 'approve' | 'hold' | 'block' = ORDER_ACTIONS.APPROVE;
            if (risk_score > RISK_BLOCK_THRESHOLD) {
                action = ORDER_ACTIONS.BLOCK;
            } else if (risk_score > RISK_HOLD_THRESHOLD) {
                action = ORDER_ACTIONS.HOLD;
            }

            const validations = {
                email: email_valid,
                phone: phone_valid,
                address: {
                    valid: addressValidation.valid,
                    reason_codes: addressValidation.reason_codes,
                    po_box,
                    postal_city_match,
                    in_bounds
                }
            };

            const response = {
                order_id,
                risk_score: Math.min(risk_score, 100),
                action,
                tags,
                reason_codes,
                customer_dedupe: { matches: customer_matches, suggested_action: customer_matches.length > 0 ? (customer_matches[0].similarity_score === SIMILARITY_EXACT ? DEDUPE_ACTIONS.MERGE_WITH : DEDUPE_ACTIONS.REVIEW) : DEDUPE_ACTIONS.CREATE_NEW, canonical_id: customer_matches.length > 0 ? customer_matches[0].id : null },
                address_dedupe: { matches: address_matches, suggested_action: address_matches.length > 0 ? (address_matches[0].similarity_score === SIMILARITY_EXACT ? DEDUPE_ACTIONS.MERGE_WITH : DEDUPE_ACTIONS.REVIEW) : DEDUPE_ACTIONS.CREATE_NEW, canonical_id: address_matches.length > 0 ? address_matches[0].id : null },
                validations,
                request_id
            };

            // Log the order for dedupe (insert if new)
            await pool.query(
                'INSERT INTO orders (project_id, order_id, customer_email, customer_phone, shipping_address, total_amount, currency, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (order_id) DO NOTHING',
                [project_id, order_id, customer.email, customer.phone, shipping_address, total_amount, currency, action]
            );

            await (rep as any).saveIdem?.(response);
            await logEvent(project_id, 'order', '/orders/evaluate', reason_codes, HTTP_STATUS.OK, { risk_score, action, tags: tags.join(',') }, pool);
            return rep.send(response);
        } catch (error) {
            app.log.error({ err: error, request_id }, "An unhandled error occurred in /v1/orders/evaluate");
            return sendServerError(request, rep, error, '/v1/orders/evaluate', request_id);
        }
    });
}