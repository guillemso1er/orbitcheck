import { Queue } from 'bullmq';
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis as IORedisType } from 'ioredis';
import type { Pool } from "pg";
import { API_V1_ROUTES } from "@orbitcheck/contracts";
import type { BatchDedupeData, BatchDedupeResponses, BatchValidateData, BatchValidateResponses } from "../generated/fastify/types.gen.js";
import { HTTP_STATUS } from "../errors.js";
import { logEvent } from "../hooks.js";
import { generateRequestId, sendServerError } from "../routes/utils.js";

export async function batchValidateData(
    request: FastifyRequest<{ Body: BatchValidateData['body'] }>,
    rep: FastifyReply,
    pool: Pool,
    redis: IORedisType
): Promise<FastifyReply> {
    try {
        const request_id = generateRequestId();
        const body = request.body as BatchValidateData['body'];
        const { type, data } = body;
        const project_id = (request as any).project_id;

        // Validate input
        if (!data || !Array.isArray(data) || data.length === 0 || data.length > 10000) {
            return rep.status(HTTP_STATUS.BAD_REQUEST).send({
                error: { code: 'INVALID_INPUT', message: 'Invalid input data' }
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
        const validationQueue = new Queue('batch_validation', { connection: redis });
        await validationQueue.add('validate', {
            type,
            data,
            project_id,
            job_id: jobRecord.id
        }, {
            jobId: jobRecord.id
        });

        const response: BatchValidateResponses[202] = {
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
}

export async function batchDeduplicateData(
    request: FastifyRequest<{ Body: BatchDedupeData['body'] }>,
    rep: FastifyReply,
    pool: Pool,
    redis: IORedisType
): Promise<FastifyReply> {
    try {
        const request_id = generateRequestId();
        const body = request.body as BatchDedupeData['body'];
        const { type, data } = body;
        const project_id = (request as any).project_id;

        // Validate input
        if (!data || !Array.isArray(data) || data.length === 0 || data.length > 10000) {
            return rep.status(HTTP_STATUS.BAD_REQUEST).send({
                error: { code: 'INVALID_INPUT', message: 'Invalid input data' }
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
        const dedupeQueue = new Queue('batch_dedupe', { connection: redis });
        await dedupeQueue.add('dedupe', {
            type,
            data,
            project_id,
            job_id: jobRecord.id
        }, {
            jobId: jobRecord.id
        });

        const response: BatchDedupeResponses[202] = {
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
}