import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Pool } from "pg";
import crypto from "crypto";
import { normalizeAddress } from "../validators/address";
import { detectPoBox } from "../validators/address";
import { isEmailValid } from '@hapi/address';
import { parsePhoneNumber } from "libphonenumber-js";
import { logEvent } from "../hooks";

const errorSchema = {
    type: 'object',
    properties: {
        error: {
            type: 'object',
            properties: {
                code: { type: 'string' },
                message: { type: 'string' }
            }
        }
    }
};

const securityHeader = {
    type: 'object',
    properties: {
        'authorization': { type: 'string' },
        'idempotency-key': { type: 'string' }
    },
    required: ['authorization']
};

const unauthorizedResponse = { 401: { description: 'Unauthorized', ...errorSchema } };
const rateLimitResponse = { 429: { description: 'Rate Limit Exceeded', ...errorSchema } };
const validationErrorResponse = { 400: { description: 'Validation Error', ...errorSchema } };

export function registerOrderRoutes(app: FastifyInstance, pool: Pool) {
    app.post('/v1/order/evaluate', {
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
                                suggested_action: { type: 'string' }
                            }
                        },
                        address_dedupe: {
                            type: 'object',
                            properties: {
                                matches: { type: 'array', items: { type: 'object' } },
                                suggested_action: { type: 'string' }
                            }
                        },
                        validations: {
                            type: 'object',
                            properties: {
                                email: { type: 'object', properties: { valid: { type: 'boolean' }, reason_codes: { type: 'array', items: { type: 'string' } } } },
                                phone: { type: 'object', properties: { valid: { type: 'boolean' }, reason_codes: { type: 'array', items: { type: 'string' } } } },
                                address: { type: 'object', properties: { valid: { type: 'boolean' }, reason_codes: { type: 'array', items: { type: 'string' } } } }
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
    }, async (req, rep) => {
        const body = req.body as any;
        const project_id = (req as any).project_id;
        const reason_codes: string[] = [];
        const tags: string[] = [];
        let risk_score = 0;
        const request_id = crypto.randomUUID();

        try {
            const { order_id, customer, shipping_address, total_amount, currency, payment_method } = body;

            // 1. Customer dedupe
            const customer_dedupe = customer ? await pool.query(
                'SELECT id, similarity_score, match_type FROM (SELECT id, 1.0 as similarity_score, \'exact_email\' as match_type FROM customers WHERE project_id = $1 AND email = $2 UNION ALL SELECT id, similarity_score, match_type FROM (SELECT id, similarity((first_name || \' \' || last_name), $3) as similarity_score, \'fuzzy_name\' as match_type FROM customers WHERE project_id = $1 AND similarity((first_name || \' \' || last_name), $3) > 0.3 ORDER BY similarity_score DESC LIMIT 3) f) c ORDER BY similarity_score DESC LIMIT 3',
                [project_id, customer.email, `${customer.first_name} ${customer.last_name}`]
            ) : { rows: [] };
            const customer_matches = customer_dedupe.rows;
            if (customer_matches.length > 0) {
                risk_score += 20;
                tags.push('potential_duplicate_customer');
                reason_codes.push('order.customer_dedupe_match');
            }

            // 2. Address dedupe and validation
            const address_dedupe = await pool.query(
                'SELECT id, similarity_score, match_type FROM (SELECT id, 1.0 as similarity_score, \'exact_postal\' as match_type FROM addresses WHERE project_id = $1 AND postal_code = $2 AND lower(city) = lower($3) AND country = $4 UNION ALL SELECT id, similarity((line1 || \' \' || city || \' \' || postal_code || \' \' || country), $5) as similarity_score, \'fuzzy_address\' as match_type FROM addresses WHERE project_id = $1 AND similarity((line1 || \' \' || city || \' \' || postal_code || \' \' || country), $5) > 0.6 ORDER BY similarity_score DESC LIMIT 3) a ORDER BY similarity_score DESC LIMIT 3',
                [project_id, shipping_address.postal_code, shipping_address.city, shipping_address.country, `${shipping_address.line1} ${shipping_address.city} ${shipping_address.postal_code} ${shipping_address.country}`]
            );
            const address_matches = address_dedupe.rows;
            if (address_matches.length > 0) {
                risk_score += 15;
                tags.push('potential_duplicate_address');
                reason_codes.push('order.address_dedupe_match');
            }

            // 3. Address validation
            const address_valid = await normalizeAddress(shipping_address);
            const po_box = detectPoBox(address_valid.line1) || detectPoBox(address_valid.line2);
            if (po_box) {
                risk_score += 30;
                tags.push('po_box_detected');
                reason_codes.push('order.po_box_block');
                reason_codes.push('order.hold_for_review');
            }

            const { rows: postalMatch } = await pool.query(
                "select 1 from geonames_postal where country_code=$1 and postal_code=$2 and (lower(place_name)=lower($3) or lower(admin_name1)=lower($3)) limit 1",
                [address_valid.country.toUpperCase(), address_valid.postal_code, address_valid.city]
            );
            const postal_city_match = postalMatch.length > 0;
            if (!postal_city_match) {
                risk_score += 10;
                reason_codes.push('order.address_mismatch');
            }

            // 4. Customer validation (email and phone)
            let email_valid = { valid: true, reason_codes: [] as string[] };
            if (customer.email) {
                // Simplified - in production, call the full validator
                const isFormatValid = isEmailValid(customer.email);
                if (!isFormatValid) {
                    email_valid = { valid: false, reason_codes: ['email.invalid_format'] };
                    risk_score += 25;
                    reason_codes.push('order.invalid_email');
                }
            }

            let phone_valid = { valid: true, reason_codes: [] as string[] };
            if (customer.phone) {
                const parsed = parsePhoneNumber(customer.phone);
                if (!parsed || !parsed.isValid()) {
                    phone_valid = { valid: false, reason_codes: ['phone.invalid_format'] };
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

            // 6. Business rules
            if (payment_method === 'cod') {
                risk_score += 20;
                tags.push('cod_order');
                reason_codes.push('order.cod_risk');
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

            const validations = { email: email_valid, phone: phone_valid, address: { valid: !po_box && postal_city_match, reason_codes: po_box ? ['address.po_box'] : (!postal_city_match ? ['address.postal_city_mismatch'] : []) } };

            const response = {
                order_id,
                risk_score: Math.min(risk_score, 100),
                action,
                tags,
                reason_codes,
                customer_dedupe: { matches: customer_matches, suggested_action: customer_matches.length > 0 ? (customer_matches[0].similarity_score === 1.0 ? 'merge_with' : 'review') : 'create_new' },
                address_dedupe: { matches: address_matches, suggested_action: address_matches.length > 0 ? (address_matches[0].similarity_score === 1.0 ? 'merge_with' : 'review') : 'create_new' },
                validations,
                request_id
            };

            // Log the order for dedupe (insert if new)
            await pool.query(
                'INSERT INTO orders (project_id, order_id, customer_email, customer_phone, shipping_address, total_amount, currency, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (order_id) DO NOTHING',
                [project_id, order_id, customer.email, customer.phone, shipping_address, total_amount, currency, action]
            );

            await (rep as any).saveIdem?.(response);
            await logEvent(project_id, 'order', '/order/evaluate', reason_codes, 200, { risk_score, action, tags: tags.join(',') }, pool);
            return rep.send(response);

        } catch (error) {
            req.log.error(error);
            reason_codes.push('order.server_error');
            const response = { order_id: body.order_id, risk_score: 0, action: 'hold', tags: [], reason_codes, customer_dedupe: { matches: [], suggested_action: 'create_new' }, address_dedupe: { matches: [], suggested_action: 'create_new' }, validations: { email: { valid: false, reason_codes: [] as string[] }, phone: { valid: false, reason_codes: [] as string[] }, address: { valid: false, reason_codes: [] as string[] } }, request_id };
            await logEvent(project_id, 'order', '/order/evaluate', reason_codes, 500, {}, pool);
            return rep.status(500).send(response);
        }
    });
}