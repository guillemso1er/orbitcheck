import crypto from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

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
        'idempotency-key': { type: 'string' }
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
    const response: ErrorResponse = { error: { code: 'server_error', message: 'Internal server error' } };
    if (requestId) {
        response.request_id = requestId;
    }
    return rep.status(500).send(response);
}