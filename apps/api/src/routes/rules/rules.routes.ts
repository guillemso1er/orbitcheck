// FILE: rules.routes.ts

import { MGMT_V1_ROUTES } from "@orbitcheck/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { generateRequestId, MGMT_V1_SECURITY, securityHeader, sendServerError } from "../utils.js";
import { errorCodes, getBuiltInRules, reasonCodes, TestPayloadJsonSchema } from "./rules.constants.js";
import { handleDeleteCustomRule, handleRegisterCustomRules, handleTestRules } from "./rules.handlers.js";

/**
 * Registers all routes related to rules management and evaluation.
 */
export function registerRulesRoutes(app: FastifyInstance, pool: Pool, redis?: any): void {
    app.get(MGMT_V1_ROUTES.RULES.GET_AVAILABLE_RULES, {
        schema: {
            summary: 'Get Available Rules', description: 'Returns a list of all available validation and risk assessment rules.', tags: ['Rules'], headers: securityHeader, security: MGMT_V1_SECURITY,
            response: { 200: { description: 'List of rules', type: 'object', properties: { rules: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, category: { type: 'string' }, enabled: { type: 'boolean' } } } }, request_id: { type: 'string' } } } },
        },
    }, async (request: FastifyRequest, rep: FastifyReply) => {
        try {
            const request_id = generateRequestId();
            const dbRules = await pool.query("SELECT id, name, description, logic as condition, severity, 'custom' as category, enabled FROM rules WHERE project_id = $1", [(request as any).project_id]);
            const builtInRules = getBuiltInRules().filter(rule => rule.enabled);
            const allRules = [...builtInRules, ...dbRules.rows.map(rule => ({ ...rule, condition: rule.condition || rule.logic }))];
            return rep.send({ rules: allRules, request_id });
        } catch (error) {
            return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.GET_AVAILABLE_RULES, generateRequestId());
        }
    });

    app.get(MGMT_V1_ROUTES.RULES.GET_REASON_CODE_CATALOG, {
        schema: {
            summary: 'Get Reason Code Catalog', description: 'Returns a comprehensive list of all possible reason codes with descriptions and severity levels.', tags: ['Rules'], headers: securityHeader, security: MGMT_V1_SECURITY,
            response: { 200: { description: 'List of reason codes', type: 'object', properties: { reason_codes: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, description: { type: 'string' }, category: { type: 'string' }, severity: { type: 'string', enum: ['low', 'medium', 'high'] } } } }, request_id: { type: 'string' } } } },
        },
    }, async (request: FastifyRequest, rep: FastifyReply) => {
        try {
            const request_id = generateRequestId();
            return rep.send({ reason_codes: reasonCodes, request_id });
        } catch (error) {
            return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.GET_REASON_CODE_CATALOG, generateRequestId());
        }
    });

    app.get(MGMT_V1_ROUTES.RULES.GET_ERROR_CODE_CATALOG, {
        schema: {
            summary: 'Get Error Code Catalog', description: 'Returns a comprehensive list of all possible error codes with descriptions and severity levels.', tags: ['Rules'], headers: securityHeader, security: MGMT_V1_SECURITY,
            response: { 200: { description: 'List of error codes', type: 'object', properties: { error_codes: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, description: { type: 'string' }, category: { type: 'string' }, severity: { type: 'string', enum: ['low', 'medium', 'high'] } } } }, request_id: { type: 'string' } } } },
        },
    }, async (request: FastifyRequest, rep: FastifyReply) => {
        try {
            const request_id = generateRequestId();
            return rep.send({ error_codes: errorCodes, request_id });
        } catch (error) {
            return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.GET_ERROR_CODE_CATALOG, generateRequestId());
        }
    });

    app.post(MGMT_V1_ROUTES.RULES.TEST_RULES_AGAINST_PAYLOAD, {
        schema: {
            summary: 'Test Rules Against Payload', description: 'Performs comprehensive validation and rule evaluation with detailed results and performance metrics.', tags: ['Rules'], headers: securityHeader, security: MGMT_V1_SECURITY,
            body: { ...TestPayloadJsonSchema, additionalProperties: false },
            response: { 200: { description: 'Comprehensive validation and rules test results', type: 'object', properties: { results: { type: 'object', properties: { email: { type: 'object', properties: { valid: { type: 'boolean' }, confidence: { type: 'number' }, reason_codes: { type: 'array', items: { type: 'string' } }, risk_score: { type: 'number' }, processing_time_ms: { type: 'number' }, provider: { type: 'string' }, normalized: { type: 'string' }, disposable: { type: 'boolean' }, domain_reputation: { type: 'number' }, mx_records: { type: 'boolean' }, smtp_check: { type: 'boolean' }, catch_all: { type: 'boolean' }, role_account: { type: 'boolean' }, free_provider: { type: 'boolean' }, metadata: { type: 'object' } } }, phone: { type: 'object', properties: { valid: { type: 'boolean' }, confidence: { type: 'number' }, reason_codes: { type: 'array', items: { type: 'string' } }, risk_score: { type: 'number' }, processing_time_ms: { type: 'number' }, provider: { type: 'string' }, e164: { type: 'string' }, country: { type: 'string' }, carrier: { type: 'string' }, line_type: { type: 'string' }, reachable: { type: 'boolean' }, ported: { type: 'boolean' }, roaming: { type: 'boolean' }, metadata: { type: 'object' } } }, address: { type: 'object', properties: { valid: { type: 'boolean' }, confidence: { type: 'number' }, reason_codes: { type: 'array', items: { type: 'string' } }, risk_score: { type: 'number' }, processing_time_ms: { type: 'number' }, provider: { type: 'string' }, normalized: { type: 'object' }, po_box: { type: 'boolean' }, residential: { type: 'boolean' }, deliverable: { type: 'boolean' }, dpv_confirmed: { type: 'boolean' }, geocode: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } }, metadata: { type: 'object' } } }, name: { type: 'object', properties: { valid: { type: 'boolean' }, confidence: { type: 'number' }, reason_codes: { type: 'array', items: { type: 'string' } }, risk_score: { type: 'number' }, processing_time_ms: { type: 'number' }, provider: { type: 'string' }, normalized: { type: 'string' }, parts: { type: 'object', properties: { first: { type: 'string' }, middle: { type: 'string' }, last: { type: 'string' } } }, gender: { type: 'string' }, salutation: { type: 'string' }, metadata: { type: 'object' } } }, ip: { type: 'object', properties: { valid: { type: 'boolean' }, confidence: { type: 'number' }, reason_codes: { type: 'array', items: { type: 'string' } }, risk_score: { type: 'number' }, processing_time_ms: { type: 'number' }, provider: { type: 'string' }, country: { type: 'string' }, region: { type: 'string' }, city: { type: 'string' }, is_vpn: { type: 'boolean' }, is_proxy: { type: 'boolean' }, is_tor: { type: 'boolean' }, is_datacenter: { type: 'boolean' }, asn: { type: 'string' }, org: { type: 'string' }, metadata: { type: 'object' } } }, device: { type: 'object', properties: { valid: { type: 'boolean' }, confidence: { type: 'number' }, reason_codes: { type: 'array', items: { type: 'string' } }, risk_score: { type: 'number' }, processing_time_ms: { type: 'number' }, provider: { type: 'string' }, type: { type: 'string' }, os: { type: 'string' }, browser: { type: 'string' }, is_bot: { type: 'boolean' }, fingerprint: { type: 'string' }, metadata: { type: 'object' } } } } }, rule_evaluations: { type: 'array', items: { type: 'object', properties: { rule_id: { type: 'string' }, rule_name: { type: 'string' }, description: { type: 'string' }, condition: { type: 'string' }, triggered: { type: 'boolean' }, action: { type: 'string', enum: ['approve', 'hold', 'block'] }, priority: { type: 'number' }, evaluation_time_ms: { type: 'number' }, confidence_score: { type: 'number' }, reason: { type: 'string' }, error: { type: 'string' }, metadata: { type: 'object' } } } }, final_decision: { type: 'object', properties: { action: { type: 'string', enum: ['approve', 'hold', 'block', 'review'] }, confidence: { type: 'number' }, reasons: { type: 'array', items: { type: 'string' } }, risk_score: { type: 'number' }, risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, recommended_actions: { type: 'array', items: { type: 'string' } } }, required: ['action', 'confidence', 'reasons', 'risk_score', 'risk_level'] }, performance_metrics: { type: 'object', properties: { total_duration_ms: { type: 'number' }, validation_duration_ms: { type: 'number' }, rule_evaluation_duration_ms: { type: 'number' }, parallel_validations: { type: 'boolean' }, cache_hits: { type: 'number' }, cache_misses: { type: 'number' } }, required: ['total_duration_ms', 'validation_duration_ms', 'rule_evaluation_duration_ms', 'parallel_validations', 'cache_hits', 'cache_misses'] }, request_id: { type: 'string' }, timestamp: { type: 'string' }, project_id: { type: 'string' }, environment: { type: 'string', enum: ['test', 'production'] }, debug_info: { type: 'object', properties: { rules_evaluated: { type: 'number' }, rules_triggered: { type: 'number' }, validation_providers_used: { type: 'array', items: { type: 'string' } }, errors: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, error: { type: 'string' } } } }, warnings: { type: 'array', items: { type: 'string' } } } } }, required: ['results', 'rule_evaluations', 'final_decision', 'performance_metrics', 'request_id', 'timestamp', 'project_id', 'environment'] }, 400: { description: 'Invalid request payload', type: 'object', properties: { error: { type: 'string' }, details: { type: 'array', items: { type: 'string' } } } }, 415: { description: 'Unsupported Media Type', type: 'object', properties: { error: { type: 'string' }, request_id: { type: 'string' } } }, 500: { description: 'Internal server error', type: 'object', properties: { error: { type: 'string' }, request_id: { type: 'string' } } } }
        }
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            return await handleTestRules(request, reply, pool, redis);
        } catch (error) {
            return sendServerError(request, reply, error, MGMT_V1_ROUTES.RULES.TEST_RULES_AGAINST_PAYLOAD, generateRequestId());
        }
    });

    app.post(MGMT_V1_ROUTES.RULES.REGISTER_CUSTOM_RULES, {
        schema: {
            summary: 'Register Custom Rules', description: 'Registers custom business rules for the project.', tags: ['Rules'], headers: securityHeader, security: MGMT_V1_SECURITY,
            body: { type: 'object', properties: { rules: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, logic: { type: 'string' }, severity: { type: 'string', enum: ['low', 'medium', 'high'] }, enabled: { type: 'boolean' } } } } } },
            response: { 200: { description: 'Rules registered successfully', type: 'object', properties: { message: { type: 'string' }, registered_rules: { type: 'array', items: { type: 'string' } }, request_id: { type: 'string' } } } },
        },
    }, async (request: FastifyRequest, rep: FastifyReply) => {
        try {
            return await handleRegisterCustomRules(request, rep, pool);
        } catch (error) {
            return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.REGISTER_CUSTOM_RULES, generateRequestId());
        }
    });

    app.delete(`${MGMT_V1_ROUTES.RULES.DELETE_CUSTOM_RULE}`, {
        schema: {
            summary: 'Delete Custom Rule',
            description: 'Deletes a specific custom rule by ID.',
            tags: ['Rules'],
            headers: securityHeader,
            security: MGMT_V1_SECURITY,
            params: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Rule ID to delete' }
                },
                required: ['id']
            },
            response: {
                200: {
                    description: 'Rule deleted successfully',
                    type: 'object',
                    properties: {
                        message: { type: 'string' },
                        deleted_rule_id: { type: 'string' },
                        request_id: { type: 'string' }
                    }
                },
                400: {
                    description: 'Invalid request',
                    type: 'object',
                    properties: {
                        error: { type: 'string' },
                        request_id: { type: 'string' }
                    }
                },
                404: {
                    description: 'Rule not found',
                    type: 'object',
                    properties: {
                        error: { type: 'string' },
                        request_id: { type: 'string' },
                        details: { type: 'string' }
                    }
                },
                500: {
                    description: 'Internal server error',
                    type: 'object',
                    properties: {
                        error: { type: 'string' },
                        request_id: { type: 'string' }
                    }
                }
            }
        }
    }, async (request: FastifyRequest, rep: FastifyReply) => {
        try {
            return await handleDeleteCustomRule(request, rep, pool);
        } catch (error) {
            return sendServerError(request, rep, error, `${MGMT_V1_ROUTES.RULES.REGISTER_CUSTOM_RULES}/:id`, generateRequestId());
        }
    });
}