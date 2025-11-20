import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { HTTP_STATUS } from "../errors.js";
import type { GetJobStatusByIdData, GetJobStatusByIdResponses } from "../generated/fastify/types.gen.js";
import { logEvent } from "../hooks.js";
import { generateRequestId, sendServerError } from "./utils.js";

export async function getJobStatus(
    request: FastifyRequest<{ Params: GetJobStatusByIdData['path'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply<{ Body: GetJobStatusByIdResponses }>> {
    try {
        const request_id = generateRequestId();
        const { id } = request.params as GetJobStatusByIdData['path'];
        const project_id = (request as any).project_id;

        if (!project_id) {
            return rep.status(HTTP_STATUS.UNAUTHORIZED).send({
                error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
            });
        }

        // Get job from database
        const { rows: [job] } = await pool.query(
            'SELECT id, status, input_data, result_data, error_message, total_items, processed_items, result_url, created_at, updated_at FROM jobs WHERE id = $1 AND project_id = $2',
            [id, project_id]
        );

        if (!job) {
            return rep.status(HTTP_STATUS.NOT_FOUND).send({
                error: { code: 'not_found', message: 'Job not found' }
            });
        }

        // Calculate progress
        let progress: number | undefined = undefined;
        if ((job.status === 'processing' || job.status === 'completed' || job.status === 'failed') && job.total_items > 0) {
            progress = Math.round((job.processed_items / job.total_items) * 100);
        }

        const response: GetJobStatusByIdResponses[200] = {
            id: job.id,
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
            response.result = job.result_data;
        }

        await logEvent(project_id, 'jobs', "/v1/jobs/:id", [], HTTP_STATUS.OK, {
            job_status: job.status
        }, pool);

        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, "/v1/jobs/:id", generateRequestId());
    }
}