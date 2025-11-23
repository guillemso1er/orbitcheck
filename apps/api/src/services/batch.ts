import { Queue } from 'bullmq';
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis as IORedisType } from 'ioredis';
import type { Pool } from "pg";

import { HTTP_STATUS } from "../errors.js";
import type { BatchDedupeData, BatchDedupeResponses, BatchEvaluateOrdersData, BatchEvaluateOrdersResponses, BatchValidateData, BatchValidateResponses } from "../generated/fastify/types.gen.js";
import { logEvent } from "../hooks.js";
import { routes } from "../routes/routes.js";
import { generateRequestId, sendServerError } from "./utils.js";

export async function batchValidateData(
    request: FastifyRequest<{ Body: BatchValidateData['body'] }>,
    rep: FastifyReply,
    pool: Pool,
    redis: IORedisType
): Promise<FastifyReply<{ Body: BatchValidateResponses }>> {
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

        await logEvent(project_id, 'batch', routes.v1.batch.batchValidate, [], HTTP_STATUS.ACCEPTED, {
            job_type: 'batch_validate',
            item_count: data.length
        }, pool);

        return rep.status(HTTP_STATUS.ACCEPTED).send(response);
    } catch (error) {
        return sendServerError(request, rep, error, routes.v1.batch.batchValidate, generateRequestId());
    }
}

export async function batchDeduplicateData(
    request: FastifyRequest<{ Body: BatchDedupeData['body'] }>,
    rep: FastifyReply,
    pool: Pool,
    redis: IORedisType
): Promise<FastifyReply<{ Body: BatchDedupeResponses }>> {
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

        await logEvent(project_id, 'batch', routes.v1.batch.batchDedupe, [], HTTP_STATUS.ACCEPTED, {
            job_type: 'batch_dedupe',
            item_count: data.length
        }, pool);

        return rep.status(HTTP_STATUS.ACCEPTED).send(response);
    } catch (error) {
        return sendServerError(request, rep, error, routes.v1.batch.batchDedupe, generateRequestId());
    }
}

export async function batchEvaluateOrders(
    request: FastifyRequest<{ Body: BatchEvaluateOrdersData['body'] }>,
    rep: FastifyReply,
    pool: Pool,
    redis: IORedisType
): Promise<FastifyReply<{ Body: BatchEvaluateOrdersResponses }>> {
    try {
        const request_id = generateRequestId();
        const body = request.body as BatchEvaluateOrdersData['body'];
        const { orders } = body;
        const project_id = (request as any).project_id;

        // Validate input
        if (!orders || !Array.isArray(orders) || orders.length === 0 || orders.length > 10000) {
            return rep.status(HTTP_STATUS.BAD_REQUEST).send({
                error: { code: 'INVALID_INPUT', message: 'Invalid input data' }
            });
        }

        // Validate required fields for each order
        for (const order of orders) {
            if (!order.order_id || !order.customer_email) {
                return rep.status(HTTP_STATUS.BAD_REQUEST).send({
                    error: { code: 'INVALID_INPUT', message: 'Each order must have order_id and customer_email' }
                });
            }
        }

        // Create job record
        const { rows: [jobRecord] } = await pool.query(
            `INSERT INTO jobs (project_id, job_type, input_data, status, total_items, processed_items)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [project_id, 'batch_evaluate_orders', JSON.stringify({ orders }), 'pending', orders.length, 0]
        );

        // Add job to queue
        const evaluationQueue = new Queue('batch_evaluate_orders', { connection: redis });
        await evaluationQueue.add('evaluate', {
            orders,
            project_id,
            job_id: jobRecord.id
        }, {
            jobId: jobRecord.id
        });

        const response: BatchEvaluateOrdersResponses[202] = {
            job_id: jobRecord.id,
            status: 'pending',
            request_id
        };

        await logEvent(project_id, 'batch', routes.v1.batch.batchEvaluateOrders, [], HTTP_STATUS.ACCEPTED, {
            job_type: 'batch_evaluate_orders',
            item_count: orders.length
        }, pool);

        return rep.status(HTTP_STATUS.ACCEPTED).send(response);
    } catch (error) {
        return sendServerError(request, rep, error, routes.v1.batch.batchEvaluateOrders, generateRequestId());
    }
}