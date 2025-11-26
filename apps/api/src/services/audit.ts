/**
 * Audit Logging Service for PCD Level 2 Compliance
 *
 * This service provides audit logging functionality to track data access events
 * for compliance with Shopify's Protected Customer Data (PCD) requirements.
 *
 * Key principles:
 * - Logs should NOT contain actual PII (names, emails, addresses, etc.)
 * - Logs should contain identifiers (user IDs, resource IDs, timestamps)
 * - Logs should capture what was accessed, when, and by whom
 */

import type { Pool } from 'pg';

/**
 * Audit log action types
 */
export const AUDIT_ACTIONS = {
    // Authentication & Authorization
    LOGIN: 'auth.login',
    LOGOUT: 'auth.logout',
    TOKEN_CREATED: 'auth.token_created',
    TOKEN_REVOKED: 'auth.token_revoked',
    SESSION_CREATED: 'auth.session_created',
    SESSION_EXPIRED: 'auth.session_expired',

    // Data Access
    DATA_READ: 'data.read',
    DATA_EXPORT: 'data.export',
    DATA_DELETE: 'data.delete',

    // Settings Changes
    SETTINGS_READ: 'settings.read',
    SETTINGS_UPDATE: 'settings.update',

    // Customer Data (GDPR)
    CUSTOMER_DATA_REQUEST: 'gdpr.customer_data_request',
    CUSTOMER_DATA_REDACT: 'gdpr.customer_data_redact',
    SHOP_DATA_REDACT: 'gdpr.shop_data_redact',

    // API Key Management
    API_KEY_CREATED: 'api_key.created',
    API_KEY_REVOKED: 'api_key.revoked',
    API_KEY_USED: 'api_key.used',

    // Validation Events
    VALIDATION_REQUEST: 'validation.request',
    ORDER_EVALUATED: 'order.evaluated',
} as const;

export type AuditAction = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS];

/**
 * Audit log resource types
 */
export const AUDIT_RESOURCES = {
    USER: 'user',
    PROJECT: 'project',
    API_KEY: 'api_key',
    CUSTOMER: 'customer',
    ORDER: 'order',
    SHOP: 'shop',
    SETTINGS: 'settings',
    SESSION: 'session',
    TOKEN: 'token',
    LOG: 'log',
} as const;

export type AuditResource = typeof AUDIT_RESOURCES[keyof typeof AUDIT_RESOURCES];

/**
 * Audit log entry data structure
 * Note: Details should NEVER contain actual PII
 */
export interface AuditLogEntry {
    userId: string;
    action: AuditAction;
    resource: AuditResource;
    details?: {
        /** Resource identifier (NOT the actual resource data) */
        resourceId?: string;
        /** Project associated with the action */
        projectId?: string;
        /** Shop domain (if Shopify-related) */
        shopDomain?: string;
        /** IP address of the request (hashed or partial for privacy) */
        ipHash?: string;
        /** User agent (sanitized) */
        userAgent?: string;
        /** Additional non-PII context */
        context?: Record<string, string | number | boolean | null>;
        /** Result of the action */
        result?: 'success' | 'failure' | 'denied';
        /** Error code if action failed */
        errorCode?: string;
    };
}

/**
 * Query result for audit log entries
 */
export interface AuditLogQueryResult {
    id: string;
    user_id: string;
    action: string;
    resource: string;
    details: Record<string, unknown> | null;
    created_at: Date;
}

/**
 * Audit logging service class
 */
export class AuditService {
    constructor(private pool: Pool) { }

