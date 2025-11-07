import crypto from 'crypto';
import { performance } from 'perf_hooks';
export interface ValidationPayload {
    email?: string;
    phone?: string;
    address?: {
        line1?: string;
        line2?: string;
        city?: string;
        state?: string;
        postal_code?: string;
        country?: string;
    };
    name?: string;
    ip?: string;
    user_agent?: string;
    metadata?: Record<string, any>;
    session_id?: string;
    transaction_amount?: number;
    currency?: string;
}

export interface RuleEvaluationResult {
    rule_id: string;
    rule_name: string;
    description?: string;
    condition: string;
    triggered: boolean;
    action: 'approve' | 'hold' | 'block';
    priority: number;
    evaluation_time_ms: number;
    error?: string;
    confidence_score?: number;
    reason?: string;
    metadata?: Record<string, any>;
}

interface ValidationFieldResult {
    valid: boolean;
    confidence: number;
    reason_codes: string[];
    risk_score: number;
    processing_time_ms: number;
    provider?: string;
    raw_response?: any;
    metadata?: Record<string, any>;
}

export interface TestRulesResponse {
    results: {
        email?: ValidationFieldResult & {
            normalized?: string;
            disposable?: boolean;
            domain_reputation?: number;
            mx_records?: boolean;
            smtp_check?: boolean;
            catch_all?: boolean;
            role_account?: boolean;
            free_provider?: boolean;
        };
        phone?: ValidationFieldResult & {
            e164?: string;
            country?: string;
            carrier?: string;
            line_type?: string;
            reachable?: boolean;
            ported?: boolean;
            roaming?: boolean;
        };
        address?: ValidationFieldResult & {
            normalized?: any;
            po_box?: boolean;
            residential?: boolean;
            deliverable?: boolean;
            dpv_confirmed?: boolean;
            geocode?: { lat: number; lng: number };
        };
        name?: ValidationFieldResult & {
            normalized?: string;
            parts?: { first?: string; middle?: string; last?: string };
            gender?: string;
            salutation?: string;
        };
        ip?: ValidationFieldResult & {
            country?: string;
            region?: string;
            city?: string;
            is_vpn?: boolean;
            is_proxy?: boolean;
            is_tor?: boolean;
            is_datacenter?: boolean;
            asn?: string;
            org?: string;
        };
        device?: ValidationFieldResult & {
            type?: string;
            os?: string;
            browser?: string;
            is_bot?: boolean;
            fingerprint?: string;
        };
    };
    rule_evaluations: RuleEvaluationResult[];
    final_decision: {
        action: 'approve' | 'hold' | 'block' | 'review';
        confidence: number;
        reasons: string[];
        risk_score: number;
        risk_level: 'low' | 'medium' | 'high' | 'critical';
        recommended_actions?: string[];
    };
    performance_metrics: {
        total_duration_ms: number;
        validation_duration_ms: number;
        rule_evaluation_duration_ms: number;
        parallel_validations: boolean;
        cache_hits: number;
        cache_misses: number;
    };
    request_id: string;
    timestamp: string;
    project_id: string;
    environment: 'test' | 'production';
    debug_info?: {
        rules_evaluated: number;
        rules_triggered: number;
        validation_providers_used: string[];
        errors: Array<{ field: string; error: string }>;
        warnings: string[];
    };
}

export const TestPayloadJsonSchema = {
    $id: 'TestPayload', type: 'object', additionalProperties: true,
    properties: {
        email: { type: 'string' }, phone: { type: 'string' }, address: {
            type: 'object', additionalProperties: false, properties: {
                line1: { type: 'string' }, line2: { type: 'string' },
                city: { type: 'string' }, state: { type: 'string' }, postal_code: { type: 'string' },
                country: { type: 'string', minLength: 2, maxLength: 2 }
            }
        }, name: { type: 'string' }, ip: { type: 'string' }, user_agent: { type: 'string' }, metadata: { type: 'object', additionalProperties: true },
        session_id: { type: 'string' }, transaction_amount: { type: 'number', exclusiveMinimum: 0 }, currency: { type: 'string', minLength: 3, maxLength: 3 }
    }
} as const;

