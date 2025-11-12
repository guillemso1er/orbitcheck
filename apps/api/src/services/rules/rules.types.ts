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