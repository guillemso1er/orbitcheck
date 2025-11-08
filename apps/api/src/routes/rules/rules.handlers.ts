// FILE: rules.handlers.ts

import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { generateRequestId } from "../utils.js";
import { convertConditionsToLogic, getBuiltInRules, inferActionFromConditions } from "./rules.constants.js";
import { RuleEvaluationResult, TestRulesResponse, ValidationPayload } from "./rules.types.js";
import { validatePayload } from "./rules.validation.js";
import { RiskScoreCalculator, RuleEvaluator } from "./test-rules.js";

/**
 * Handles the logic for testing a payload against all rules.
 */
export async function handleTestRules(
    request: FastifyRequest,
    reply: FastifyReply,
    pool: Pool,
    redis?: any
) {
    const startTime = performance.now();
    const request_id = generateRequestId();
    const project_id = (request as any).project_id;

    const metrics = {
        cache_hits: 0,
        cache_misses: 0,
        validation_start: 0,
        validation_end: 0,
        rule_eval_start: 0,
        rule_eval_end: 0,
    };

    const debug_info: any = {
        rules_evaluated: 0,
        rules_triggered: 0,
        validation_providers_used: [],
        errors: [],
        warnings: []
    };

    const results: any = {};
    let body: ValidationPayload;

    try {
        if (typeof request.body === 'string' || !request.body) {
            return reply.status(400).send({ error: 'Invalid payload: must be a JSON object', request_id });
        }
        body = request.body as ValidationPayload;
        if (typeof body !== 'object' || Array.isArray(body)) {
            return reply.status(400).send({ error: 'Invalid payload: must be a JSON object', request_id });
        }
        if (body.email && typeof body.email !== 'string') return reply.status(400).send({ error: 'Invalid payload: email must be a string', request_id });
        if (body.phone && typeof body.phone !== 'string') return reply.status(400).send({ error: 'Invalid payload: phone must be a string', request_id });
        if (body.name && typeof body.name !== 'string') return reply.status(400).send({ error: 'Invalid payload: name must be a string', request_id });
        if (body.ip && typeof body.ip !== 'string') return reply.status(400).send({ error: 'Invalid payload: ip must be a string', request_id });
        if (body.user_agent && typeof body.user_agent !== 'string') return reply.status(400).send({ error: 'Invalid payload: user_agent must be a string', request_id });
        if (body.session_id && typeof body.session_id !== 'string') return reply.status(400).send({ error: 'Invalid payload: session_id must be a string', request_id });
        if (body.currency && typeof body.currency !== 'string') return reply.status(400).send({ error: 'Invalid payload: currency must be a string', request_id });
        if (body.transaction_amount && typeof body.transaction_amount !== 'number') return reply.status(400).send({ error: 'Invalid payload: transaction_amount must be a number', request_id });
    } catch (error) {
        return reply.status(400).send({ error: 'Invalid JSON payload', request_id });
    }

    const { results: orchestratorResults, metrics: orchestratorMetrics, debug_info: orchestratorDebugInfo } = await validatePayload(body, redis, pool, { mode: 'test', fillMissingResults: true, useCache: true, timeoutMs: 30000, projectId: project_id });
    Object.assign(results, orchestratorResults);
    metrics.cache_hits += orchestratorMetrics.cache_hits;
    metrics.cache_misses += orchestratorMetrics.cache_misses;
    metrics.validation_start = orchestratorMetrics.validation_start;
    metrics.validation_end = orchestratorMetrics.validation_end;
    debug_info.validation_providers_used.push(...orchestratorDebugInfo.validation_providers_used);
    debug_info.errors.push(...orchestratorDebugInfo.errors);
    debug_info.warnings.push(...orchestratorDebugInfo.warnings);

    const riskAnalysis = RiskScoreCalculator.calculate(results);
    metrics.rule_eval_start = performance.now();
    const rulesQuery = await pool.query(`SELECT * FROM rules WHERE project_id = $1 AND enabled = true ORDER BY priority DESC, created_at ASC`, [project_id]);
    const dbRules = rulesQuery.rows;
    const builtInRules = getBuiltInRules();
    const allRules = [...builtInRules, ...dbRules];
    debug_info.rules_evaluated = allRules.length;

    const ruleEvaluations: RuleEvaluationResult[] = [];
    const evaluationContext = {
        email: results.email || { valid: false, confidence: 0 }, emailString: body.email, phone: results.phone || { valid: false, confidence: 0 }, phoneString: body.phone, address: results.address || { valid: false, confidence: 0 }, name: results.name || { valid: false, confidence: 0 }, ip: results.ip || { valid: true, confidence: 80 }, device: results.device || { valid: true, confidence: 75 }, risk_score: riskAnalysis.score, risk_level: riskAnalysis.level, metadata: body.metadata || {}, transaction_amount: body.transaction_amount, currency: body.currency, session_id: body.session_id,
    };

    for (const rule of allRules) {
        const evalStart = performance.now();
        try {
            const evaluation = await RuleEvaluator.evaluate(rule, evaluationContext, { timeout: 100, debug: false });
            ruleEvaluations.push({ rule_id: rule.id, rule_name: rule.name || `Rule ${rule.id}`, description: rule.description, condition: rule.condition || rule.logic, triggered: evaluation.triggered, action: rule.action || 'hold', priority: rule.priority || 0, evaluation_time_ms: performance.now() - evalStart, confidence_score: evaluation.confidence, reason: evaluation.reason, error: evaluation.error, metadata: rule.metadata });
            if (evaluation.triggered) debug_info.rules_triggered++;
        } catch (error) {
            ruleEvaluations.push({ rule_id: rule.id, rule_name: rule.name || `Rule ${rule.id}`, description: rule.description, condition: rule.condition || rule.logic, triggered: false, action: rule.action || 'hold', priority: rule.priority || 0, evaluation_time_ms: performance.now() - evalStart, error: error instanceof Error ? error.message : 'Evaluation failed' });
            debug_info.errors.push({ field: `rule_${rule.id}`, error: error instanceof Error ? error.message : 'Unknown error' });
        }
    }

    metrics.rule_eval_end = performance.now();
    const triggeredRules = ruleEvaluations.filter(r => r.triggered);
    const blockedRules = triggeredRules.filter(r => r.action === 'block');
    const holdRules = triggeredRules.filter(r => r.action === 'hold');
    const approveRules = triggeredRules.filter(r => r.action === 'approve');
    let finalAction: 'approve' | 'hold' | 'block' | 'review';
    let finalReasons: string[] = [];

    if (blockedRules.length > 0) {
        finalAction = 'block';
        finalReasons.push(`Blocked by ${blockedRules.length} rule(s): ${blockedRules.map(r => r.rule_name).join(', ')}`);
    } else if (holdRules.length > 0) {
        if (holdRules.length >= 2 || riskAnalysis.score >= 60) {
            finalAction = 'block';
            finalReasons.push(`Escalated to block due to ${holdRules.length} hold rule(s) and high risk score: ${riskAnalysis.score}`);
        } else {
            finalAction = 'hold';
            finalReasons.push(`Held by ${holdRules.length} rule(s): ${holdRules.map(r => r.rule_name).join(', ')}`);
        }
    } else if (approveRules.length > 0) {
        finalAction = 'approve';
        finalReasons.push(`Approved by rule: ${approveRules[0].rule_name}`);
    } else if (riskAnalysis.score >= 80) {
        finalAction = 'block';
        finalReasons.push('Critical risk score requires blocking');
    } else if (riskAnalysis.score >= 60) {
        finalAction = 'review';
        finalReasons.push('High risk score requires manual review');
    } else if (riskAnalysis.score >= 35) {
        finalAction = 'hold';
        finalReasons.push('Medium-high risk score');
    } else {
        finalAction = 'approve';
        finalReasons.push('Low risk score');
    }

    finalReasons.push(...riskAnalysis.factors);
    const avgConfidence = ruleEvaluations.length > 0 ? ruleEvaluations.reduce((sum, r) => sum + (r.confidence_score || 0.5), 0) / ruleEvaluations.length : 0.7;
    const recommendedActions: string[] = [];
    if (results.email?.disposable) recommendedActions.push('Request alternative email address');
    if (results.phone?.reachable === false) recommendedActions.push('Verify phone number via SMS');
    if (results.address?.deliverable === false) recommendedActions.push('Verify shipping address');
    if (riskAnalysis.score > 50) recommendedActions.push('Request additional verification');

    const endTime = performance.now();
    const response: TestRulesResponse = {
        results: { ...results, ...(results.email && { email: { ...results.email, processing_time_ms: results.email.processing_time_ms || 0 } }), ...(results.phone && { phone: { ...results.phone, processing_time_ms: results.phone.processing_time_ms || 0 } }), ...(results.address && { address: { ...results.address, processing_time_ms: results.address.processing_time_ms || 0 } }), ...(results.name && { name: { ...results.name, processing_time_ms: results.name.processing_time_ms || 0 } }), },
        rule_evaluations: ruleEvaluations,
        final_decision: { action: finalAction, confidence: avgConfidence, reasons: finalReasons, risk_score: riskAnalysis.score, risk_level: riskAnalysis.level, recommended_actions: recommendedActions.length > 0 ? recommendedActions : undefined },
        performance_metrics: { total_duration_ms: endTime - startTime, validation_duration_ms: metrics.validation_end - metrics.validation_start, rule_evaluation_duration_ms: metrics.rule_eval_end - metrics.rule_eval_start, parallel_validations: true, cache_hits: metrics.cache_hits, cache_misses: metrics.cache_misses },
        request_id, timestamp: new Date().toISOString(), project_id, environment: 'test', debug_info: request.headers['x-debug'] === 'true' ? debug_info : undefined
    };

    request.log.info({ request_id, project_id, total_duration_ms: response.performance_metrics.total_duration_ms, risk_score: response.final_decision.risk_score, final_action: response.final_decision.action, rules_triggered: debug_info.rules_triggered, cache_hit_rate: metrics.cache_hits / (metrics.cache_hits + metrics.cache_misses) }, 'Rules test completed');
    return reply.send(response);
}

