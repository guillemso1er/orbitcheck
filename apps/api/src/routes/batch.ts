import { API_V1_ROUTES } from "@orbitcheck/contracts";
import { Queue } from 'bullmq';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Redis as IORedisType } from 'ioredis';
import type { Pool } from "pg";

import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../errors.js";
import { logEvent } from "../hooks.js";
import { generateRequestId, rateLimitResponse, runtimeSecurityHeader as securityHeader, sendServerError, unauthorizedResponse, validationErrorResponse } from "./utils.js";

export function registerBatchRoutes(app: FastifyInstance, pool: Pool, redis: IORedisType): void {
    // Create queues
    const validationQueue = new Queue('batch_validation', { connection: redis });
    const dedupeQueue = new Queue('batch_dedupe', { connection: redis });

    app.post(API_V1_ROUTES.BATCH.BATCH_VALIDATE_DATA, {
        schema: {
            summary: 'Batch validate data',
            description: 'Performs batch validation of emails, phones, addresses, or tax IDs asynchronously',
            tags: ['Batch Operations'],
            headers: securityHeader,
            security: [
                { ApiKeyAuth: [] },
                { BearerAuth: [] }
            ],
            body: {
                type: 'object',
                required: ['type', 'data'],
                properties: {
                    type: { type: 'string', enum: ['email', 'phone', 'address', 'tax-id'] },
                    data: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Array of items to validate'
                    }
                }
            },
            response: {
                202: {
                    description: 'Batch validation job started',
                    type: 'object',
                    properties: {
                        job_id: { type: 'string' },
                        status: { type: 'string', enum: ['pending'] },
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
            const body = request.body as any;
            const { type, data } = body;
            const project_id = (request as any).project_id;

            // Validate input
            if (!data || !Array.isArray(data) || data.length === 0 || data.length > 10000) {
                return rep.status(HTTP_STATUS.BAD_REQUEST).send({
                    error: { code: ERROR_CODES.INVALID_INPUT, message: ERROR_MESSAGES[ERROR_CODES.INVALID_INPUT] }
                });
            }

            // Create job record
            const { rows: [jobRecord] } = await pool.query(
                `INSERT INTO jobs (project_id, job_type, input_data, status, total_items, processed_items)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id`,
                [project_id, 'batch_validate', JSON.stringify({ type, data }), 'pending', data.length, 0]
            );

            // Add job to queue
            await validationQueue.add('validate', {
                type,
                data,
                project_id,
                job_id: jobRecord.id
            }, {
                jobId: jobRecord.id
            });

            const response = {
                job_id: jobRecord.id,
                status: 'pending',
                request_id
            };

            await logEvent(project_id, 'batch', API_V1_ROUTES.BATCH.BATCH_VALIDATE_DATA, [], HTTP_STATUS.ACCEPTED, {
                job_type: 'batch_validate',
                item_count: data.length
            }, pool);

            return rep.status(HTTP_STATUS.ACCEPTED).send(response);
        } catch (error) {
            return sendServerError(request, rep, error, API_V1_ROUTES.BATCH.BATCH_VALIDATE_DATA, generateRequestId());
        }
    });

    app.post(API_V1_ROUTES.BATCH.BATCH_DEDUPLICATE_DATA, {
        schema: {
            summary: 'Batch deduplicate data',
            description: 'Performs batch deduplication of customers or addresses asynchronously',
            tags: ['Batch Operations'],
            headers: securityHeader,
            security: [
                { ApiKeyAuth: [] },
                { BearerAuth: [] }
            ],
            body: {
                type: 'object',
                required: ['type', 'data'],
                properties: {
                    type: { type: 'string', enum: ['customers', 'addresses'] },
                    data: {
                        type: 'array',
                        description: 'Array of items to deduplicate'
                    }
                }
            },
            response: {
                202: {
                    description: 'Batch deduplication job started',
                    type: 'object',
                    properties: {
                        job_id: { type: 'string' },
                        status: { type: 'string', enum: ['pending'] },
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
            const body = request.body as any;
            const { type, data } = body;
            const project_id = (request as any).project_id;

            // Validate input
            if (!data || !Array.isArray(data) || data.length === 0 || data.length > 10000) {
                return rep.status(HTTP_STATUS.BAD_REQUEST).send({
                    error: { code: ERROR_CODES.INVALID_INPUT, message: ERROR_MESSAGES[ERROR_CODES.INVALID_INPUT] }
                });
            }

            // Create job record
            const { rows: [jobRecord] } = await pool.query(
                `INSERT INTO jobs (project_id, job_type, input_data, status, total_items, processed_items)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id`,
                [project_id, 'batch_dedupe', JSON.stringify({ type, data }), 'pending', data.length, 0]
            );

            // Add job to queue
            await dedupeQueue.add('dedupe', {
                type,
                data,
                project_id,
                job_id: jobRecord.id
            }, {
                jobId: jobRecord.id
            });

            const response = {
                job_id: jobRecord.id,
                status: 'pending',
                request_id
            };

            await logEvent(project_id, 'batch', API_V1_ROUTES.BATCH.BATCH_DEDUPLICATE_DATA, [], HTTP_STATUS.ACCEPTED, {
                job_type: 'batch_dedupe',
                item_count: data.length
            }, pool);

            return rep.status(HTTP_STATUS.ACCEPTED).send(response);
        } catch (error) {
            return sendServerError(request, rep, error, API_V1_ROUTES.BATCH.BATCH_DEDUPLICATE_DATA, generateRequestId());
        }
    });
}