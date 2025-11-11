import { type FastifyReply, type FastifyRequest } from "fastify";
import type { Redis as IORedisType } from "ioredis";
import type { Pool } from "pg";
import { DeleteCustomRuleData, DeleteCustomRuleResponses, GetAvailableRulesResponses, GetBuiltInRulesResponses, GetErrorCodeCatalogResponses, GetReasonCodeCatalogResponses, RegisterCustomRulesData, RegisterCustomRulesResponses, TestRulesAgainstPayloadData, TestRulesAgainstPayloadResponses } from "../../generated/fastify/types.gen.js";
import { generateRequestId, sendServerError } from "../utils.js";
import { getBuiltInRules as getBuiltInRulesConstants, reasonCodes } from "./rules.constants.js";
import { handleDeleteCustomRule, handleRegisterCustomRules, handleTestRules } from "./rules.handlers.js";

export async function getBuiltInRules(
    request: FastifyRequest,
    rep: FastifyReply
): Promise<FastifyReply<{ Body: GetBuiltInRulesResponses }>> {
    try {
        const request_id = generateRequestId();
        
        // Return only built-in rules
        const builtInRules = getBuiltInRulesConstants();

        const response = {
            rules: builtInRules,
            request_id
        };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, "/v1/rules/builtin", generateRequestId());
    }
}

export async function getAvailableRules(
    request: FastifyRequest,
    rep: FastifyReply,
    pool?: Pool
): Promise<FastifyReply<{ Body: GetAvailableRulesResponses }>> {
    try {
        const request_id = generateRequestId();
        const project_id = (request as any).project_id;

        // Only return custom rules from database, not built-in rules
        let dbRules: any[] = [];
        if (pool && project_id) {
            const res = await pool.query(
                "SELECT id, name, description, logic as condition, action, priority, severity, 'custom' as category, enabled, created_at FROM rules WHERE project_id = $1",
                [project_id]
            );
            dbRules = res.rows.map((rule: any) => ({
                ...rule,
                condition: rule.condition || (rule as any).logic,
                createdAt: rule.created_at || new Date().toISOString(),
                updatedAt: new Date().toISOString() // Use current time since updated_at doesn't exist
            }));
        }

        const response: GetAvailableRulesResponses[200] = {
            rules: dbRules,
            request_id
        };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, '/v1/rules', generateRequestId());
    }
}

export async function getErrorCodeCatalog(
    _request: FastifyRequest,
    rep: FastifyReply
): Promise<FastifyReply<{ Body: GetErrorCodeCatalogResponses }>> {
    const request_id = generateRequestId();

    const errorCodeCatalog = [
        {
            code: "validation_error",
            description: "Input validation failed",
            category: "VALIDATION",
            severity: "high" as const
        },
        {
            code: "authentication_error",
            description: "Authentication failed",
            category: "AUTH",
            severity: "critical" as const
        },
        {
            code: "rate_limit_exceeded",
            description: "Rate limit exceeded",
            category: "RATE_LIMIT",
            severity: "medium" as const
        },
        {
            code: "server_error",
            description: "Internal server error",
            category: "SERVER",
            severity: "high" as const
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
): Promise<FastifyReply<{ Body: GetReasonCodeCatalogResponses }>> {
    try {
        const request_id = generateRequestId();
        const response: GetReasonCodeCatalogResponses[200] = { reason_codes: reasonCodes, request_id };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, '/v1/rules/catalog', generateRequestId());
    }
}

export async function testRulesAgainstPayload(
    request: FastifyRequest<{ Body: TestRulesAgainstPayloadData['body'] }>,
    rep: FastifyReply,
    pool: Pool,
    redis: IORedisType
): Promise<FastifyReply<{ Body: TestRulesAgainstPayloadResponses }>> {
    try {
        return await handleTestRules(request, rep, pool, redis);
    } catch (error) {
        return sendServerError(request, rep, error, '/v1/rules/test', generateRequestId());

    }
}

export async function registerCustomRules(
    request: FastifyRequest<{ Body: RegisterCustomRulesData['body'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply<{ Body: RegisterCustomRulesResponses }>> {
    try {
        return await handleRegisterCustomRules(request, rep, pool);
    } catch (error) {
        return sendServerError(request, rep, error, '/v1/rules/register', generateRequestId());
    }
}

export async function deleteCustomRule(
    request: FastifyRequest<{ Params: DeleteCustomRuleData['path'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply<{ Body: DeleteCustomRuleResponses }>> {
    try {
        return await handleDeleteCustomRule(request, rep, pool);
    } catch (error) {
        return sendServerError(request, rep, error, `/v1/rules/:id`, generateRequestId());
    }
}