    /**
     * Log an audit event
     *
     * @param entry - Audit log entry (should NOT contain PII)
     */
    async log(entry: AuditLogEntry): Promise<void> {
        try {
            await this.pool.query(
                `INSERT INTO audit_logs (user_id, action, resource, details, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
                [
                    entry.userId,
                    entry.action,
                    entry.resource,
                    entry.details ? JSON.stringify(entry.details) : null,
                ]
            );
        } catch (error) {
            // Log error but don't throw - audit logging should not break the main flow
            console.error('[AuditService] Failed to log audit event:', {
                action: entry.action,
                resource: entry.resource,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * Log a data access event
     */
    async logDataAccess(
        userId: string,
        resourceType: AuditResource,
        resourceId: string,
        options?: {
            projectId?: string;
            shopDomain?: string;
            result?: 'success' | 'failure' | 'denied';
        }
    ): Promise<void> {
        await this.log({
            userId,
            action: AUDIT_ACTIONS.DATA_READ,
            resource: resourceType,
            details: {
                resourceId,
                projectId: options?.projectId,
                shopDomain: options?.shopDomain,
                result: options?.result ?? 'success',
            },
        });
    }

    /**
     * Log a GDPR event
     */
    async logGdprEvent(
        shopDomain: string,
        action: 'customer_data_request' | 'customer_data_redact' | 'shop_data_redact',
        customerId?: string
    ): Promise<void> {
        // Generate a synthetic user ID for GDPR events (we may not have a user context)
        const systemUserId = '00000000-0000-0000-0000-000000000000';

        const actionMap = {
            customer_data_request: AUDIT_ACTIONS.CUSTOMER_DATA_REQUEST,
            customer_data_redact: AUDIT_ACTIONS.CUSTOMER_DATA_REDACT,
            shop_data_redact: AUDIT_ACTIONS.SHOP_DATA_REDACT,
        };

        await this.log({
            userId: systemUserId,
            action: actionMap[action],
            resource: action === 'shop_data_redact' ? AUDIT_RESOURCES.SHOP : AUDIT_RESOURCES.CUSTOMER,
            details: {
                shopDomain,
                resourceId: customerId,
                context: {
                    source: 'shopify_webhook',
                    compliance: 'gdpr',
                },
            },
        });
    }

    /**
     * Log an authentication event
     */
    async logAuthEvent(
        userId: string,
        action: 'login' | 'logout' | 'token_created' | 'token_revoked' | 'session_created',
        options?: {
            ipHash?: string;
            userAgent?: string;
            tokenId?: string;
            result?: 'success' | 'failure' | 'denied';
        }
    ): Promise<void> {
        const actionMap = {
            login: AUDIT_ACTIONS.LOGIN,
            logout: AUDIT_ACTIONS.LOGOUT,
            token_created: AUDIT_ACTIONS.TOKEN_CREATED,
            token_revoked: AUDIT_ACTIONS.TOKEN_REVOKED,
            session_created: AUDIT_ACTIONS.SESSION_CREATED,
        };

        await this.log({
            userId,
            action: actionMap[action],
            resource: action.includes('token') ? AUDIT_RESOURCES.TOKEN : AUDIT_RESOURCES.SESSION,
            details: {
                resourceId: options?.tokenId,
                ipHash: options?.ipHash,
                userAgent: options?.userAgent,
                result: options?.result ?? 'success',
            },
        });
    }

    /**
     * Log a settings change event
     */
    async logSettingsChange(
        userId: string,
        projectId: string,
        action: 'read' | 'update',
        changedFields?: string[]
    ): Promise<void> {
        await this.log({
            userId,
            action: action === 'read' ? AUDIT_ACTIONS.SETTINGS_READ : AUDIT_ACTIONS.SETTINGS_UPDATE,
            resource: AUDIT_RESOURCES.SETTINGS,
            details: {
                projectId,
                context: changedFields ? { changed_fields: changedFields.join(',') } : undefined,
            },
        });
    }

    /**
     * Log an API key event
     */
    async logApiKeyEvent(
        userId: string,
        action: 'created' | 'revoked' | 'used',
        keyId: string,
        projectId?: string
    ): Promise<void> {
        const actionMap = {
            created: AUDIT_ACTIONS.API_KEY_CREATED,
            revoked: AUDIT_ACTIONS.API_KEY_REVOKED,
            used: AUDIT_ACTIONS.API_KEY_USED,
        };

        await this.log({
            userId,
            action: actionMap[action],
            resource: AUDIT_RESOURCES.API_KEY,
            details: {
                resourceId: keyId,
                projectId,
            },
        });
    }

    /**
     * Query audit logs for a user
     */
    async getLogsForUser(
        userId: string,
        options?: {
            limit?: number;
            offset?: number;
            startDate?: Date;
            endDate?: Date;
            action?: AuditAction;
            resource?: AuditResource;
        }
    ): Promise<AuditLogQueryResult[]> {
        const params: unknown[] = [userId];
        let paramIndex = 2;
        const conditions = ['user_id = $1'];

        if (options?.startDate) {
            conditions.push(`created_at >= $${paramIndex++}`);
            params.push(options.startDate);
        }

        if (options?.endDate) {
            conditions.push(`created_at <= $${paramIndex++}`);
            params.push(options.endDate);
        }

        if (options?.action) {
            conditions.push(`action = $${paramIndex++}`);
            params.push(options.action);
        }

        if (options?.resource) {
            conditions.push(`resource = $${paramIndex++}`);
            params.push(options.resource);
        }

        const limit = Math.min(options?.limit ?? 100, 1000);
        const offset = options?.offset ?? 0;

        params.push(limit, offset);

        const query = `
      SELECT id, user_id, action, resource, details, created_at
      FROM audit_logs
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;

        const result = await this.pool.query(query, params);
        return result.rows;
    }

    /**
     * Count audit logs for a user
     */
    async countLogsForUser(
        userId: string,
        options?: {
            startDate?: Date;
            endDate?: Date;
            action?: AuditAction;
            resource?: AuditResource;
        }
    ): Promise<number> {
        const params: unknown[] = [userId];
        let paramIndex = 2;
        const conditions = ['user_id = $1'];

        if (options?.startDate) {
            conditions.push(`created_at >= $${paramIndex++}`);
            params.push(options.startDate);
        }

        if (options?.endDate) {
            conditions.push(`created_at <= $${paramIndex++}`);
            params.push(options.endDate);
        }

        if (options?.action) {
            conditions.push(`action = $${paramIndex++}`);
            params.push(options.action);
        }

        if (options?.resource) {
            conditions.push(`resource = $${paramIndex++}`);
            params.push(options.resource);
        }

        const query = `
      SELECT COUNT(*) as count
      FROM audit_logs
      WHERE ${conditions.join(' AND ')}
    `;

        const result = await this.pool.query(query, params);
        return parseInt(result.rows[0].count, 10);
    }
}

/**
 * Create an audit service instance
 */
export function createAuditService(pool: Pool): AuditService {
    return new AuditService(pool);
}

/**
 * Hash an IP address for privacy-preserving logging
 * Returns a truncated hash that preserves some utility for analysis
 */
export function hashIpForAudit(ip: string): string {
    // Use a simple hash for IP addresses
    // In production, consider using a proper cryptographic hash
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(ip).digest('hex');
    return hash.substring(0, 16); // Return first 16 chars of hash
}

/**
 * Sanitize user agent for audit logging
 * Removes potentially identifying information while preserving useful metadata
 */
export function sanitizeUserAgent(userAgent: string | undefined): string | undefined {
    if (!userAgent) return undefined;

    // Truncate to reasonable length
    const truncated = userAgent.substring(0, 256);

    // Remove potential PII patterns (emails, phone numbers, etc.)
    return truncated
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
        .replace(/\+?[0-9]{10,}/g, '[PHONE]');
}
