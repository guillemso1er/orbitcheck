import { MGMT_V1_ROUTES } from "@orbitcheck/contracts";
import { type FastifyReply, type FastifyRequest } from "fastify";
import type { Redis as IORedisType } from "ioredis";
import type { Pool } from "pg";
import { DeleteCustomRuleData, GetAvailableRulesResponses, GetErrorCodeCatalogResponses, GetReasonCodeCatalogResponses, RegisterCustomRulesData, TestRulesAgainstPayloadData } from "../../generated/fastify/types.gen.js";
import { generateRequestId, sendServerError } from "../utils.js";
import { getBuiltInRules, reasonCodes } from "./rules.constants.js";
import { handleDeleteCustomRule, handleRegisterCustomRules, handleTestRules } from "./rules.handlers.js";

export async function getAvailableRules(
    request: FastifyRequest,
    rep: FastifyReply,
    pool?: Pool
): Promise<FastifyReply> {
    try {
        const request_id = generateRequestId();
        const project_id = (request as any).project_id;

        // Start with all built-in rules (including disabled ones for reference)
        const builtInRules = getBuiltInRules();

        // Optionally merge project custom rules from DB if pool and project_id are available
        let dbRules: any[] = [];
        if (pool && project_id) {
            const res = await pool.query(
                "SELECT id, name, description, logic as condition, severity, 'custom' as category, enabled FROM rules WHERE project_id = $1",
                [project_id]
            );
            dbRules = res.rows.map((rule: any) => ({ ...rule, condition: rule.condition || (rule as any).logic }));
        }

        const response: GetAvailableRulesResponses[200] = {
            rules: [...builtInRules, ...dbRules],
            request_id
        };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.GET_AVAILABLE_RULES, generateRequestId());
    }
}

export async function getErrorCodeCatalog(
    _request: FastifyRequest,
    rep: FastifyReply
): Promise<FastifyReply> {
    const request_id = generateRequestId();

    const errorCodeCatalog = [
        {
            code: "validation_error",
            description: "Input validation failed",
            category: "VALIDATION",
            severity: "high"
        },
        {
            code: "authentication_error",
            description: "Authentication failed",
            category: "AUTH",
            severity: "critical"
        },
        {
            code: "rate_limit_exceeded",
            description: "Rate limit exceeded",
            category: "RATE_LIMIT",
            severity: "medium"
        },
        {
            code: "server_error",
            description: "Internal server error",
            category: "SERVER",
            severity: "high"
        }
    ];

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
    try {
        const request_id = generateRequestId();
        const response: GetReasonCodeCatalogResponses[200] = { reason_codes: reasonCodes, request_id };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.GET_REASON_CODE_CATALOG, generateRequestId());
    }
}

export async function testRulesAgainstPayload(
    request: FastifyRequest<{ Body: TestRulesAgainstPayloadData['body'] }>,
    rep: FastifyReply,
    pool: Pool,
    redis: IORedisType
): Promise<FastifyReply> {
    try {
        return await handleTestRules(request, rep, pool, redis);
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
        try {
            return await handleRegisterCustomRules(request, rep, pool);
        } catch (error) {
            return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.REGISTER_CUSTOM_RULES, generateRequestId());
        }
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
        return await handleDeleteCustomRule(request, rep, pool);
    } catch (error) {
        return sendServerError(request, rep, error, `${MGMT_V1_ROUTES.RULES.REGISTER_CUSTOM_RULES}/:id`, generateRequestId());
    }
}
