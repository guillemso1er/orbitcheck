// FILE: rules.constants.ts

import { ERROR_CODE_DESCRIPTIONS } from "../../errors.js";
import { REASON_CODES } from "../../validation.js";

/**
 * A catalog of reason codes with descriptions, categories, and severity levels.
 */
export const reasonCodes: any[] = Object.entries(REASON_CODES).map(([_key, code]) => {
    const descriptions: Record<string, { description: string, category: string, severity: 'low' | 'medium' | 'high' }> = {
        [REASON_CODES.EMAIL_INVALID_FORMAT]: { description: 'Invalid email format', category: 'email', severity: 'low' },
        [REASON_CODES.EMAIL_MX_NOT_FOUND]: { description: 'No MX records found for domain', category: 'email', severity: 'medium' },
        [REASON_CODES.EMAIL_DISPOSABLE_DOMAIN]: { description: 'Disposable email domain detected', category: 'email', severity: 'high' },
        [REASON_CODES.EMAIL_SERVER_ERROR]: { description: 'Server error during validation', category: 'email', severity: 'high' },
        [REASON_CODES.PHONE_INVALID_FORMAT]: { description: 'Invalid phone number format', category: 'phone', severity: 'low' },
        [REASON_CODES.PHONE_UNPARSEABLE]: { description: 'Phone number could not be parsed', category: 'phone', severity: 'medium' },
        [REASON_CODES.PHONE_OTP_SENT]: { description: 'OTP sent successfully', category: 'phone', severity: 'low' },
        [REASON_CODES.PHONE_OTP_SEND_FAILED]: { description: 'Failed to send OTP', category: 'phone', severity: 'high' },
        [REASON_CODES.ADDRESS_PO_BOX]: { description: 'P.O. Box detected', category: 'address', severity: 'high' },
        [REASON_CODES.ADDRESS_POSTAL_CITY_MISMATCH]: { description: 'Postal code does not match city', category: 'address', severity: 'medium' },
        [REASON_CODES.ADDRESS_GEO_OUT_OF_BOUNDS]: { description: 'Address geocoded outside expected bounds', category: 'address', severity: 'high' },
        [REASON_CODES.ADDRESS_GEOCODE_FAILED]: { description: 'Failed to geocode address', category: 'address', severity: 'medium' },
        [REASON_CODES.TAXID_INVALID_FORMAT]: { description: 'Invalid tax ID format', category: 'taxid', severity: 'low' },
        [REASON_CODES.TAXID_INVALID_CHECKSUM]: { description: 'Invalid tax ID checksum', category: 'taxid', severity: 'medium' },
        [REASON_CODES.TAXID_VIES_INVALID]: { description: 'VAT number invalid per VIES', category: 'taxid', severity: 'high' },
        [REASON_CODES.TAXID_VIES_UNAVAILABLE]: { description: 'VIES service unavailable', category: 'taxid', severity: 'medium' },
        [REASON_CODES.ORDER_CUSTOMER_DEDUPE_MATCH]: { description: 'Potential duplicate customer detected', category: 'order', severity: 'medium' },
        [REASON_CODES.ORDER_ADDRESS_DEDUPE_MATCH]: { description: 'Potential duplicate address detected', category: 'order', severity: 'medium' },
        [REASON_CODES.ORDER_PO_BOX_BLOCK]: { description: 'Order blocked due to P.O. Box', category: 'order', severity: 'high' },
        [REASON_CODES.ORDER_ADDRESS_MISMATCH]: { description: 'Address validation mismatch', category: 'order', severity: 'medium' },
        [REASON_CODES.ORDER_GEO_OUT_OF_BOUNDS]: { description: 'Order address geocoded outside bounds', category: 'order', severity: 'high' },
        [REASON_CODES.ORDER_GEOCODE_FAILED]: { description: 'Failed to geocode order address', category: 'order', severity: 'medium' },
        [REASON_CODES.ORDER_INVALID_ADDRESS]: { description: 'Invalid address in order', category: 'order', severity: 'medium' },
        [REASON_CODES.ORDER_DISPOSABLE_EMAIL]: { description: 'Disposable email in order', category: 'order', severity: 'high' },
        [REASON_CODES.ORDER_INVALID_PHONE]: { description: 'Invalid phone in order', category: 'order', severity: 'medium' },
        [REASON_CODES.ORDER_DUPLICATE_DETECTED]: { description: 'Duplicate order detected', category: 'order', severity: 'high' },
        [REASON_CODES.ORDER_COD_RISK]: { description: 'Increased risk due to COD payment', category: 'order', severity: 'medium' },
        [REASON_CODES.ORDER_HIGH_RISK_RTO]: { description: 'High risk return-to-origin detected', category: 'order', severity: 'high' },
        [REASON_CODES.ORDER_HIGH_VALUE]: { description: 'High value order flagged', category: 'order', severity: 'low' },
        [REASON_CODES.ORDER_INVALID_EMAIL]: { description: 'Invalid email in order', category: 'order', severity: 'medium' },
        [REASON_CODES.ORDER_HOLD_FOR_REVIEW]: { description: 'Order held for manual review', category: 'order', severity: 'medium' },
        [REASON_CODES.ORDER_SERVER_ERROR]: { description: 'Server error during order evaluation', category: 'order', severity: 'high' },
        [REASON_CODES.DEDUP_SERVER_ERROR]: { description: 'Server error during deduplication', category: 'dedupe', severity: 'high' },
        [REASON_CODES.WEBHOOK_SEND_FAILED]: { description: 'Failed to send webhook', category: 'webhook', severity: 'high' },
    };
    const desc = descriptions[code];
    return { code, description: desc ? desc.description : 'Unknown reason code', category: desc ? desc.category : 'unknown', severity: desc ? desc.severity : 'medium' };
});

