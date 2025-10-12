import crypto from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS, PROJECT_NAMES } from "../constants.js";

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
        'authorization': { type: 'string' },
        'idempotency-key': { type: 'string' },
        'Idempotency-Key': { type: 'string' }
    },
    required: ['authorization']
};

export const unauthorizedResponse = { 401: { description: 'Unauthorized', ...errorSchema } };
export const rateLimitResponse = { 429: { description: 'Rate Limit Exceeded', ...errorSchema } };
export const validationErrorResponse = { 400: { description: 'Validation Error', ...errorSchema } };

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

export function buildValidationResult(result: { valid: boolean; reason_codes: string[] }, additionalFields: Record<string, any> = {}) {
    return {
        valid: result.valid,
        reason_codes: result.reason_codes,
        ...additionalFields,
    };
}

// Deprecated: Use buildValidationResult instead
export function buildEmailValidationResult(result: { valid: boolean; reason_codes: string[]; normalized: string; disposable: boolean }) {
    return buildValidationResult(result, {
        normalized: result.normalized,
        disposable: result.disposable,
    });
}

// Deprecated: Use buildValidationResult instead
export function buildPhoneValidationResult(result: { valid: boolean; reason_codes: string[]; e164: string; country: string | null }) {
    return buildValidationResult(result, {
        e164: result.e164,
        country: result.country,
    });
}

// Deprecated: Use buildValidationResult instead
export function buildAddressValidationResult(result: { valid: boolean; reason_codes: string[]; normalized: any; po_box: boolean }) {
    return buildValidationResult(result, {
        normalized: result.normalized,
        po_box: result.po_box,
    });
}

// Deprecated: Use buildValidationResult instead
export function buildNameValidationResult(result: { valid: boolean; reason_codes: string[]; normalized: string }) {
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
    if (rows.length === 0) {
        throw new Error('No default project found');
    }
    return rows[0].project_id;
}