import crypto from 'crypto';
import { performance } from 'perf_hooks';




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
        // clone non-function data
        const enhancedContext = JSON.parse(JSON.stringify(context));

        // restore functions lost by JSON clone
        if (typeof context.riskLevel === 'function') {
            enhancedContext.riskLevel = context.riskLevel;
        }
        if (typeof context.addressHasIssue === 'function') {
            enhancedContext.addressHasIssue = context.addressHasIssue;
        }

        // lift metadata-derived fields into the top-level structures
        if (enhancedContext.email?.metadata?.domain) {
            enhancedContext.email.domain = enhancedContext.email.metadata.domain;
        }
        if (enhancedContext.phone?.metadata) {
            enhancedContext.phone = { ...(enhancedContext.phone || {}), ...enhancedContext.phone.metadata };
        }
        if (enhancedContext.address?.metadata) {
            enhancedContext.address = { ...(enhancedContext.address || {}), ...enhancedContext.address.metadata };
        }

        // sensible defaults if not provided by the handler
        if (!enhancedContext.addressHasIssue) {
            enhancedContext.addressHasIssue = (value: any) => value && value.valid === false;
        }
        if (!enhancedContext.riskLevel) {
            enhancedContext.riskLevel = (level: string) => level === 'critical' || level === 'high';
        }

        const helpers = {
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
            emailFormatInvalid: (value: any) => {
                if (!value) return false;
                if (typeof value === 'string') {
                    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    return !emailPattern.test(value);
                }
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
            Math,
            parseInt,
            parseFloat,
            Date,
            now: () => new Date(),
        };

        // Important: helpers first, then enhancedContext so the handler-provided functions win
        return { ...helpers, ...enhancedContext };
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

            // PO Box adds risk
            if (address.po_box) {
                totalScore += this.RISK_FACTORS.address.po_box;
                factors.push('PO Box address');
            }

            // Normalize reason codes and detect specific issues
            const reasonCodes = (address.reason_codes || []).map((c: string) => String(c).toLowerCase());
            const isPostalMismatch =
                reasonCodes.some((code: string) =>
                    code.includes('postal_city_mismatch') ||
                    (code.includes('postal') && code.includes('mismatch'))
                );
            const isGeoOutOfBounds =
                reasonCodes.some((code: string) => code.includes('geo_out_of_bounds'));
            const isGeocodeFailed =
                reasonCodes.some((code: string) =>
                    code.includes('geocode_failed') ||
                    (code.includes('geocode') && code.includes('fail'))
                );

            // Apply moderated penalties for specific issues, avoid double-counting generic "invalid"
            let appliedSpecificAddressIssue = false;

            if (isPostalMismatch) {
                totalScore += 15; // medium-light
                factors.push('Address postal/city mismatch');
                appliedSpecificAddressIssue = true;
            }
            if (isGeoOutOfBounds) {
                totalScore += 10; // light
                factors.push('Address geolocation mismatch');
                appliedSpecificAddressIssue = true;
            }
            if (isGeocodeFailed) {
                totalScore += 10; // light
                factors.push('Address geocoding failed');
                appliedSpecificAddressIssue = true;
            }

            if (!appliedSpecificAddressIssue && address.valid === false) {
                totalScore += this.RISK_FACTORS.address.invalid;
                factors.push('Invalid address');
            }

            // Soften deliverability penalty when provider is heuristic (e.g., 'internal' in tests)
            if (address.deliverable === false) {
                const provider = String(address.provider || '').toLowerCase();
                const heuristic = provider === 'internal' || provider === 'none';
                totalScore += heuristic ? 10 : this.RISK_FACTORS.address.non_deliverable;
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