/**
 * A catalog of error codes with descriptions, categories, and severity levels.
 */
export const errorCodes: any[] = Object.entries(ERROR_CODE_DESCRIPTIONS).map(([code, desc]) => ({
    code,
    description: desc.description,
    category: desc.category,
    severity: desc.severity,
}));

/**
 * Converts a JSON-based condition object into a logical string for evaluation.
 * @param conditions The conditions object.
 * @returns A string representing the logic.
 */
export function convertConditionsToLogic(conditions: any): string {
    if (!conditions) return '';

    // handle logical groups first
    if (conditions.AND) {
        const parts = conditions.AND.map((c: any) => convertConditionsToLogic(c)).filter(Boolean);
        return parts.length ? `(${parts.join(' && ')})` : '';
    }
    if (conditions.OR) {
        const parts = conditions.OR.map((c: any) => convertConditionsToLogic(c)).filter(Boolean);
        return parts.length ? `(${parts.join(' || ')})` : '';
    }

    const parts: string[] = [];

    // transaction
    if (conditions.transaction_amount?.gte !== undefined) {
        parts.push(`transaction_amount >= ${Number(conditions.transaction_amount.gte)}`);
    }

    // email conditions
    if (conditions.email) {
        const e = conditions.email;
        if ('valid' in e) parts.push(`email && email.valid === ${e.valid ? 'true' : 'false'}`);
        if ('disposable' in e) parts.push(`email && email.disposable === ${e.disposable ? 'true' : 'false'}`);
        if ('free_provider' in e) parts.push(`email && email.free_provider === ${e.free_provider ? 'true' : 'false'}`);
        if ('role_account' in e) parts.push(`email && email.role_account === ${e.role_account ? 'true' : 'false'}`);
        if (e.domain?.in?.length) {
            const checks = e.domain.in.map((d: string) =>
                `email && email.normalized && email.normalized.toLowerCase().endsWith("@${String(d).toLowerCase()}")`
            );
            parts.push(`(${checks.join(' || ')})`);
        }
    }

    // phone conditions
    if (conditions.phone) {
        const p = conditions.phone;
        if ('valid' in p) parts.push(`phone && phone.valid === ${p.valid ? 'true' : 'false'}`);
    }

    if (parts.length) {
        return parts.length > 1 ? `(${parts.join(' && ')})` : parts[0];
    }

    // safe fallback: never auto-true
    return 'false';
}

/**
 * Infers a default rule action ('block', 'approve', 'hold') from the conditions.
 * @param conditions The conditions object.
 * @returns The inferred action or null.
 */
export function inferActionFromConditions(conditions: any): string | null {
    if (!conditions) return null;

    if (conditions.email?.disposable === true) return 'block';
    if (conditions.address?.po_box === true) return 'block';
    if (conditions.transaction_amount?.gte && conditions.transaction_amount.gte >= 10000) return 'block';

    if (conditions.email?.domain?.in) {
        const trustedDomains = ['microsoft.com', 'google.com', 'apple.com', 'amazon.com'];
        const hasTrustedDomain = conditions.email.domain.in.some((d: string) => trustedDomains.includes(d));
        if (hasTrustedDomain) return 'approve';
    }

    return 'hold';
}
type BuiltInOverride = Partial<{
    condition: string;
    action: 'block' | 'hold' | 'approve';
    priority: number;
    name: string;
    description: string;
    enabled: boolean;
}>;

let BUILTIN_RULE_OVERRIDES: Record<string, BuiltInOverride> = {};

export function registerBuiltInRuleOverride(id: string, override: BuiltInOverride) {
    BUILTIN_RULE_OVERRIDES[id] = { ...(BUILTIN_RULE_OVERRIDES[id] || {}), ...override };
}

