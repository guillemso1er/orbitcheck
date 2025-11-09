import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type { Pool } from "pg";
import { API_V1_ROUTES } from "@orbitcheck/contracts";
import type { EvaluateOrderData, EvaluateOrderResponses } from "../generated/fastify/types.gen.js";
import { HTTP_STATUS } from "../errors.js";
import { dedupeAddress, dedupeCustomer } from "../dedupe.js";
import { logEvent } from "../hooks.js";
import { validateAddress } from "../validators/address.js";
import { validateEmail } from "../validators/email.js";
import { validatePhone } from "../validators/phone.js";
import { generateRequestId, sendServerError } from "../routes/utils.js";

function mapOrderToValidationPayload(body: any) {
    return {
        email: body.customer?.email,
        phone: body.customer?.phone,
        name: body.customer?.first_name && body.customer?.last_name
            ? `${body.customer.first_name} ${body.customer.last_name}`
            : undefined,
        address: body.shipping_address,
        transaction_amount: body.total_amount,
        currency: body.currency,
        payment_method: body.payment_method,
        session_id: body.session_id,
        metadata: {
            order_id: body.order_id,
            ...body.metadata
        }
    };
}

export async function evaluateOrderForRiskAndRules(
    request: FastifyRequest<{ Body: EvaluateOrderData['body'] }>,
    rep: FastifyReply,
    pool: Pool,
    redis: Redis
): Promise<FastifyReply> {
    try {
        const request_id = generateRequestId();
        const body = request.body as EvaluateOrderData['body'];
        const project_id = (request as any).project_id;
        
        // Basic validation and normalization
        const payload = mapOrderToValidationPayload(body);
        
        // Run validations in parallel
        const [emailValidation, phoneValidation, addressValidation, customerDedupe, addressDedupe] = await Promise.all([
            payload.email ? validateEmail(payload.email, redis) : { valid: false, reason_codes: ['email.missing'] },
            payload.phone ? validatePhone(payload.phone, undefined, redis) : { valid: false, reason_codes: ['phone.missing'] },
            payload.address ? validateAddress(payload.address, pool, redis) : { valid: false, reason_codes: ['address.missing'] },
            payload.email && payload.customer?.first_name && payload.customer?.last_name 
                ? dedupeCustomer({
                    email: payload.email,
                    first_name: payload.customer.first_name,
                    last_name: payload.customer.last_name,
                    phone: payload.phone
                }, project_id, pool)
                : { matches: [], suggested_action: 'create_new' },
            payload.address
                ? dedupeAddress(payload.address, project_id, pool)
                : { matches: [], suggested_action: 'create_new' }
        ]);

        // Simple risk calculation (can be enhanced with actual rules engine)
        let risk_score = 0;
        const reason_codes: string[] = [];
        
        // Add risk factors
        if (!emailValidation.valid) {
            risk_score += 20;
            reason_codes.push(...emailValidation.reason_codes);
        }
        
        if (!phoneValidation.valid) {
            risk_score += 15;
            reason_codes.push(...phoneValidation.reason_codes);
        }
        
        if (!addressValidation.valid) {
            risk_score += 25;
            reason_codes.push(...addressValidation.reason_codes);
        }
        
        if (addressValidation.po_box) {
            risk_score += 10;
            reason_codes.push('address.po_box');
        }
        
        // Determine action based on risk score
        let action: 'approve' | 'hold' | 'block' = 'approve';
        if (risk_score > 70) {
            action = 'block';
        } else if (risk_score > 40) {
            action = 'hold';
        }

        const response: EvaluateOrderResponses[200] = {
            order_id: body.order_id,
            risk_score,
            action,
            tags: [],
            reason_codes,
            customer_dedupe: customerDedupe,
            address_dedupe: addressDedupe,
            validations: {
                email: emailValidation,
                phone: phoneValidation,
                address: addressValidation
            },
            rules_evaluation: {
                triggered_rules: [],
                final_decision: {
                    action,
                    confidence: 1 - (risk_score / 100),
                    reasons: reason_codes,
                    risk_score,
                    risk_level: risk_score > 70 ? 'high' : risk_score > 40 ? 'medium' : 'low',
                    recommended_actions: [action]
                }
            },
            request_id
        };

        await logEvent(project_id, 'order_evaluation', API_V1_ROUTES.ORDERS.EVALUATE_ORDER_FOR_RISK_AND_RULES, reason_codes, HTTP_STATUS.OK, {
            order_id: body.order_id,
            risk_score,
            action
        }, pool);

        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, API_V1_ROUTES.ORDERS.EVALUATE_ORDER_FOR_RISK_AND_RULES, generateRequestId());
    }
}