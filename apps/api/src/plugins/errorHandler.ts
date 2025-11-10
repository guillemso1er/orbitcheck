import type { FastifyInstance, FastifyReply, FastifyRequest, RawServerBase, RouteGenericInterface } from "fastify";
import crypto from "node:crypto";

import { ErrorHandler } from "../utils/errorHandler.js";

/**
 * Sets up comprehensive error handling for the Fastify application.
 * Handles various error types with appropriate security measures and safe responses.
 */
export async function setupErrorHandler<TServer extends RawServerBase = RawServerBase>(app: FastifyInstance<TServer>): Promise<void> {
    // Enhanced error handler to prevent sensitive information leakage
    app.setErrorHandler(async (error: Error & { code?: string; statusCode?: number }, request: FastifyRequest<RouteGenericInterface, TServer>, reply: FastifyReply<RouteGenericInterface, TServer>) => {
        // Use the ErrorHandler utility for secure logging
        ErrorHandler.logErrorSecurely(request.log, error, {
            method: request.method,
            url: request.url,
            reqId: request.id,
            userId: (request as any).user_id,
            projectId: (request as any).project_id
        });

        // Handle specific error types with safe responses
        if (error.code === 'FST_ERR_REQUEST_TIMEOUT' || error.name === 'RequestTimeoutError') {
            return reply.status(503).send({ error: { code: 'timeout', message: 'Request timed out' } });
        }

        // Handle database errors with specialized handling
        if (error.code && typeof error.code === 'string' && (error.code.startsWith('42') || error.code.startsWith('23'))) {
            return ErrorHandler.handleDatabaseError(reply, error, 'request_handler');
        }

        // Handle unsupported media type errors
        if (error.statusCode === 415 || error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
            return reply.status(415).send({ error: { code: 'unsupported_media_type', message: 'Unsupported Media Type' } });
        }

        // Handle authentication errors
        if (error.statusCode === 401 || error.code === 'UNAUTHORIZED' || error.code === 'unauthorized' || error.code === 'FST_AUTH_NO_AUTH') {
            // If the error already has a properly formatted error object, use it
            const errorObj = (error as any).error;
            if (errorObj && typeof errorObj === 'object' && errorObj.code) {
                return reply.status(401).send({ error: errorObj });
            }
            return reply.status(401).send({ error: { code: 'unauthorized', message: error.message || 'Authentication required' } });
        }

        // Handle payload too large errors
        const isPayloadTooLarge =
            error.code === 'FST_REQ_FILE_TOO_LARGE' ||
            error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ||
            error.statusCode === 413 ||
            (error.statusCode === 400 &&
                (error.message?.includes('payload') ||
                    error.message?.includes('too large')) &&
                !error.message?.includes('property') &&
                !error.message?.includes('pattern') &&
                !error.message?.includes('required'));

        if (isPayloadTooLarge) {
            return reply.status(413).send({
                error: {
                    code: 'payload_too_large',
                    message: 'Request payload too large'
                },
                request_id: (request as any).id || crypto.randomUUID()
            });
        }

        // Handle validation errors - these are generally safe to expose
        if ((error.statusCode === 400 || error.code === 'VALIDATION_ERROR') && ErrorHandler.isSafeToExpose(error)) {
            // For Fastify validation errors, use 'invalid_input' code
            const validationError = error.code === 'FST_ERR_VALIDATION'
                ? { ...error, code: 'invalid_input' }
                : error;
            return reply.status(400).send(ErrorHandler.createSafeErrorResponse(validationError, true));
        }

        // Handle external service errors
        if (error.code === 'EXTERNAL_SERVICE_ERROR') {
            return ErrorHandler.handleExternalServiceError(reply, error, 'external_service');
        }

        // Default error response - don't expose internal error details
        const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
        return reply.status(statusCode).send({
            error: {
                code: statusCode >= 500 ? 'internal_error' : 'bad_request',
                message: statusCode >= 500 ? 'An unexpected error occurred' : 'Invalid request'
            }
        });
    });
}