export function clearBuiltInRuleOverrides(id?: string) {
    if (!id) {
        BUILTIN_RULE_OVERRIDES = {};
        return;
    }
    delete BUILTIN_RULE_OVERRIDES[id];
}
/**
 * Returns a list of hardcoded, built-in validation rules.
 */
export function getBuiltInRules() {
    const rules = [
        { id: 'email_format', name: 'Email Format Validation', description: 'Validates the basic format of email addresses using RFC standards.', category: 'email', enabled: true, condition: '(email && email.valid === false) || (emailString && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(emailString))', action: 'hold', priority: 10 },
        { id: 'email_mx', name: 'Email MX Record Check', description: 'Verifies that the domain has valid MX records for email delivery.', category: 'email', enabled: true, condition: 'email && email.mx_records === false', action: 'hold', priority: 8 },
        { id: 'email_disposable', name: 'Disposable Email Detection', description: 'Detects and flags temporary or disposable email services.', category: 'email', enabled: true, condition: 'email && email.disposable === true', action: 'block', priority: 15 },
        { id: 'po_box_detection', name: 'PO Box Detection', description: 'Identifies and flags addresses using PO Box or similar mail services.', category: 'address', enabled: true, condition: 'address && address.po_box === true', action: 'block', priority: 12 },
        { id: 'address_postal_mismatch', name: 'Address Postal Code Mismatch', description: 'Detects when postal code does not match city/region.', category: 'address', enabled: false, condition: 'addressHasIssue(address)', action: 'hold', priority: 9 },

        { id: 'order_dedupe', name: 'Order Deduplication', description: 'Checks for potential duplicate orders based on customer and address data.', category: 'order', enabled: true, condition: 'email && email.normalized && phoneString && address && name && session_id && transaction_amount', action: 'hold', priority: 14 },

        { id: 'high_value_order', name: 'High Value Order Risk', description: 'Evaluates high value orders for additional risk factors.', category: 'order', enabled: false, condition: 'transaction_amount > 1000', action: 'hold', priority: 11 },
        { id: 'high_value_customer_priority', name: 'High Value Customer Priority', description: 'Prioritizes high-value customers for faster processing.', category: 'order', enabled: false, condition: 'transaction_amount >= 1000 && transaction_amount < 10000 && email && email.valid && risk_score < 50', action: 'approve', priority: 8 },
        { id: 'critical_block_rule', name: 'Critical Block Rule', description: 'Blocks transactions with critical risk level.', category: 'risk', enabled: false, condition: 'riskLevel(risk_level)', action: 'block', priority: 20 },

        { id: 'custom_domain_block', name: 'Custom Domain Blocking', description: 'Blocks specific custom domains for business reasons.', category: 'custom', enabled: false, condition: 'email && email.normalized && (email.normalized.includes("@blockeddomain.com") || email.normalized.includes("@restricteddomain.org"))', action: 'block', priority: 18 },
        { id: 'phone_format', name: 'Phone Number Format Validation', description: 'Parses and validates international phone number formats.', category: 'phone', enabled: true, condition: 'phone && !phone.valid', action: 'hold', priority: 10 },
        { id: 'phone_otp', name: 'Phone OTP Verification', description: 'Sends one-time password for phone number verification.', category: 'phone', enabled: false, condition: 'phone && phone.valid && !phone.verified', action: 'hold', priority: 7 },
        { id: 'address_validation', name: 'Address Validation', description: 'Validates and normalizes physical addresses for accuracy and deliverability.', category: 'address', enabled: true, condition: 'address && !address.valid', action: 'hold', priority: 9 },
        { id: 'address_geocode', name: 'Address Geocoding Validation', description: 'Normalizes and validates physical addresses against geographic data.', category: 'address', enabled: true, condition: 'address && address.valid === false', action: 'hold', priority: 8 },

        { id: 'high_risk_address', name: 'High Risk Address Detection', description: 'Blocks or holds orders to high-risk addresses.', category: 'address', enabled: false, condition: 'address && address.risk_score > 90 && address.valid === false', action: 'hold', priority: 18 },

        { id: 'high_value_order_review', name: 'High Value Order Review', description: 'Flags high-value orders for additional review.', category: 'order', enabled: false, condition: 'transaction_amount && transaction_amount > 1000', action: 'hold', priority: 5 }
    ];

    // APPLY OVERRIDES
    return rules.map(r => {
        const o = BUILTIN_RULE_OVERRIDES[r.id];
        if (!o) return r;
        return {
            ...r,
            ...(o.name !== undefined ? { name: o.name } : {}),
            ...(o.description !== undefined ? { description: o.description } : {}),
            ...(o.priority !== undefined ? { priority: o.priority } : {}),
            ...(o.action !== undefined ? { action: o.action } : {}),
            ...(o.enabled !== undefined ? { enabled: o.enabled } : {}),
            ...(o.condition !== undefined ? { condition: o.condition } : {}),
        };
    });
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