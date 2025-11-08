// FILE: rules.handlers.ts

import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { generateRequestId } from "../utils.js";
import { convertConditionsToLogic, getBuiltInRules, inferActionFromConditions, registerBuiltInRuleOverride } from "./rules.constants.js";
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

    console.log(`[DEBUG] handleTestRules - Starting request ${request_id} for project ${project_id}`);

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
    } catch {
        return reply.status(400).send({ error: 'Invalid JSON payload', request_id });
    }

    console.log(`[DEBUG] handleTestRules - Validating payload for ${request_id}`);
    console.log(`[DEBUG] handleTestRules - Payload: ${JSON.stringify(body)}`);

    const { results: orchestratorResults, metrics: orchestratorMetrics, debug_info: orchestratorDebugInfo } =
        await validatePayload(body, redis, pool, {
            mode: 'test',
            fillMissingResults: true,
            useCache: true,
            timeoutMs: 30000,
            projectId: project_id
        });

    console.log(`[DEBUG] handleTestRules - Validation results: ${JSON.stringify(orchestratorResults)}`);

    Object.assign(results, orchestratorResults);
    metrics.cache_hits += orchestratorMetrics.cache_hits;
    metrics.cache_misses += orchestratorMetrics.cache_misses;
    metrics.validation_start = orchestratorMetrics.validation_start;
    metrics.validation_end = orchestratorMetrics.validation_end;
    debug_info.validation_providers_used.push(...orchestratorDebugInfo.validation_providers_used);
    debug_info.errors.push(...orchestratorDebugInfo.errors);
    debug_info.warnings.push(...orchestratorDebugInfo.warnings);

    const riskAnalysis = RiskScoreCalculator.calculate(results);
    console.log(`[DEBUG] handleTestRules - Risk analysis: ${JSON.stringify(riskAnalysis)}`);

    metrics.rule_eval_start = performance.now();

    console.log(`[DEBUG] handleTestRules - Querying database for rules for project ${project_id}`);
    const rulesQuery = await pool.query(
        `SELECT * FROM rules WHERE project_id = $1 AND enabled = true ORDER BY priority DESC, created_at ASC`,
        [project_id]
    );
    console.log(`[DEBUG] handleTestRules - Found ${rulesQuery.rows.length} database rules`);
    const dbRules = rulesQuery.rows;
    const builtInRules = getBuiltInRules();
    console.log(`[DEBUG] handleTestRules - Found ${builtInRules.length} built-in rules`);
    const allRules = [...builtInRules, ...dbRules];
    debug_info.rules_evaluated = allRules.length;
    console.log(`[DEBUG] handleTestRules - Total rules to evaluate: ${allRules.length}`);

    // Heuristic phone validity (evaluation context only)
    const basePhone =
        results.phone || { valid: false, confidence: 0, risk_score: 0, reason_codes: [] as string[] };
    const phoneEval = { ...basePhone };
    if (typeof (body as any).phone === 'string') {
        const raw = String((body as any).phone);
        const e164Like = /^\+?[1-9]\d{7,14}$/.test(raw);
        if (!phoneEval.valid && e164Like) {
            phoneEval.valid = true;
            phoneEval.e164 = phoneEval.e164 || (raw.startsWith('+') ? raw : `+${raw}`);
            phoneEval.provider = phoneEval.provider || 'internal';
            if (Array.isArray(phoneEval.reason_codes)) {
                phoneEval.reason_codes = phoneEval.reason_codes.filter((c: string) =>
                    !String(c).toLowerCase().includes('phone.invalid')
                );
            }
        }
    }

    // Heuristic email adjustments (evaluation context only)
    const baseEmail =
        results.email || { valid: false, confidence: 0, risk_score: 0, reason_codes: [] as string[] };
    const emailEval = { ...baseEmail };
    const rawEmail = typeof (body as any).email === 'string' ? String((body as any).email) : null;

    const DISPOSABLE_DOMAINS = new Set([
        'tempmail.com',
        'mailinator.com',
        '10minutemail.com',
        'guerrillamail.com',
        'yopmail.com',
        'trashmail.com',
    ]);
    const FREE_PROVIDERS = new Set([
        'gmail.com',
        'yahoo.com',
        'hotmail.com',
        'outlook.com',
        'live.com',
    ]);

    if (rawEmail) {
        const domain = rawEmail.split('@')[1]?.toLowerCase();
        if (domain) {
            if (!emailEval.domain) {
                emailEval.domain = domain;
            }
            emailEval.metadata = { ...(emailEval.metadata || {}), domain };

            if (!emailEval.disposable && DISPOSABLE_DOMAINS.has(domain)) {
                emailEval.disposable = true;
            }
            if (!emailEval.free_provider && FREE_PROVIDERS.has(domain)) {
                emailEval.free_provider = true;
            }
            if (!emailEval.normalized) {
                emailEval.normalized = rawEmail.toLowerCase();
            }
        }
    }

    const ruleEvaluations: RuleEvaluationResult[] = [];
    const evaluationContext = {
        // helpers
        addressHasIssue: (address: any) => {
            if (!address) return false;
            return address.postal_code && address.city && address.postal_code_mismatch;
        },
        riskLevel: (level: string) => level === 'critical',

        // inputs and enriched results
        email: emailEval,
        emailString: (body as any).email,
        phone: phoneEval,
        phoneString: (body as any).phone,
        address: results.address || { valid: false, confidence: 0 },
        name: results.name || { valid: false, confidence: 0 },
        ip: results.ip || { valid: true, confidence: 80 },
        device: results.device || { valid: true, confidence: 75 },
        risk_score: riskAnalysis.score,
        risk_level: riskAnalysis.level,
        metadata: (body as any).metadata || {},
        transaction_amount: (body as any).transaction_amount,
        currency: (body as any).currency,
        session_id: (body as any).session_id,
    };

    console.log(`[DEBUG] handleTestRules - Evaluation context: ${JSON.stringify(Object.keys(evaluationContext))}`);
    console.log(`[DEBUG] handleTestRules - Starting rule evaluation loop`);

    for (const rule of allRules) {
        const evalStart = performance.now();
        console.log(`[DEBUG] handleTestRules - Evaluating rule: ${rule.id} (${rule.name})`);

        try {
            const evaluation = await RuleEvaluator.evaluate(rule, evaluationContext, { timeout: 100, debug: false });
            console.log(`[DEBUG] handleTestRules - Rule ${rule.id} evaluation result: triggered=${evaluation.triggered}, confidence=${evaluation.confidence}`);

            const evaluationResult = {
                rule_id: rule.id,
                rule_name: rule.name || `Rule ${rule.id}`,
                description: rule.description,
                condition: rule.condition || rule.logic,
                triggered: evaluation.triggered,
                action: rule.action || 'hold',
                priority: rule.priority || 0,
                evaluation_time_ms: performance.now() - evalStart,
                confidence_score: evaluation.confidence,
                reason: evaluation.reason,
                error: evaluation.error,
                metadata: rule.metadata,
            };

            ruleEvaluations.push(evaluationResult);
            if (evaluation.triggered) {
                debug_info.rules_triggered++;
                console.log(`[DEBUG] handleTestRules - Rule ${rule.id} TRIGGERED!`);
            }
        } catch (error) {
            console.log(`[DEBUG] handleTestRules - Rule ${rule.id} evaluation error: ${error instanceof Error ? error.message : 'Unknown error'}`);

            const evaluationResult = {
                rule_id: rule.id,
                rule_name: rule.name || `Rule ${rule.id}`,
                description: rule.description,
                condition: rule.condition || rule.logic,
                triggered: false,
                action: rule.action || 'hold',
                priority: rule.priority || 0,
                evaluation_time_ms: performance.now() - evalStart,
                error: error instanceof Error ? error.message : 'Evaluation failed',
            };

            ruleEvaluations.push(evaluationResult);
            debug_info.errors.push({
                field: `rule_${rule.id}`,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    console.log(`[DEBUG] handleTestRules - Rule evaluation complete. Total evaluated: ${ruleEvaluations.length}, Triggered: ${debug_info.rules_triggered}`);

    metrics.rule_eval_end = performance.now();
    const triggeredRules = ruleEvaluations.filter((r) => r.triggered);
    const blockedRules = triggeredRules.filter((r) => r.action === 'block');
    const holdRules = triggeredRules.filter((r) => r.action === 'hold');
    const approveRules = triggeredRules.filter((r) => r.action === 'approve');

    console.log(`[DEBUG] handleTestRules - Decision logic:`);
    console.log(`[DEBUG] handleTestRules - Triggered rules: ${triggeredRules.length}`);
    console.log(`[DEBUG] handleTestRules - Blocked rules: ${blockedRules.length} (${blockedRules.map((r) => r.rule_id).join(', ')})`);
    console.log(`[DEBUG] handleTestRules - Hold rules: ${holdRules.length} (${holdRules.map((r) => r.rule_id).join(', ')})`);
    console.log(`[DEBUG] handleTestRules - Approve rules: ${approveRules.length} (${approveRules.map((r) => r.rule_id).join(', ')})`);
    console.log(`[DEBUG] handleTestRules - Risk score: ${riskAnalysis.score}, Level: ${riskAnalysis.level}`);

    let finalAction: 'approve' | 'hold' | 'block' | 'review';
    const finalReasons: string[] = [];

    if (approveRules.length > 0) {
        finalAction = 'approve';
        finalReasons.push(`Approved by rule: ${approveRules[0].rule_name}`);
        console.log(`[DEBUG] handleTestRules - Final action: APPROVE (approve rule takes precedence)`);
    } else if (blockedRules.length > 0) {
        finalAction = 'block';
        finalReasons.push(`Blocked by ${blockedRules.length} rule(s): ${blockedRules.map((r) => r.rule_name).join(', ')}`);
        console.log(`[DEBUG] handleTestRules - Final action: BLOCK (from blocked rules)`);
    } else if (holdRules.length > 0) {
        if (riskAnalysis.score >= 80 || riskAnalysis.level === 'critical') {
            finalAction = 'review';
            finalReasons.push(
                `Manual review due to critical risk (${riskAnalysis.score}) with ${holdRules.length} hold rule(s): ${holdRules.map((r) => r.rule_name).join(', ')}`
            );
            console.log(`[DEBUG] handleTestRules - Final action: REVIEW (critical risk with hold rules)`);
        } else {
            finalAction = 'hold';
            finalReasons.push(`Held by ${holdRules.length} rule(s): ${holdRules.map((r) => r.rule_name).join(', ')}`);
            console.log(`[DEBUG] handleTestRules - Final action: HOLD (from hold rules)`);
        }
    } else if (riskAnalysis.score >= 80) {
        finalAction = 'block';
        finalReasons.push('Critical risk score requires blocking');
        console.log(`[DEBUG] handleTestRules - Final action: BLOCK (critical risk score)`);
    } else if (riskAnalysis.score >= 60) {
        finalAction = 'review';
        finalReasons.push('High risk score requires manual review');
        console.log(`[DEBUG] handleTestRules - Final action: REVIEW (high risk score)`);
    } else if (riskAnalysis.score >= 35) {
        finalAction = 'hold';
        finalReasons.push('Medium-high risk score');
        console.log(`[DEBUG] handleTestRules - Final action: HOLD (medium-high risk score)`);
    } else {
        finalAction = 'approve';
        finalReasons.push('Low risk score');
        console.log(`[DEBUG] handleTestRules - Final action: APPROVE (low risk score)`);
    }

    finalReasons.push(...riskAnalysis.factors);

    const avgConfidence =
        triggeredRules.length > 0
            ? triggeredRules.reduce((sum, r) => sum + (r.confidence_score || 0.5), 0) / triggeredRules.length
            : 0.7;

    const recommendedActions: string[] = [];
    if (results.email?.disposable) recommendedActions.push('Request alternative email address');
    if (results.phone?.reachable === false) recommendedActions.push('Verify phone number via SMS');
    if (results.address?.deliverable === false) recommendedActions.push('Verify shipping address');
    if (riskAnalysis.score > 50) recommendedActions.push('Request additional verification');

    const endTime = performance.now();

    console.log(`[DEBUG] handleTestRules - Final response structure:`);
    console.log(`[DEBUG] handleTestRules - rule_evaluations length: ${ruleEvaluations.length}`);
    console.log(`[DEBUG] handleTestRules - first few rule_evaluations: ${JSON.stringify(ruleEvaluations.slice(0, 3))}`);
    console.log(`[DEBUG] handleTestRules - email_format in evaluations: ${ruleEvaluations.find((r) => r.rule_id === 'email_format') ? 'FOUND' : 'NOT FOUND'}`);

    const response: TestRulesResponse = {
        results: {
            ...results,
            ...(results.email && {
                email: { ...results.email, processing_time_ms: results.email.processing_time_ms || 0 },
            }),
            ...(results.phone && {
                phone: { ...results.phone, processing_time_ms: results.phone.processing_time_ms || 0 },
            }),
            ...(results.address && {
                address: { ...results.address, processing_time_ms: results.address.processing_time_ms || 0 },
            }),
            ...(results.name && {
                name: { ...results.name, processing_time_ms: results.name.processing_time_ms || 0 },
            }),
        },
        rule_evaluations: ruleEvaluations,
        final_decision: {
            action: finalAction,
            confidence: avgConfidence,
            reasons: finalReasons,
            risk_score: riskAnalysis.score,
            risk_level: riskAnalysis.level,
            recommended_actions: recommendedActions.length > 0 ? recommendedActions : undefined, // snake_case key, camelCase variable
        },
        performance_metrics: {
            total_duration_ms: endTime - startTime,
            validation_duration_ms: metrics.validation_end - metrics.validation_start,
            rule_evaluation_duration_ms: metrics.rule_eval_end - metrics.rule_eval_start,
            parallel_validations: true,
            cache_hits: metrics.cache_hits,
            cache_misses: metrics.cache_misses,
        },
        request_id,
        timestamp: new Date().toISOString(),
        project_id,
        environment: 'test',
        debug_info: request.headers['x-debug'] === 'true' ? debug_info : undefined,
    };

    request.log.info(
        {
            request_id,
            project_id,
            total_duration_ms: response.performance_metrics.total_duration_ms,
            risk_score: response.final_decision.risk_score,
            final_action: response.final_decision.action,
            rules_triggered: debug_info.rules_triggered,
            cache_hit_rate: metrics.cache_hits / (metrics.cache_hits + metrics.cache_misses),
        },
        'Rules test completed'
    );

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

    // If any UUID-like IDs provided, check duplicates
    if (ruleIds.length > 0) {
        const uuidRuleIds = ruleIds.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
        if (uuidRuleIds.length > 0) {
            const uuidResult = await pool.query(
                'SELECT COUNT(*) as count FROM rules WHERE project_id = $1 AND id = ANY($2::uuid[])',
                [project_id, uuidRuleIds]
            );
            if (parseInt(uuidResult.rows[0].count) > 0) {
                return reply.status(400).send({ error: 'One or more rule IDs already exist. Rule IDs must be unique.', request_id });
            }
        }
    }

    // helper to resolve action from 'action' or 'actions' or infer
    const resolveAction = (r: any): 'block' | 'hold' | 'approve' => {
        if (r.action) return r.action;
        if (r.actions) {
            if (r.actions.block) return 'block';
            if (r.actions.approve) return 'approve';
            if (r.actions.hold) return 'hold';
        }
        return (inferActionFromConditions(r.conditions) || 'hold') as any;
    };

    const newRules = rules.map((r: any) => {
        const logic = r.logic || r.condition || convertConditionsToLogic(r.conditions) || '';
        const action = resolveAction(r);

        // Register an in-memory override if this matches a built-in id
        if (typeof r.id === 'string') {
            registerBuiltInRuleOverride(r.id, {
                condition: logic,
                action,
                priority: r.priority,
                name: r.name,
                description: r.description,
                enabled: r.enabled !== false,
            });
        }

        return {
            shouldIncludeId: r.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.id),
            id: r.id,
            name: r.name,
            description: r.description || '',
            logic, // CHANGED: accept 'condition' as well
            severity: r.severity || 'medium',
            action, // CHANGED: respect action/actions/infer
            priority: r.priority || 0,
            enabled: r.enabled !== false,
        };
    });

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

    const response = {
        message: 'Rules registered successfully',
        registered_rules: insertedRules.map(r => r.id),
        request_id
    };
    return reply.status(201).send(response);
}