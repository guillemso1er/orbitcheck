import crypto from "node:crypto";

import { API_V1_ROUTES } from "@orbicheck/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type { Pool } from "pg";

import { DEDUPE_ACTIONS, HIGH_VALUE_THRESHOLD, HTTP_STATUS, MATCH_TYPES, ORDER_ACTIONS, ORDER_TAGS, PAYMENT_METHODS, REASON_CODES, RISK_ADDRESS_DEDUPE, RISK_BLOCK_THRESHOLD, RISK_COD, RISK_COD_HIGH, RISK_CUSTOMER_DEDUPE, RISK_GEO_OUT, RISK_GEOCODE_FAIL, RISK_HIGH_VALUE, RISK_HOLD_THRESHOLD, RISK_INVALID_ADDR, RISK_INVALID_EMAIL_PHONE, RISK_PO_BOX, RISK_POSTAL_MISMATCH, SIMILARITY_EXACT } from "../constants.js";
import { dedupeAddress, dedupeCustomer } from "../dedupe.js";
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

export function registerOrderRoutes(app: FastifyInstance, pool: Pool, redis: Redis): void {
    app.post(API_V1_ROUTES.ORDERS.EVALUATE_ORDER_FOR_RISK_AND_RULES, {
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
                                matches: { type: 'array', items: customerMatchSchema },
                                suggested_action: { type: 'string' },
                                canonical_id: { type: 'string', nullable: true }
                            }
                        },
                        address_dedupe: {
                            type: 'object',
                            properties: {
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

            // FIX: Perform the duplicate order check *before* other logic and insertion.
            const { rows: orderMatch } = await pool.query(
                'SELECT id FROM orders WHERE project_id = $1 AND order_id = $2',
                [project_id, order_id]
            );
            if (orderMatch.length > 0) {
                risk_score += 50; // Or a specific constant for duplicate risk
                tags.push(ORDER_TAGS.DUPLICATE_ORDER);
                reason_codes.push(REASON_CODES.ORDER_DUPLICATE_DETECTED);
            }

            const customer_matches: any[] = [];
            if (customer) {
                const result = await dedupeCustomer(customer, project_id, pool);
                customer_matches.push(...result.matches.map(m => ({
                    id: m.id,
                    email: m.data.email,
                    phone: m.data.phone,
                    first_name: m.data.first_name,
                    last_name: m.data.last_name,
                    similarity_score: m.similarity_score,
                    match_type: m.match_type
                })));
            }
            if (customer_matches.length > 0) {
                risk_score += RISK_CUSTOMER_DEDUPE;
                tags.push(ORDER_TAGS.POTENTIAL_DUPLICATE_CUSTOMER);
                reason_codes.push(REASON_CODES.ORDER_CUSTOMER_DEDUPE_MATCH);
            }

            const addressValidation = await validateAddress({
                line1: shipping_address.line1!,
                line2: shipping_address.line2,
                city: shipping_address.city!,
                state: shipping_address.state,
                postal_code: shipping_address.postal_code!,
                country: shipping_address.country!
            }, pool, redis);
            const normAddr = addressValidation.normalized;
            const result = await dedupeAddress(shipping_address, project_id, pool);
            const address_matches = result.matches.map(m => ({
                id: m.id,
                line1: m.data.line1,
                line2: m.data.line2,
                city: m.data.city,
                state: m.data.state,
                postal_code: m.data.postal_code,
                country: m.data.country,
                lat: m.data.lat,
                lng: m.data.lng,
                similarity_score: m.similarity_score,
                match_type: m.match_type
            }));

            app.log.info({ request_id, address_matches }, "Address dedupe matches found");

            if (address_matches.length > 0) {
                risk_score += RISK_ADDRESS_DEDUPE;
                tags.push(ORDER_TAGS.POTENTIAL_DUPLICATE_ADDRESS);
                reason_codes.push(REASON_CODES.ORDER_ADDRESS_DEDUPE_MATCH);
            }

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

            if (payment_method === PAYMENT_METHODS.COD) {
                risk_score += RISK_COD;
                tags.push(ORDER_TAGS.COD_ORDER);
                reason_codes.push(REASON_CODES.ORDER_COD_RISK);
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

            let action: 'approve' | 'hold' | 'block' = ORDER_ACTIONS.APPROVE;
            if (risk_score >= RISK_BLOCK_THRESHOLD) {
                action = ORDER_ACTIONS.BLOCK;
            } else if (risk_score >= RISK_HOLD_THRESHOLD) {
                action = ORDER_ACTIONS.HOLD;
            }

            // FIX: Only insert the order if it wasn't already found.
            if (orderMatch.length === 0) {
                await pool.query(
                    'INSERT INTO orders (project_id, order_id, customer_email, customer_phone, shipping_address, total_amount, currency, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (order_id) DO NOTHING',
                    [project_id, order_id, customer.email, customer.phone, shipping_address, total_amount, currency, action]
                );
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

            const response: any = {
                order_id,
                risk_score: Math.min(risk_score, 100),
                action,
                tags,
                reason_codes: [...new Set(reason_codes)], // De-duplicate reason codes
                customer_dedupe: customer_matches.length > 0 ? { matches: customer_matches, suggested_action: customer_matches[0].similarity_score === SIMILARITY_EXACT ? DEDUPE_ACTIONS.MERGE_WITH : DEDUPE_ACTIONS.REVIEW, canonical_id: customer_matches[0].id } : { matches: [], suggested_action: DEDUPE_ACTIONS.CREATE_NEW, canonical_id: null },
                address_dedupe: address_matches.length > 0 ? { matches: address_matches, suggested_action: address_matches[0].similarity_score === SIMILARITY_EXACT ? DEDUPE_ACTIONS.MERGE_WITH : DEDUPE_ACTIONS.REVIEW, canonical_id: address_matches[0].id } : { matches: [], suggested_action: DEDUPE_ACTIONS.CREATE_NEW, canonical_id: null },
                validations,
                request_id
            };

            await logEvent(project_id, 'order', '/orders/evaluate', reason_codes, HTTP_STATUS.OK, { risk_score, action, tags: tags.join(',') }, pool);

            if ((rep as any).saveIdem) {
                await (rep as any).saveIdem(response);
            }
            return rep.send(response);
        } catch (error) {
            app.log.error({ err: error, request_id }, "An unhandled error occurred in /v1/orders/evaluate");
            return sendServerError(request, rep, error, API_V1_ROUTES.ORDERS.EVALUATE_ORDER_FOR_RISK_AND_RULES, request_id);
        }
    });
}