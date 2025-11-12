/**
 * Enhanced error handling utilities to prevent sensitive information leakage
 */

import type { FastifyReply, RawServerBase, RouteGenericInterface } from 'fastify';

export class ErrorHandler {
    /**
     * Sanitizes error messages for client responses
     */
    static sanitizeErrorMessage(error: any): string {
        if (!error) return 'An unexpected error occurred';

        // Remove sensitive patterns from error messages
        const message = typeof error.message === 'string' ? error.message : 'An unexpected error occurred';

        // Remove file paths, stack traces, and sensitive data from messages
        return message
            .replace(/\/[^\s]+/g, '[PATH]') // Replace file paths
            .replace(/\b\d{4,}\b/g, '[REDACTED]') // Replace long numbers (potential IDs/keys)
            .replace(/\b[A-Za-z0-9+/=]{32,}\b/g, '[REDACTED]') // Replace base64 strings
            .replace(/password|token|key|secret/gi, '[REDACTED]') // Replace sensitive keywords
            .substring(0, 200); // Limit message length
    }

    /**
     * Creates a safe error response object
     */
    static createSafeErrorResponse(error: any, includeCode = false): { error: { code: string; message: string } } {
        const message = this.sanitizeErrorMessage(error);

        if (includeCode && typeof error.code === 'string' && error.code.length < 50) {
            return { error: { code: error.code, message } };
        }

        return { error: { code: 'invalid_input', message } };
    }

    /**
     * Determines if an error is safe to expose details about
     */
    static isSafeToExpose(error: any): boolean {
        if (!error) return false;

        // Validation errors are generally safe to expose
        if (error.code === 'VALIDATION_ERROR' || error.statusCode === 400) {
            return true;
        }

        // Authentication errors are safe
        if (error.code === 'UNAUTHORIZED' || error.statusCode === 401) {
            return true;
        }

        // Rate limit errors are safe
        if (error.code === 'RATE_LIMIT_EXCEEDED' || error.statusCode === 429) {
            return true;
        }

        return false;
    }

    /**
     * Logs error details securely (without sensitive data)
     */
    static logErrorSecurely(logger: any, error: any, context: any = {}) {
        if (!logger) return;

        const safeError = {
            name: error?.name,
            message: this.sanitizeErrorMessage(error),
            code: error?.code,
            statusCode: error?.statusCode,
            stack: error?.stack ? '[REDACTED]' : undefined
        };

        // Remove any potentially sensitive context data
        const safeContext = { ...context };
        delete safeContext.password;
        delete safeContext.token;
        delete safeContext.apiKey;
        delete safeContext.secret;
        delete safeContext.privateKey;

        logger.error({ err: safeError, ...safeContext }, 'Application error');
    }

    /**
     * Handles database errors safely
     */
    static handleDatabaseError<TServer extends RawServerBase = RawServerBase>(reply: FastifyReply<RouteGenericInterface, TServer>, error: any, operation: string) {
        // Log the full error for debugging
        console.error(`Database error in ${operation}:`, {
            code: error?.code,
            message: error?.message,
            severity: error?.severity,
            detail: error?.detail
        });

        // Check for specific database error codes
        if (error?.code === '23505') { // unique_violation
            return reply.status(409).send({
                error: { code: 'conflict', message: 'Resource already exists' }
            });
        }

        if (error?.code === '23503') { // foreign_key_violation
            return reply.status(400).send({
                error: { code: 'invalid_reference', message: 'Invalid reference to related resource' }
            });
        }

        if (error?.code === '23502') { // not_null_violation
            return reply.status(400).send({
                error: { code: 'missing_required_field', message: 'Required field is missing' }
            });
        }

        // Generic database error
        return reply.status(500).send({
            error: { code: 'database_error', message: 'A database error occurred' }
        });
    }

    /**
     * Handles external service errors safely
     */
    static handleExternalServiceError<TServer extends RawServerBase = RawServerBase>(reply: FastifyReply<RouteGenericInterface, TServer>, error: any, serviceName: string) {
        // Log error details for debugging
        console.error(`External service error (${serviceName}):`, {
            message: error?.message,
            status: error?.status,
            statusText: error?.statusText
        });

        // Don't expose external service details to clients
        return reply.status(502).send({
            error: { code: 'external_service_error', message: 'An external service is currently unavailable' }
        });
    }
}