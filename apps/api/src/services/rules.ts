import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { MGMT_V1_ROUTES } from "@orbitcheck/contracts";
import type { DeleteCustomRuleData, DeleteCustomRuleResponses, GetAvailableRulesResponses, GetErrorCodeCatalogResponses, GetReasonCodeCatalogResponses, RegisterCustomRulesData, RegisterCustomRulesResponses, TestRulesAgainstPayloadData, TestRulesAgainstPayloadResponses } from "../generated/fastify/types.gen.js";
import { ERROR_CODES } from "../errors.js";
import { getBuiltInRules } from "../routes/rules/rules.constants.js";
import { RuleEvaluator } from "../routes/rules/test-rules.js";
import { generateRequestId, sendServerError, sendError } from "../routes/utils.js";

export async function getAvailableRules(
    request: FastifyRequest,
    rep: FastifyReply
): Promise<FastifyReply> {
    const request_id = generateRequestId();
    const builtInRules = getBuiltInRules();
    
    const response: GetAvailableRulesResponses[200] = {
        rules: builtInRules,
        request_id
    };
    return rep.send(response);
}

export async function getErrorCodeCatalog(
    request: FastifyRequest,
    rep: FastifyReply
): Promise<FastifyReply> {
    const request_id = generateRequestId();
    
    const errorCodeCatalog = {
        "validation_error": {
            message: "Input validation failed",
            category: "VALIDATION"
        },
        "authentication_error": {
            message: "Authentication failed",
            category: "AUTH"
        },
        "rate_limit_exceeded": {
            message: "Rate limit exceeded",
            category: "RATE_LIMIT"
        },
        "server_error": {
            message: "Internal server error",
            category: "SERVER"
        }
    };
    
    const response: GetErrorCodeCatalogResponses[200] = {
        error_codes: errorCodeCatalog,
        request_id
    };
    return rep.send(response);
}

export async function getReasonCodeCatalog(
    request: FastifyRequest,
    rep: FastifyReply
): Promise<FastifyReply> {
    const request_id = generateRequestId();
    
    const reasonCodeCatalog = {
        "email.invalid_format": {
            message: "Email format is invalid",
            category: "EMAIL"
        },
        "email.disposable": {
            message: "Email is from a disposable provider",
            category: "EMAIL"
        },
        "phone.invalid_format": {
            message: "Phone number format is invalid",
            category: "PHONE"
        },
        "address.po_box": {
            message: "Address is a P.O. Box",
            category: "ADDRESS"
        },
        "address.invalid": {
            message: "Address could not be validated",
            category: "ADDRESS"
        },
        "order.high_value": {
            message: "Order value exceeds threshold",
            category: "ORDER"
        },
        "customer.suspicious": {
            message: "Customer profile appears suspicious",
            category: "CUSTOMER"
        }
    };
    
    const response: GetReasonCodeCatalogResponses[200] = {
        reason_codes: reasonCodeCatalog,
        request_id
    };
    return rep.send(response);
}

export async function testRulesAgainstPayload(
    request: FastifyRequest<{ Body: TestRulesAgainstPayloadData['body'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    try {
        const request_id = generateRequestId();
        const body = request.body as TestRulesAgainstPayloadData['body'];
        const { payload, rule_ids } = body;
        
        // Get custom rules from database
        let customRules = [];
        if (rule_ids && rule_ids.length > 0) {
            const { rows } = await pool.query(
                "SELECT id, name, conditions, actions FROM custom_rules WHERE id = ANY($1)",
                [rule_ids]
            );
            customRules = rows;
        }
        
        // Combine built-in and custom rules
        const allRules = [...getBuiltInRules(), ...customRules];
        
        // Evaluate rules
        const evaluator = new RuleEvaluator(allRules);
        const evaluation = await evaluator.evaluate(payload);
        
        const response: TestRulesAgainstPayloadResponses[200] = {
            triggered_rules: evaluation.triggeredRules,
            final_decision: evaluation.finalDecision,
            request_id
        };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.TEST_RULES_AGAINST_PAYLOAD, generateRequestId());
    }
}

export async function registerCustomRules(
    request: FastifyRequest<{ Body: RegisterCustomRulesData['body'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    try {
        const request_id = generateRequestId();
        const body = request.body as RegisterCustomRulesData['body'];
        const { rules } = body;
        const project_id = (request as any).project_id!;
        
        const registeredRules = [];
        
        for (const rule of rules) {
            // Validate rule structure
            if (!rule.name || !rule.conditions || !rule.actions) {
                return sendError(rep, 400, ERROR_CODES.INVALID_INPUT, 'Rule must have name, conditions, and actions', request_id);
            }
            
            const { rows } = await pool.query(
                "INSERT INTO custom_rules (project_id, name, description, conditions, actions, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, description, conditions, actions, status, created_at",
                [project_id, rule.name, rule.description || null, JSON.stringify(rule.conditions), JSON.stringify(rule.actions), rule.status || 'active']
            );
            
            registeredRules.push(rows[0]);
        }
        
        const response: RegisterCustomRulesResponses[201] = {
            rules: registeredRules,
            count: registeredRules.length,
            request_id
        };
        return rep.status(201).send(response);
    } catch (error) {
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.REGISTER_CUSTOM_RULES, generateRequestId());
    }
}

export async function deleteCustomRule(
    request: FastifyRequest<{ Params: DeleteCustomRuleData['path'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    try {
        const request_id = generateRequestId();
        const { id } = request.params as DeleteCustomRuleData['path'];
        const project_id = (request as any).project_id!;
        
        const { rowCount } = await pool.query(
            "DELETE FROM custom_rules WHERE id = $1 AND project_id = $2",
            [id, project_id]
        );
        
        if (rowCount === 0) {
            return sendError(rep, 404, ERROR_CODES.NOT_FOUND, 'Custom rule not found', request_id);
        }
        
        const response: DeleteCustomRuleResponses[200] = {
            id,
            deleted: true,
            request_id
        };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.DELETE_CUSTOM_RULE, generateRequestId());
    }
}
