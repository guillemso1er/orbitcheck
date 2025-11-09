import { MGMT_V1_ROUTES } from "@orbitcheck/contracts";
import { errorCodes, type FastifyReply, type FastifyRequest } from "fastify";
import type { Redis as IORedisType } from "ioredis";
import type { Pool } from "pg";
import type { DeleteCustomRuleData, GetAvailableRulesResponses, GetErrorCodeCatalogResponses, RegisterCustomRulesData, TestRulesAgainstPayloadData } from "../generated/fastify/types.gen.js";
import { getBuiltInRules } from "../routes/rules/rules.constants.js";
import { handleDeleteCustomRule, handleRegisterCustomRules, handleTestRules } from "../routes/rules/rules.handlers.js";
import { generateRequestId, sendServerError } from "../routes/utils.js";

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
    _request: FastifyRequest,
    rep: FastifyReply
): Promise<FastifyReply> {
    const request_id = generateRequestId();

    const errorCodeCatalog = [
        {
            code: "validation_error",
            description: "Input validation failed",
            category: "VALIDATION"
        },
        {
            code: "authentication_error",
            description: "Authentication failed",
            category: "AUTH"
        },
        {
            code: "rate_limit_exceeded",
            description: "Rate limit exceeded",
            category: "RATE_LIMIT"
        },
        {
            code: "server_error",
            description: "Internal server error",
            category: "SERVER"
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
        return rep.send({ error_codes: errorCodes, request_id });
    } catch (error) {
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.GET_ERROR_CODE_CATALOG, generateRequestId());
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
