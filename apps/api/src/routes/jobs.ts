import { API_V1_ROUTES } from "@orbicheck/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { ERROR_CODES, ERROR_MESSAGES,HTTP_STATUS } from "../errors.js";
import { logEvent } from "../hooks.js";
import { generateRequestId, rateLimitResponse, runtimeSecurityHeader as securityHeader, sendServerError, unauthorizedResponse, validationErrorResponse } from "./utils.js";

export function registerJobRoutes(app: FastifyInstance, pool: Pool): void {
    app.get(API_V1_ROUTES.JOBS.GET_JOB_STATUS, {
        schema: {
            summary: 'Get job status',
            description: 'Retrieves the status and results of an asynchronous job',
            tags: ['Batch Operations'],
            headers: securityHeader,
            parameters: [
                {
                    name: 'id',
                    in: 'path',
                    required: true,
                    description: 'Job ID',
                    schema: { type: 'string' }
                }
            ],
            response: {
                200: {
                    description: 'Job status and results',
                    type: 'object',
                    properties: {
                        job_id: { type: 'string' },
                        status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
                        progress: {
                            type: 'object',
                            nullable: true,
                            properties: {
                                total: { type: 'integer' },
                                processed: { type: 'integer' },
                                percentage: { type: 'number' }
                            }
                        },
                        result_url: { type: 'string', nullable: true },
                        error: { type: 'string', nullable: true },
                        result_data: { type: 'string', nullable: true },
                        created_at: { type: 'string', format: 'date-time' },
                        updated_at: { type: 'string', format: 'date-time' },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                ...validationErrorResponse
            }
        }
    }, async (request: FastifyRequest, rep: FastifyReply) => {
        try {
            const request_id = generateRequestId();
            const { id } = request.params as any;
            const project_id = (request as any).project_id;

            // Get job from database
            const { rows: [job] } = await pool.query(
                'SELECT id, status, input_data, result_data, error_message, total_items, processed_items, result_url, created_at, updated_at FROM jobs WHERE id = $1 AND project_id = $2',
                [id, project_id]
            );

            if (!job) {
                return rep.status(HTTP_STATUS.NOT_FOUND).send({
                    error: { code: ERROR_CODES.NOT_FOUND, message: ERROR_MESSAGES[ERROR_CODES.NOT_FOUND] }
                });
            }

            // Calculate progress
            let progress = null;
            if ((job.status === 'processing' || job.status === 'completed' || job.status === 'failed') && job.total_items > 0) {
                const percentage = Math.round((job.processed_items / job.total_items) * 100);
                progress = {
                    total: job.total_items,
                    processed: job.processed_items,
                    percentage
                };
            }

            const response: any = {
                job_id: job.id,
                status: job.status,
                progress,
                result_url: job.result_url,
                error: job.error_message,
                created_at: job.created_at.toISOString(),
                updated_at: job.updated_at.toISOString(),
                request_id
            };

            // If job is completed and has result_data, include it
            if (job.status === 'completed' && job.result_data) {
                // For now, we'll return the results inline
                // In production, you might want to store results in a file and provide a download URL
                response.result_data = job.result_data;
            }

            await logEvent(project_id, 'jobs', API_V1_ROUTES.JOBS.GET_JOB_STATUS, [], HTTP_STATUS.OK, {
                job_status: job.status
            }, pool);

            return rep.send(response);
        } catch (error) {
            return sendServerError(request, rep, error, API_V1_ROUTES.JOBS.GET_JOB_STATUS, generateRequestId());
        }
    });
}