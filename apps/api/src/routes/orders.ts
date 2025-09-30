import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Pool } from "pg";
import type { Redis } from "ioredis";
import crypto from "crypto";
import { validateEmail } from "../validators/email";
import { validatePhone } from "../validators/phone";
import { validateAddress } from "../validators/address";
import { logEvent } from "../hooks";
import { securityHeader, unauthorizedResponse, rateLimitResponse, validationErrorResponse, generateRequestId, sendServerError } from "./utils";

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
                                matches: { type: 'array', items: { type: 'object' } },
                                suggested_action: { type: 'string' },
                                canonical_id: { type: 'string', nullable: true }
                            }
                        },
                        address_dedupe: {
                            type: 'object',
                            properties: {
                                matches: { type: 'array', items: { type: 'object' } },
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
    }, async (req: FastifyRequest, rep: FastifyReply) => {
        try {
            const request_id = generateRequestId();
            const body = req.body as any;
            const project_id = (req as any).project_id;
            const reason_codes: string[] = [];
            const tags: string[] = [];
            let risk_score = 0;

            const { order_id, customer, shipping_address, total_amount, currency, payment_method } = body;

            // 1. Customer dedupe using normalized fields and fuzzy name >0.85
            let customer_matches: any[] = [];
            const seenIds = new Set<string>();
            if (customer) {
                const normEmail = customer.email ? customer.email.trim().toLowerCase() : null;
                const normPhone = customer.phone ? customer.phone.replace(/[^0-9+]/g, '') : null;
                const full_name = `${customer.first_name || ''} ${customer.last_name || ''}`.trim();

                // Exact email match
                if (normEmail) {
                    const { rows } = await pool.query(
                        'SELECT id, email, phone, first_name, last_name FROM customers WHERE project_id = $1 AND normalized_email = $2',
                        [project_id, normEmail]
                    );
                    rows.forEach(row => {
                        if (!seenIds.has(row.id)) {
                            customer_matches.push({
                                ...row,
                                similarity_score: 1.0,
                                match_type: 'exact_email'
                            });
                            seenIds.add(row.id);
                        }
                    });
                }

                // Exact phone match
                if (normPhone) {
                    const { rows } = await pool.query(
                        'SELECT id, email, phone, first_name, last_name FROM customers WHERE project_id = $1 AND normalized_phone = $2',
                        [project_id, normPhone]
                    );
                    rows.forEach(row => {
                        if (!seenIds.has(row.id)) {
                            customer_matches.push({
                                ...row,
                                similarity_score: 1.0,
                                match_type: 'exact_phone'
                            });
                            seenIds.add(row.id);
                        }
                    });
                }

                // Fuzzy name match
                if (full_name) {
                    const { rows } = await pool.query(
                        `SELECT id, email, phone, first_name, last_name,
                         similarity((first_name || ' ' || last_name), $2) as name_score
                         FROM customers
                         WHERE project_id = $1
                         AND similarity((first_name || ' ' || last_name), $2) > 0.85
                         ORDER BY name_score DESC LIMIT 5`,
                        [project_id, full_name]
                    );
                    rows.forEach(row => {
                        if (!seenIds.has(row.id)) {
                            customer_matches.push({
                                ...row,
                                similarity_score: row.name_score,
                                match_type: 'fuzzy_name'
                            });
                            seenIds.add(row.id);
                        }
                    });
                }

                // Sort by score descending
                customer_matches.sort((a, b) => b.similarity_score - a.similarity_score);
            }
            if (customer_matches.length > 0) {
                risk_score += 20;
                tags.push('potential_duplicate_customer');
                reason_codes.push('order.customer_dedupe_match');
            }

            // 2. Address dedupe using hash and fuzzy >0.85
            let address_matches: any[] = [];
            const addressValidation = await validateAddress(shipping_address, pool, redis);
            const normAddr = addressValidation.normalized;
            const addrHash = crypto.createHash('sha256').update(JSON.stringify(normAddr)).digest('hex');

            // Simplified query for dedupe - use separate queries for clarity
            const hashQuery = 'SELECT id, line1, line2, city, state, postal_code, country, lat, lng, 1.0 as similarity_score, \'exact_address\' as match_type FROM addresses WHERE project_id = $1 AND address_hash = $2 LIMIT 1';
            const { rows: hashMatches } = await pool.query(hashQuery, [project_id, addrHash]);
            if (hashMatches.length > 0) {
                address_matches.push(hashMatches[0]);
            } else {
                const postalQuery = 'SELECT id, line1, line2, city, state, postal_code, country, lat, lng, 1.0 as similarity_score, \'exact_postal\' as match_type FROM addresses WHERE project_id = $1 AND postal_code = $2 AND lower(city) = lower($3) AND country = $4 LIMIT 1';
                const { rows: postalMatches } = await pool.query(postalQuery, [project_id, normAddr.postal_code, normAddr.city, normAddr.country]);
                if (postalMatches.length > 0) {
                    address_matches.push(postalMatches[0]);
                }
                // Fuzzy
                const fuzzyQuery = 'SELECT id, line1, line2, city, state, postal_code, country, lat, lng, greatest(similarity(line1, $3), similarity(city, $4)) as similarity_score, \'fuzzy_address\' as match_type FROM addresses WHERE project_id = $1 AND (similarity(line1, $3) > 0.85 OR similarity(city, $4) > 0.85) ORDER BY similarity_score DESC LIMIT 3';
                const { rows: fuzzyMatches } = await pool.query(fuzzyQuery, [project_id, normAddr.line1, normAddr.city]);
                address_matches = address_matches.concat(fuzzyMatches.filter(m => !address_matches.some(am => am.id === m.id)));
            }

            if (address_matches.length > 0) {
                risk_score += 15;
                tags.push('potential_duplicate_address');
                reason_codes.push('order.address_dedupe_match');
            }

            // 3. Full address validation
            const { po_box, postal_city_match, in_bounds, geo, reason_codes: addrReasons, valid } = addressValidation;
            reason_codes.push(...addrReasons);
            if (po_box) {
                risk_score += 30;
                tags.push('po_box_detected');
                reason_codes.push('order.po_box_block');
            }
            if (!postal_city_match) {
                risk_score += 10;
                reason_codes.push('order.address_mismatch');
            }
            if (geo && !in_bounds) {
                risk_score += 40;
                tags.push('virtual_address');
                reason_codes.push('order.geo_out_of_bounds');
            }
            if (!geo) {
                risk_score += 20;
                reason_codes.push('order.geocode_failed');
            }
            if (!valid) {
                risk_score += 30;
                tags.push('invalid_address');
                reason_codes.push('order.invalid_address');
            }

            // 4. Full customer validation
            let email_valid = { valid: true, reason_codes: [] as string[], disposable: false };
            let phone_valid = { valid: true, reason_codes: [] as string[], country: null as string | null };
            if (customer.email) {
                const emailVal = await validateEmail(customer.email, redis);
                email_valid = { valid: emailVal.valid, reason_codes: emailVal.reason_codes, disposable: emailVal.disposable };
                reason_codes.push(...emailVal.reason_codes);
                if (!emailVal.valid || emailVal.disposable) {
                    risk_score += 25;
                    if (emailVal.disposable) {
                        tags.push('disposable_email');
                        reason_codes.push('order.disposable_email');
                    }
                }
            }
            if (customer.phone) {
                const phoneVal = await validatePhone(customer.phone, undefined, redis);
                phone_valid = { valid: phoneVal.valid, reason_codes: phoneVal.reason_codes, country: phoneVal.country };
                reason_codes.push(...phoneVal.reason_codes);
                if (!phoneVal.valid) {
                    risk_score += 25;
                    reason_codes.push('order.invalid_phone');
                }
            }

            // 5. Order dedupe (exact order_id)
            const { rows: orderMatch } = await pool.query(
                'SELECT id FROM orders WHERE project_id = $1 AND order_id = $2',
                [project_id, order_id]
            );
            if (orderMatch.length > 0) {
                risk_score += 50;
                tags.push('duplicate_order');
                reason_codes.push('order.duplicate_detected');
            }

            // 6. Business rules and heuristics
            if (payment_method === 'cod') {
                risk_score += 20;
                tags.push('cod_order');
                reason_codes.push('order.cod_risk');
                // Full COD/RTO heuristic: new customer + COD + mismatch region + throwaway email
                const isNewCustomer = customer_matches.length === 0;
                const hasMismatch = !postal_city_match || (phone_valid.country && phone_valid.country !== normAddr.country);
                const isThrowaway = email_valid.disposable;
                if (isNewCustomer && hasMismatch && isThrowaway) {
                    risk_score += 50;
                    tags.push('high_risk_rto');
                    reason_codes.push('order.high_risk_rto');
                }
            }

            if (total_amount > 1000) {
                risk_score += 15;
                tags.push('high_value_order');
                reason_codes.push('order.high_value');
            }

            // 7. Determine action
            let action = 'approve';
            if (risk_score > 70) {
                action = 'block';
            } else if (risk_score > 40) {
                action = 'hold';
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
                customer_dedupe: { matches: customer_matches, suggested_action: customer_matches.length > 0 ? (customer_matches[0].similarity_score === 1.0 ? 'merge_with' : 'review') : 'create_new', canonical_id: customer_matches.length > 0 ? customer_matches[0].id : null },
                address_dedupe: { matches: address_matches, suggested_action: address_matches.length > 0 ? (address_matches[0].similarity_score === 1.0 ? 'merge_with' : 'review') : 'create_new', canonical_id: address_matches.length > 0 ? address_matches[0].id : null },
                validations,
                request_id
            };

            // Log the order for dedupe (insert if new)
            await pool.query(
                'INSERT INTO orders (project_id, order_id, customer_email, customer_phone, shipping_address, total_amount, currency, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (order_id) DO NOTHING',
                [project_id, order_id, customer.email, customer.phone, shipping_address, total_amount, currency, action]
            );

            await (rep as any).saveIdem?.(response);
            await logEvent(project_id, 'order', '/orders/evaluate', reason_codes, 200, { risk_score, action, tags: tags.join(',') }, pool);
            return rep.send(response);
        } catch (error) {
            return sendServerError(req, rep, error, '/v1/orders/evaluate', generateRequestId());
        }
    });
}