// Enhanced Rule Evaluator
export class RuleEvaluator {
    private static readonly MAX_EVALUATION_TIME_MS = 50; // Reduced for better performance
    private static readonly OPERATOR_MAP: Record<string, string | null> = {
        'AND': '&&',
        'OR': '||',
        'NOT': '!',
        'IN': 'includes',
        'CONTAINS': 'includes',
        'STARTS_WITH': 'startsWith',
        'ENDS_WITH': 'endsWith',
        'MATCHES': 'match',
        'BETWEEN': null, // Custom handler
    };

    static async evaluate(
        rule: any,
        context: any,
        options: { timeout?: number; debug?: boolean } = {}
    ): Promise<{ triggered: boolean; confidence: number; reason?: string; error?: string }> {
        const startTime = performance.now();
        const timeout = options.timeout || this.MAX_EVALUATION_TIME_MS;

        try {
            // Set up timeout promise
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Rule evaluation timeout')), timeout)
            );

            // Set up evaluation promise
            const evaluationPromise = this.evaluateCondition(rule.condition || rule.logic, context);

            // Race between evaluation and timeout
            const result = await Promise.race([evaluationPromise, timeoutPromise]);

            performance.now() - startTime; // evaluation time not used in return value

            return result as any;
        } catch (error) {
            return {
                triggered: false,
                confidence: 0,
                error: error instanceof Error ? error.message : 'Unknown evaluation error'
            };
        }
    }

    private static async evaluateCondition(
        condition: string,
        context: any
    ): Promise<{ triggered: boolean; confidence: number; reason?: string }> {
        try {
            // Decode HTML entities
            const decodedCondition = this.decodeHtmlEntities(condition);

            // Parse and normalize the condition
            const normalizedCondition = this.normalizeCondition(decodedCondition);

            // Create safe evaluation context with helper functions
            const evalContext = this.createEvaluationContext(context);

            // Use a sandboxed evaluation approach
            const result = await this.sandboxedEval(normalizedCondition, evalContext);

            // Calculate confidence based on the evaluation
            const confidence = this.calculateConfidence(result, context);

            return {
                triggered: Boolean(result),
                confidence,
                reason: result ? 'Condition met' : 'Condition not met'
            };
        } catch (error) {
            throw new Error(`Failed to evaluate condition: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private static decodeHtmlEntities(str: string): string {
        const entities: Record<string, string> = {
            '&amp;': '&',
            '&lt;': '<',
            '&gt;': '>',
            '&quot;': '"',
            '&#039;': "'",
            '&#x27;': "'",
            '&nbsp;': ' ',
        };

        return str.replace(/&[a-zA-Z0-9#]+;/g, (entity) => entities[entity] || entity);
    }

    private static normalizeCondition(condition: string): string {
        let normalized = condition;

        // Replace logical operators
        Object.entries(this.OPERATOR_MAP).forEach(([from, to]) => {
            if (to) {
                const regex = new RegExp(`\\b${from}\\b`, 'gi');
                normalized = normalized.replace(regex, to);
            }
        });

        // Handle comparison operators
        normalized = normalized
            .replace(/\b==\b/g, '===')
            .replace(/\b!=\b/g, '!==')
            .replace(/\b<>\b/g, '!==')
            .replace(/\bIS NULL\b/gi, '=== null')
            .replace(/\bIS NOT NULL\b/gi, '!== null');

        return normalized;
    }

    private static createEvaluationContext(context: any): any {

        const enhancedContext = JSON.parse(JSON.stringify(context));
        if (enhancedContext.email?.metadata?.domain) {
            enhancedContext.email.domain = enhancedContext.email.metadata.domain;
        }
        if (enhancedContext.phone?.metadata) {
            Object.assign(enhancedContext.phone, enhancedContext.phone.metadata);
        }
        if (enhancedContext.address?.metadata) {
            Object.assign(enhancedContext.address, enhancedContext.address.metadata);
        }

        return {
            ...enhancedContext,
            // Helper functions for rule evaluation
            exists: (value: any) => value !== null && value !== undefined,
            isEmpty: (value: any) => {
                if (value === null || value === undefined) return true;
                if (typeof value === 'string') return value.trim().length === 0;
                if (Array.isArray(value)) return value.length === 0;
                if (typeof value === 'object') return Object.keys(value).length === 0;
                return false;
            },
            isEmail: (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
            isPhone: (value: string) => /^\+?[1-9]\d{1,14}$/.test(value),
            isPostalCode: (value: string, country: string = 'US') => {
                const patterns: Record<string, RegExp> = {
                    US: /^\d{5}(-\d{4})?$/,
                    UK: /^[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}$/i,
                    CA: /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i,
                };
                return patterns[country]?.test(value) || false;
            },
            between: (value: number, min: number, max: number) => value >= min && value <= max,
            inList: (value: any, list: any[]) => list.includes(value),
            matches: (value: string, pattern: string) => new RegExp(pattern).test(value),
            daysSince: (dateStr: string) => {
                const date = new Date(dateStr);
                const now = new Date();
                return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
            },
            // Enhanced validation helpers
            emailFormatInvalid: (value: any) => {
                if (!value) return false;
                // Check for format issues by testing email pattern
                if (typeof value === 'string') {
                    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    return !emailPattern.test(value);
                }
                /**
                 * FIX: Addresses 'triggers email format validation on invalid email formats' test failure.
                 * The original logic (`|| !value.mx_records`) incorrectly mixed deliverability (MX records)
                 * with format validation. The `email_format` rule should only trigger on format issues.
                 */
                return value.valid === false && value.reason_codes &&
                    (value.reason_codes.includes('EMAIL_INVALID_FORMAT'));
            },
            emailHasFormatIssue: (value: any) => {
                if (!value) return false;
                if (typeof value === 'string') {
                    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    return !emailPattern.test(value);
                }
                return value && value.valid === false;
            },
            addressHasIssue: (value: any) => value && value.valid === false,
            riskLevel: (level: string) => level === 'critical',
            // Math functions
            Math: Math,
            parseInt: parseInt,
            parseFloat: parseFloat,
            // Date functions
            Date: Date,
            now: () => new Date(),
        };
    }

    private static async sandboxedEval(expression: string, context: any): Promise<boolean> {
        try {
            // Create a function with limited scope
            const func = new Function(
                ...Object.keys(context),
                `
        "use strict";
        try {
          return Boolean(${expression});
        } catch (e) {
          return false;
        }
        `
            );

            return func(...Object.values(context));
        } catch (error) {
            console.error('Sandboxed evaluation failed:', error);
            return false;
        }
    }

    private static calculateConfidence(result: boolean, context: any): number {
        let confidence = result ? 0.7 : 0.3; // Base confidence in 0-1 range

        // Adjust confidence based on data quality
        if (context.email?.valid) confidence += 0.1;
        if (context.phone?.valid) confidence += 0.1;
        if (context.address?.valid) confidence += 0.1;

        // Adjust based on risk scores
        const avgRiskScore = [
            context.email?.risk_score,
            context.phone?.risk_score,
            context.address?.risk_score,
        ].filter(score => score !== undefined).reduce((a, b, _, arr) => a + b / arr.length, 0);

        if (avgRiskScore > 70) confidence -= 0.15;
        if (avgRiskScore > 50) confidence -= 0.1;
        if (avgRiskScore < 30) confidence += 0.1;
        if (avgRiskScore < 10) confidence += 0.1;

        return Math.max(0, Math.min(1, confidence));
    }
}

// Risk Score Calculator
export class RiskScoreCalculator {
    private static readonly RISK_FACTORS = {
        email: {
            invalid: 30,
            disposable: 35,
            role_account: 15,
            free_provider: 10,
            no_mx_records: 20,
            catch_all: 10,
        },
        phone: {
            invalid: 30,
            unreachable: 25,
            voip: 15,
            recent_port: 20,
        },
        address: {
            invalid: 35,
            po_box: 15,
            non_deliverable: 30,
            apartment_missing: 10,
        },
        ip: {
            vpn: 20,
            proxy: 25,
            tor: 40,
            datacenter: 15,
            country_mismatch: 25,
        },
        device: {
            bot: 50,
            emulator: 40,
            modified: 30,
        },
        behavioral: {
            velocity_high: 30,
            unusual_time: 15,
            multiple_attempts: 20,
        }
    };

    static calculate(validationResults: any): {
        score: number;
        level: 'low' | 'medium' | 'high' | 'critical';
        factors: string[];
    } {
        let totalScore = 0;
        const factors: string[] = [];

        // Email risk factors
        if (validationResults.email) {
            const email = validationResults.email;
            if (!email.valid) {
                totalScore += this.RISK_FACTORS.email.invalid;
                factors.push('Invalid email');
            }
            if (email.disposable) {
                totalScore += this.RISK_FACTORS.email.disposable;
                factors.push('Disposable email');
            }
            if (email.role_account) {
                totalScore += this.RISK_FACTORS.email.role_account;
                factors.push('Role account email');
            }
            if (email.free_provider) {
                totalScore += this.RISK_FACTORS.email.free_provider;
                factors.push('Free email provider');
            }
            if (email.mx_records === false) {
                totalScore += this.RISK_FACTORS.email.no_mx_records;
                factors.push('No MX records');
            }
            if (email.catch_all) {
                totalScore += this.RISK_FACTORS.email.catch_all;
                factors.push('Catch-all domain');
            }
        }

        // Phone risk factors
        if (validationResults.phone) {
            const phone = validationResults.phone;
            if (!phone.valid) {
                totalScore += this.RISK_FACTORS.phone.invalid;
                factors.push('Invalid phone');
            }
            if (phone.reachable === false) {
                totalScore += this.RISK_FACTORS.phone.unreachable;
                factors.push('Phone unreachable');
            }
            if (phone.line_type === 'voip') {
                totalScore += this.RISK_FACTORS.phone.voip;
                factors.push('VoIP number');
            }
            if (phone.ported) {
                totalScore += this.RISK_FACTORS.phone.recent_port;
                factors.push('Recently ported number');
            }
        }

        // Address risk factors
        if (validationResults.address) {
            const address = validationResults.address;

            // Check for specific address issues with appropriate risk levels
            if (address.po_box) {
                totalScore += this.RISK_FACTORS.address.po_box;
                factors.push('PO Box address');
            }

            // Check for postal code/city mismatch - should be medium risk (20-25 points)
            const isPostalMismatch = address.reason_codes &&
                (address.reason_codes as string[]).some((code: string) =>
                    code.includes('POSTAL') || code.includes('CITY_MISMATCH') || code.includes('ADDRESS_POSTAL_CITY_MISMATCH'));

            if (isPostalMismatch) {
                totalScore += 25; // Medium risk - should not escalate to critical
                factors.push('Address postal/city mismatch');
            } else if (!address.valid) {
                totalScore += this.RISK_FACTORS.address.invalid;
                factors.push('Invalid address');
            }

            if (address.deliverable === false) {
                totalScore += this.RISK_FACTORS.address.non_deliverable;
                factors.push('Non-deliverable address');
            }
        }

        // IP risk factors
        if (validationResults.ip) {
            const ip = validationResults.ip;
            if (ip.is_vpn) {
                totalScore += this.RISK_FACTORS.ip.vpn;
                factors.push('VPN detected');
            }
            if (ip.is_proxy) {
                totalScore += this.RISK_FACTORS.ip.proxy;
                factors.push('Proxy detected');
            }
            if (ip.is_tor) {
                totalScore += this.RISK_FACTORS.ip.tor;
                factors.push('Tor network');
            }
            if (ip.is_datacenter) {
                totalScore += this.RISK_FACTORS.ip.datacenter;
                factors.push('Datacenter IP');
            }
        }

        // Device risk factors
        if (validationResults.device) {
            const device = validationResults.device;
            if (device.is_bot) {
                totalScore += this.RISK_FACTORS.device.bot;
                factors.push('Bot detected');
            }
        }

        // Normalize score to 0-100
        const normalizedScore = Math.min(100, totalScore);

        // Determine risk level
        let level: 'low' | 'medium' | 'high' | 'critical';
        if (normalizedScore >= 75) {
            level = 'critical';
        } else if (normalizedScore >= 50) {
            level = 'high';
        } else if (normalizedScore >= 25) {
            level = 'medium';
        } else {
            level = 'low';
        }

        return {
            score: normalizedScore,
            level,
            factors
        };
    }
}

// Cache Manager for better performance
export class ValidationCacheManager {
    private static readonly CACHE_TTL = 300; // 5 minutes

    static async get(redis: any, key: string): Promise<any | null> {
        try {
            const cached = await redis.get(key);
            return cached ? JSON.parse(cached) : null;
        } catch {
            return null;
        }
    }

    static async set(redis: any, key: string, value: any, ttl?: number): Promise<void> {
        try {
            await redis.setex(
                key,
                ttl || this.CACHE_TTL,
                JSON.stringify(value)
            );
        } catch (error) {
            console.error('Cache set error:', error);
        }
    }

    static generateKey(type: string, value: string, projectId: string): string {
        const hash = crypto
            .createHash('md5')
            .update(`${type}:${value}:${projectId}`)
            .digest('hex');
        return `validation:${hash}`;
    }
}

// Enhanced validation result builders
export function buildEnhancedEmailValidationResult(result: any): any {
    const processingStart = performance.now();

    const enhanced = {
        valid: result.valid || false,
        confidence: calculateFieldConfidence(result),
        reason_codes: result.reason_codes || [],
        risk_score: 0,
        processing_time_ms: 0,
        provider: result.provider || 'internal',
        normalized: result.normalized,
        disposable: result.disposable || false,
        domain_reputation: result.domain_reputation,
        mx_records: result.mx_found,
        smtp_check: result.smtp_check,
        catch_all: result.catch_all,
        role_account: result.role_account || false,
        free_provider: result.free_provider || false,
        metadata: {
            domain: result.domain,
            suggestion: result.suggestion,
            checked_at: new Date().toISOString()
        }
    };

    // Calculate risk score
    if (!enhanced.valid) enhanced.risk_score += 30;
    if (enhanced.disposable) enhanced.risk_score += 25;
    if (enhanced.role_account) enhanced.risk_score += 15;
    if (enhanced.free_provider) enhanced.risk_score += 10;
    if (!enhanced.mx_records) enhanced.risk_score += 20;
    if (enhanced.catch_all) enhanced.risk_score += 10;

    enhanced.processing_time_ms = performance.now() - processingStart;

    return enhanced;
}

export function buildEnhancedPhoneValidationResult(result: any): any {
    const processingStart = performance.now();

    const enhanced = {
        valid: result.valid || false,
        confidence: calculateFieldConfidence(result),
        reason_codes: result.reason_codes || [],
        risk_score: 0,
        processing_time_ms: 0,
        provider: result.provider || 'internal',
        e164: result.e164,
        country: result.country,
        carrier: result.carrier,
        line_type: result.line_type,
        reachable: result.reachable,
        ported: result.ported || false,
        roaming: result.roaming || false,
        metadata: {
            timezone: result.timezone,
            checked_at: new Date().toISOString()
        }
    };

    // Calculate risk score
    if (!enhanced.valid) enhanced.risk_score += 30;
    if (enhanced.reachable === false) enhanced.risk_score += 25;
    if (enhanced.line_type === 'voip') enhanced.risk_score += 15;
    if (enhanced.ported) enhanced.risk_score += 20;

    enhanced.processing_time_ms = performance.now() - processingStart;

    return enhanced;
}

export function buildEnhancedAddressValidationResult(result: any, input?: any): any {
    const processingStart = performance.now();

    const enhanced = {
        valid: result.valid || false,
        confidence: calculateFieldConfidence(result),
        reason_codes: result.reason_codes || [],
        risk_score: 0,
        processing_time_ms: 0,
        provider: result.provider || 'internal',
        normalized: result.normalized,
        po_box: result.po_box || false,
        residential: result.residential,
        deliverable: result.deliverable,
        dpv_confirmed: result.dpv_confirmed,
        geocode: result.geocode,
        country: input?.country || undefined,
        metadata: {
            components: result.components,
            checked_at: new Date().toISOString()
        }
    };

    // Calculate risk score
    if (!enhanced.valid) enhanced.risk_score += 35;
    if (enhanced.po_box) enhanced.risk_score += 15;
    if (enhanced.deliverable === false) enhanced.risk_score += 30;
    if (!enhanced.dpv_confirmed) enhanced.risk_score += 20;

    enhanced.processing_time_ms = performance.now() - processingStart;

    return enhanced;
}

export function buildEnhancedNameValidationResult(result: any): any {
    const processingStart = performance.now();

    const enhanced = {
        valid: result.valid || false,
        confidence: calculateFieldConfidence(result),
        reason_codes: result.reason_codes || [],
        risk_score: result.valid ? 0 : 10,
        processing_time_ms: 0,
        provider: 'internal',
        normalized: result.normalized,
        parts: result.parts,
        gender: result.gender,
        salutation: result.salutation,
        metadata: {
            original: result.original,
            checked_at: new Date().toISOString()
        }
    };

    enhanced.processing_time_ms = performance.now() - processingStart;

    return enhanced;
}

export function calculateFieldConfidence(result: any): number {

    let confidence = 50; // Base confidence

    if (result.valid) {
        confidence += 30;
    } else if (result.mx_found) {
        // If validation failed but MX records exist, it's not a total loss of confidence.
        confidence += 10;
    }

    if (!result.reason_codes || result.reason_codes.length === 0) confidence += 10;
    if (result.provider === 'trusted') confidence += 10;

    // Penalize for negative signals
    if (result.disposable) confidence -= 20;


    return Math.max(0, Math.min(100, confidence));
}

// Import the actual validation functions from the validators
import { validateAddress } from '../../validators/address.js';
import { validateEmail } from '../../validators/email.js';
import { validateName } from '../../validators/name.js';
import { validatePhone } from '../../validators/phone.js';

export interface ValidationOrchestratorOptions {
    mode?: 'test' | 'live';
    fillMissingResults?: boolean;
    useCache?: boolean;
    bypassExternal?: boolean;
    timeoutMs?: number;
    projectId?: string;
}

export interface ValidationMetrics {
    cache_hits: number;
    cache_misses: number;
    validation_start: number;
    validation_end: number;
    parallel_validations: boolean;
}

// Shared validation orchestrator function
export async function validatePayload(
    payload: ValidationPayload,
    redis?: any,
    pool?: any,
    options: ValidationOrchestratorOptions = {}
): Promise<{ results: any; metrics: ValidationMetrics; debug_info: any }> {
    // const startTime = performance.now(); // Currently not used, reserved for future performance tracking

    const {
        // mode = 'live', // Currently not used, reserved for future use
        fillMissingResults = false,
        useCache = true,
        // bypassExternal = false, // Currently not used, reserved for future use
        // timeoutMs = 30000, // Currently not used, reserved for future use
        projectId = 'default'
    } = options;
    const metrics: ValidationMetrics = {
        cache_hits: 0,
        cache_misses: 0,
        validation_start: 0,
        validation_end: 0,
        parallel_validations: true
    };

    const debug_info: any = {
        validation_providers_used: [],
        errors: [],
        warnings: []
    };

    const results: any = {};

    // Initialize validation promises for parallel execution
    const validationPromises: Promise<any>[] = [];

    // Email validation
    if (payload.email) {
        const emailPromise = (async () => {
            try {
                if (useCache && redis) {
                    const cacheKey = ValidationCacheManager.generateKey('email', payload.email!, projectId);
                    const cached = await ValidationCacheManager.get(redis, cacheKey);
                    if (cached) {
                        metrics.cache_hits++;
                        results.email = cached;
                        return;
                    } else {
                        metrics.cache_misses++;
                    }
                }

                const emailResult = await validateEmail(payload.email!, redis);
                const enhancedResult = buildEnhancedEmailValidationResult(emailResult);
                results.email = enhancedResult;

                if (useCache && redis) {
                    const cacheKey = ValidationCacheManager.generateKey('email', payload.email!, projectId);
                    await ValidationCacheManager.set(redis, cacheKey, enhancedResult);
                }

                debug_info.validation_providers_used.push('email');
            } catch (error) {
                debug_info.errors.push({ field: 'email', error: error instanceof Error ? error.message : 'Unknown error' });
                results.email = {
                    valid: false,
                    confidence: 0,
                    reason_codes: ['EMAIL_VALIDATION_ERROR'],
                    risk_score: 30,
                    processing_time_ms: 0,
                    provider: 'error',
                    disposable: false,
                    metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
                };
            }
        })();
        validationPromises.push(emailPromise);
    } else if (fillMissingResults) {
        results.email = {
            valid: false,
            confidence: 0,
            reason_codes: ['NO_EMAIL_PROVIDED'],
            risk_score: 0,
            processing_time_ms: 0,
            provider: 'none',
            disposable: false,
            metadata: {}
        };
    }

    // Phone validation - run in parallel
    if (payload.phone) {
        const phonePromise = (async () => {
            try {
                if (useCache && redis) {
                    const cacheKey = ValidationCacheManager.generateKey('phone', payload.phone!, projectId);
                    const cached = await ValidationCacheManager.get(redis, cacheKey);
                    if (cached) {
                        metrics.cache_hits++;
                        results.phone = cached;
                        return;
                    } else {
                        metrics.cache_misses++;
                    }
                }

                const phoneCountry = payload.address?.country || 'US';
                const phoneResult = await validatePhone(payload.phone!, phoneCountry, redis);
                const enhancedResult = buildEnhancedPhoneValidationResult(phoneResult);
                results.phone = enhancedResult;

                if (useCache && redis) {
                    const cacheKey = ValidationCacheManager.generateKey('phone', payload.phone!, projectId);
                    await ValidationCacheManager.set(redis, cacheKey, enhancedResult);
                }

                debug_info.validation_providers_used.push('phone');
            } catch (error) {
                debug_info.errors.push({ field: 'phone', error: error instanceof Error ? error.message : 'Unknown error' });
                results.phone = {
                    valid: false,
                    confidence: 0,
                    reason_codes: ['PHONE_VALIDATION_ERROR'],
                    risk_score: 30,
                    processing_time_ms: 0,
                    provider: 'error',
                    metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
                };
            }
        })();
        validationPromises.push(phonePromise);
    } else if (fillMissingResults) {
        results.phone = {
            valid: false,
            confidence: 0,
            reason_codes: ['NO_PHONE_PROVIDED'],
            risk_score: 0,
            processing_time_ms: 0,
            provider: 'none',
            metadata: {}
        };
    }

    // Address validation - run in parallel
    if (payload.address) {
        const hasRequiredFields = payload.address.line1 && payload.address.city && payload.address.postal_code && payload.address.country;

        if (hasRequiredFields) {
            const addressPromise = (async () => {
                try {
                    if (useCache && redis) {
                        const addressString = JSON.stringify(payload.address);
                        const cacheKey = ValidationCacheManager.generateKey('address', addressString, projectId);
                        const cached = await ValidationCacheManager.get(redis, cacheKey);
                        if (cached) {
                            metrics.cache_hits++;
                            results.address = cached;
                            return;
                        } else {
                            metrics.cache_misses++;
                        }
                    }

                    const addressResult = await validateAddress(payload.address as any, pool, redis);
                    const enhancedResult = buildEnhancedAddressValidationResult(addressResult, payload.address);
                    results.address = enhancedResult;

                    if (useCache && redis) {
                        const addressString = JSON.stringify(payload.address);
                        const cacheKey = ValidationCacheManager.generateKey('address', addressString, projectId);
                        await ValidationCacheManager.set(redis, cacheKey, enhancedResult);
                    }

                    debug_info.validation_providers_used.push('address');
                } catch (error) {
                    debug_info.errors.push({ field: 'address', error: error instanceof Error ? error.message : 'Unknown error' });
                    results.address = {
                        valid: false,
                        confidence: 0,
                        reason_codes: ['ADDRESS_VALIDATION_ERROR'],
                        risk_score: 35,
                        processing_time_ms: 0,
                        provider: 'error',
                        metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
                    };
                }
            })();
            validationPromises.push(addressPromise);
        } else if (fillMissingResults) {
            results.address = {
                valid: false,
                confidence: 0,
                reason_codes: ['INCOMPLETE_ADDRESS_DATA'],
                risk_score: 20,
                processing_time_ms: 0,
                provider: 'none',
                metadata: { message: 'Address validation skipped due to incomplete data' }
            };
        }
    } else if (fillMissingResults) {
        results.address = {
            valid: false,
            confidence: 0,
            reason_codes: ['NO_ADDRESS_PROVIDED'],
            risk_score: 0,
            processing_time_ms: 0,
            provider: 'none',
            metadata: {}
        };
    }

    // Name validation (synchronous, but can be part of the flow)
    if (payload.name) {
        try {
            const nameResult = validateName(payload.name);
            results.name = buildEnhancedNameValidationResult(nameResult);
            debug_info.validation_providers_used.push('name');
        } catch (error) {
            debug_info.errors.push({ field: 'name', error: error instanceof Error ? error.message : 'Unknown error' });
        }
    } else if (fillMissingResults) {
        results.name = {
            valid: false,
            confidence: 0,
            reason_codes: ['NO_NAME_PROVIDED'],
            risk_score: 5,
            processing_time_ms: 0,
            provider: 'none',
            metadata: {}
        };
    }

    // IP validation (if provided)
    if (payload.ip) {
        try {
            results.ip = await validateIP(payload.ip, redis);
            debug_info.validation_providers_used.push('ip');
        } catch (error) {
            debug_info.errors.push({ field: 'ip', error: error instanceof Error ? error.message : 'Unknown error' });
        }
    } else if (fillMissingResults) {
        results.ip = {
            valid: false,
            confidence: 0,
            reason_codes: ['NO_IP_PROVIDED'],
            risk_score: 0,
            processing_time_ms: 0,
            provider: 'none',
            metadata: {}
        };
    }

    // Device validation (if user_agent provided)
    if (payload.user_agent) {
        try {
            results.device = await validateDevice(payload.user_agent, redis);
            debug_info.validation_providers_used.push('device');
        } catch (error) {
            debug_info.errors.push({ field: 'device', error: error instanceof Error ? error.message : 'Unknown error' });
        }
    } else if (fillMissingResults) {
        results.device = {
            valid: false,
            confidence: 0,
            reason_codes: ['NO_DEVICE_PROVIDED'],
            risk_score: 0,
            processing_time_ms: 0,
            provider: 'none',
            metadata: {}
        };
    }

    // Wait for all validations to complete
    metrics.validation_start = performance.now();
    if (validationPromises.length > 0) {
        await Promise.allSettled(validationPromises);
    }
    metrics.validation_end = performance.now();

    return { results, metrics, debug_info };
}

// Placeholder functions for additional validations (implement as needed)
export async function validateIP(ip: string, redis?: any): Promise<any> {
    // Check cache first if redis is available
    if (redis) {
        try {
            const cacheKey = `ip_validation:${ip}`;
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (error) {
            // Continue with validation if cache fails
        }
    }

    // Implement IP validation logic
    const result = {
        valid: true,
        confidence: 80,
        reason_codes: [],
        risk_score: 0,
        processing_time_ms: 10,
        provider: 'ipapi',
        country: 'US',
        region: 'CA',
        city: 'San Francisco',
        is_vpn: false,
        is_proxy: false,
        is_tor: false,
        is_datacenter: false,
        asn: 'AS15169',
        org: 'Google LLC',
        metadata: {
            checked_at: new Date().toISOString()
        }
    };

    // Cache the result if redis is available
    if (redis) {
        try {
            const cacheKey = `ip_validation:${ip}`;
            await redis.setex(cacheKey, 3600, JSON.stringify(result)); // Cache for 1 hour
        } catch (error) {
            // Don't fail if caching fails
        }
    }

    return result;
}

export async function validateDevice(userAgent: string, redis?: any): Promise<any> {
    // Check cache first if redis is available
    if (redis) {
        try {
            const fingerprint = crypto.createHash('md5').update(userAgent).digest('hex');
            const cacheKey = `device_validation:${fingerprint}`;
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (error) {
            // Continue with validation if cache fails
        }
    }

    // Implement device validation logic
    const fingerprint = crypto.createHash('md5').update(userAgent).digest('hex');
    const result = {
        valid: true,
        confidence: 75,
        reason_codes: [],
        risk_score: 0,
        processing_time_ms: 5,
        provider: 'internal',
        type: 'desktop',
        os: 'Windows 10',
        browser: 'Chrome',
        is_bot: false,
        fingerprint,
        metadata: {
            checked_at: new Date().toISOString()
        }
    };

    // Cache the result if redis is available
    if (redis) {
        try {
            const cacheKey = `device_validation:${fingerprint}`;
            await redis.setex(cacheKey, 3600, JSON.stringify(result)); // Cache for 1 hour
        } catch (error) {
            // Don't fail if caching fails
        }
    }

    return result;
}