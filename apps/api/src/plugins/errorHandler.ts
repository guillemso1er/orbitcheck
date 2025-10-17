import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { ErrorHandler } from "../utils/errorHandler.js";

/**
 * Sets up comprehensive error handling for the Fastify application.
 * Handles various error types with appropriate security measures and safe responses.
 */
export async function setupErrorHandler(app: FastifyInstance): Promise<void> {
    // Enhanced error handler to prevent sensitive information leakage
    app.setErrorHandler(async (error: Error & { code?: string; statusCode?: number }, request: FastifyRequest, reply: FastifyReply) => {
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
            return reply.status(503).send({ error: 'timeout', message: 'Request timed out' });
        }

        // Handle database errors with specialized handling
        if (error.code && typeof error.code === 'string' && (error.code.startsWith('42') || error.code.startsWith('23'))) {
            return ErrorHandler.handleDatabaseError(reply, error, 'request_handler');
        }

        // Handle authentication errors
        if (error.statusCode === 401 || error.code === 'UNAUTHORIZED') {
            return reply.status(401).send({ error: 'unauthorized', message: 'Authentication required' });
        }

        // Handle validation errors - these are generally safe to expose
        if ((error.statusCode === 400 || error.code === 'VALIDATION_ERROR') && ErrorHandler.isSafeToExpose(error)) {
            return reply.status(400).send(ErrorHandler.createSafeErrorResponse(error, true));
        }

        // Handle external service errors
        if (error.code === 'EXTERNAL_SERVICE_ERROR') {
            return ErrorHandler.handleExternalServiceError(reply, error, 'external_service');
        }

        // Default error response - don't expose internal error details
        const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
        return reply.status(statusCode).send({
            error: statusCode >= 500 ? 'internal_error' : 'bad_request',
            message: statusCode >= 500 ? 'An unexpected error occurred' : 'Invalid request'
        });
    });
}