/**
 * Handles the logic for registering new custom rules.
 */
export async function handleRegisterCustomRules(
    request: FastifyRequest,
    reply: FastifyReply,
    pool: Pool
) {
    const project_id = (request as any).project_id;
    const { rules } = request.body as { rules: any[] };
    const request_id = generateRequestId();

    if (!rules || !Array.isArray(rules) || rules.length === 0) {
        return reply.status(400).send({ error: 'Invalid rules array. Must contain at least one rule.', request_id });
    }
    const ruleIds = rules.map((rule: any) => rule.id).filter(Boolean);
    const uniqueRuleIds = new Set(ruleIds);
    if (ruleIds.length !== uniqueRuleIds.size) {
        return reply.status(400).send({ error: 'Duplicate rule IDs found. Each rule must have a unique ID.', request_id });
    }
    for (const rule of rules) {
        if (!rule.name || !rule.description) {
            return reply.status(400).send({ error: 'Rule name and description are required for all rules.', request_id });
        }
    }
    if (ruleIds.length > 0) {
        const uuidRuleIds = ruleIds.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
        if (uuidRuleIds.length > 0) {
            const uuidResult = await pool.query('SELECT COUNT(*) as count FROM rules WHERE project_id = $1 AND id = ANY($2::uuid[])', [project_id, uuidRuleIds]);
            if (parseInt(uuidResult.rows[0].count) > 0) {
                return reply.status(400).send({ error: 'One or more rule IDs already exist. Rule IDs must be unique.', request_id });
            }
        }
    }

    const newRules = rules.map((rule: any) => ({
        shouldIncludeId: rule.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rule.id),
        id: rule.id, name: rule.name, description: rule.description || '', logic: rule.logic || convertConditionsToLogic(rule.conditions) || '', severity: rule.severity || 'medium', action: rule.action || inferActionFromConditions(rule.conditions) || 'hold', priority: rule.priority || 0, enabled: rule.enabled !== false,
    }));

    const insertedRules: any[] = [];
    for (const rule of newRules) {
        let query: string;
        let params: any[];
        if (rule.shouldIncludeId) {
            query = 'INSERT INTO rules (project_id, id, name, description, logic, severity, action, priority, enabled) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id';
            params = [project_id, rule.id, rule.name, rule.description, rule.logic, rule.severity, rule.action, rule.priority, rule.enabled];
        } else {
            query = 'INSERT INTO rules (project_id, name, description, logic, severity, action, priority, enabled) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id';
            params = [project_id, rule.name, rule.description, rule.logic, rule.severity, rule.action, rule.priority, rule.enabled];
        }
        const result = await pool.query(query, params);
        insertedRules.push({ ...rule, id: result.rows[0].id });
    }

    const response = { message: 'Rules registered successfully', registered_rules: insertedRules.map(r => r.id), request_id };
    return reply.status(201).send(response);
}