import crypto from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { PROJECT_NAMES } from "../config.js";
import { ERROR_CODES, ERROR_MESSAGES } from "../errors.js";


export const errorSchema = {
    type: 'object',
    properties: {
        error: {
            type: 'object',
            properties: {
                code: { type: 'string' },
                message: { type: 'string' }
            }
        }
    }
};

export const securityHeader = {
    type: 'object',
    properties: {
        'idempotency-key': { type: 'string' },
    }
};

// For runtime routes that require API key auth
export const runtimeSecurityHeader = {
    type: 'object',
    properties: {
        'idempotency-key': { type: 'string' },
    }
};

export const unauthorizedResponse = { 401: { description: 'Unauthorized', ...errorSchema } };
export const rateLimitResponse = { 429: { description: 'Rate Limit Exceeded', ...errorSchema } };
export const validationErrorResponse = { 400: { description: 'Validation Error', ...errorSchema } };

// Security schemas for different route types
export const API_V1_SECURITY: readonly { readonly [key: string]: readonly string[] }[] = [
    { ApiKeyAuth: [] },
    { BearerAuth: [] }
];

export const MGMT_V1_SECURITY: readonly { readonly [key: string]: readonly string[] }[] = [{ BearerAuth: [] }];

export function generateRequestId(): string {
    return crypto.randomUUID();
}

export type ErrorResponse = {
    error: {
        code: string;
        message: string;
    };
    request_id?: string;
};

export function sendError(rep: FastifyReply, code: number, errorCode: string, message: string, requestId?: string): FastifyReply {
    const response: ErrorResponse = { error: { code: errorCode, message } };
    if (requestId) {
        response.request_id = requestId;
    }
    return rep.status(code).send(response);
}

export function sendServerError(request: FastifyRequest, rep: FastifyReply, error: unknown, endpoint: string, requestId?: string): FastifyReply {
    if (request.log) {
        request.log.error(error, `${endpoint} error`);
    }
    const response: ErrorResponse = { error: { code: ERROR_CODES.SERVER_ERROR, message: ERROR_MESSAGES[ERROR_CODES.SERVER_ERROR] } };
    if (requestId) {
        response.request_id = requestId;
    }
    return rep.status(500).send(response);
}

export function buildValidationResult(result: { valid: boolean; reason_codes: string[] }, additionalFields: Record<string, any> = {}): { valid: boolean; reason_codes: string[] } & Record<string, any> {
    return {
        valid: result.valid,
        reason_codes: result.reason_codes,
        ...additionalFields,
    };
}

// Deprecated: Use buildValidationResult instead
export function buildEmailValidationResult(result: { valid: boolean; reason_codes: string[]; normalized: string; disposable: boolean }): ReturnType<typeof buildValidationResult> {
    return buildValidationResult(result, {
        normalized: result.normalized,
        disposable: result.disposable,
    });
}

// Deprecated: Use buildValidationResult instead
export function buildPhoneValidationResult(result: { valid: boolean; reason_codes: string[]; e164: string; country: string | null }): ReturnType<typeof buildValidationResult> {
    return buildValidationResult(result, {
        e164: result.e164,
        country: result.country,
    });
}

// Deprecated: Use buildValidationResult instead
export function buildAddressValidationResult(result: { valid: boolean; reason_codes: string[]; normalized: any; po_box: boolean }): ReturnType<typeof buildValidationResult> {
    return buildValidationResult(result, {
        normalized: result.normalized,
        po_box: result.po_box,
    });
}

// Deprecated: Use buildValidationResult instead
export function buildNameValidationResult(result: { valid: boolean; reason_codes: string[]; normalized: string }): ReturnType<typeof buildValidationResult> {
    return buildValidationResult(result, {
        normalized: result.normalized,
    });
}

/**
 * Retrieves the default project ID for a given user.
 * @param pool - PostgreSQL connection pool
 * @param userId - User ID to get the default project for
 * @returns Promise resolving to the project ID string
 * @throws Error if no default project is found
 */
export async function getDefaultProjectId(pool: Pool, userId: string): Promise<string> {
    const { rows } = await pool.query(
        'SELECT p.id as project_id FROM projects p WHERE p.user_id = $1 AND p.name = $2',
        [userId, PROJECT_NAMES.DEFAULT]
    );
    if (rows.length > 0) {
        return rows[0].project_id;
    }

    const { rows: fallbackRows } = await pool.query(
        'SELECT p.id as project_id FROM projects p WHERE p.user_id = $1 ORDER BY p.created_at ASC LIMIT 1',
        [userId]
    );

    if (fallbackRows.length === 0) {
        throw new Error('No default project found');
    }
    return fallbackRows[0].project_id;
}