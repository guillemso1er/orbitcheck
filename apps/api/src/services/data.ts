import { MGMT_V1_ROUTES } from "@orbitcheck/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import nodemailer from "nodemailer";
import type { Pool } from "pg";
import { CACHE_HIT_PLACEHOLDER, COMPLIANCE_REASONS, LOGS_DEFAULT_LIMIT, LOGS_MAX_LIMIT, MESSAGES, TOP_REASONS_LIMIT, USAGE_DAYS, USAGE_PERIOD } from "../config.js";
import { ERROR_CODES, HTTP_STATUS } from "../errors.js";
import type { DeleteLogData, DeleteLogResponses, EraseDataData, EraseDataResponses, GetLogsData, GetLogsResponses, GetUsageResponses } from "../generated/fastify/types.gen.js";
import { generateRequestId, sendError, sendServerError } from "./utils.js";

export async function getEventLogs(
    request: FastifyRequest<{ Querystring?: GetLogsData['query'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply<{ Body: GetLogsResponses }>> {
    try {
        const request_id = generateRequestId();
        const project_id = (request as any).project_id;
        let limit = (request.query as any).limit || LOGS_DEFAULT_LIMIT;
        const offset = (request.query as any).offset || 0;
        const query = request.query as any;
        const { reason_code, endpoint, status } = query;

        if (limit > LOGS_MAX_LIMIT) {
            limit = LOGS_MAX_LIMIT;
        }

        // Build dynamic WHERE clause
        const whereClauses: string[] = ['project_id = $1'];
        const parameters: any[] = [project_id];
        let parameterIndex = 2;

        if (reason_code) {
            whereClauses.push(`reason_codes @> ARRAY[$${parameterIndex}]::text[]`);
            parameters.push(reason_code);
            parameterIndex++;
        }

        if (endpoint) {
            whereClauses.push(`endpoint = $${parameterIndex}`);
            parameters.push(endpoint);
            parameterIndex++;
        }

        if (status !== undefined) {
            whereClauses.push(`status = $${parameterIndex}`);
            parameters.push(status);
            parameterIndex++;
        }

        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Count total
        const countQuery = `SELECT COUNT(*) as total FROM logs ${whereClause}`;
        const { rows: countRows } = await pool.query(countQuery, parameters);
        const total_count = Number.parseInt(countRows[0].total);

        // Fetch data
        const dataQuery = `
            SELECT id, type, endpoint, reason_codes, status, meta, created_at
            FROM logs
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT $${parameterIndex} OFFSET $${parameterIndex + 1}
        `;
        parameters.push(limit, offset);
        const { rows } = await pool.query(dataQuery, parameters);

        const next_cursor = rows.length === limit ? (offset + limit).toString() : null;

        const response: GetLogsResponses[200] = {
            data: rows,
            next_cursor,
            total_count,
            request_id
        };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.DATA.GET_EVENT_LOGS, generateRequestId());
    }
}

export async function getUsageStatistics(
    request: FastifyRequest,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply<{ Body: GetUsageResponses }>> {
    try {
        const request_id = generateRequestId();
        const project_id = (request as any).project_id;
        const { rows: dailyRows } = await pool.query("select date, validations, orders from usage_daily where project_id=$1 order by date desc limit $2", [project_id, USAGE_DAYS]);
        const totals = dailyRows.reduce((accumulator: any, r: any) => ({ ...accumulator, validations: accumulator.validations + (r.validations || 0), orders: accumulator.orders + (r.orders || 0) }), { validations: 0, orders: 0 });

        // Top reason codes from logs
        const { rows: topReasons } = await pool.query(
            `SELECT unnest(reason_codes) as code, count(*) as count
             FROM logs
             WHERE project_id = $1
             AND status = $2
             AND created_at > now() - ($3 * interval '1 day')
             GROUP BY code
             ORDER BY count DESC
             LIMIT $4`,
            [project_id, HTTP_STATUS.OK, USAGE_DAYS, TOP_REASONS_LIMIT]
        );

        // Cache hit ratio estimation
        const { rows: logCount } = await pool.query(
            "SELECT count(*) as total_requests FROM logs WHERE project_id = $1 AND created_at > now() - ($2 * interval '1 day')",
            [project_id, USAGE_DAYS]
        );
        const totalRequests = Number.parseInt(logCount[0].total_requests) || 1;
        const estimatedCacheHits = Math.floor(totalRequests * CACHE_HIT_PLACEHOLDER);
        const cacheHitRatio = (estimatedCacheHits / totalRequests * 100);

        const response: GetUsageResponses[200] = {
            period: USAGE_PERIOD,
            totals,
            by_day: dailyRows,
            top_reason_codes: topReasons,
            cache_hit_ratio: cacheHitRatio,
            request_id
        };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.DATA.GET_USAGE_STATISTICS, generateRequestId());
    }
}

export async function eraseUserData(
    request: FastifyRequest<{ Body: EraseDataData['body'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply<{ Body: EraseDataResponses }>> {
    try {
        const request_id = generateRequestId();
        const project_id = (request as any).project_id;
        const { reason } = request.body;

        if (!reason || !Object.values(COMPLIANCE_REASONS).includes(reason as any)) {
            return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.ERASE_INVALID_REQUEST, MESSAGES.ERASE_INVALID_REQUEST_MESSAGE, request_id);
        }

        // Get user information for email
        const { rows: userRows } = await pool.query(
            'SELECT u.email, p.name as project_name FROM users u JOIN projects p ON p.user_id = u.id WHERE p.id = $1',
            [project_id]
        );

        if (userRows.length === 0) {
            return sendError(rep, HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Project not found or user not associated', request_id);
        }

        const { email, project_name } = userRows[0];

        // Delete all project-related data
        await pool.query('DELETE FROM logs WHERE project_id = $1', [project_id]);
        await pool.query('DELETE FROM api_keys WHERE project_id = $1', [project_id]);
        await pool.query('DELETE FROM webhooks WHERE project_id = $1', [project_id]);
        await pool.query('DELETE FROM settings WHERE project_id = $1', [project_id]);
        await pool.query('DELETE FROM jobs WHERE project_id = $1', [project_id]);

        // Get user_id for the project to clean up user-related data
        const { rows: projectRows } = await pool.query('SELECT user_id FROM projects WHERE id = $1', [project_id]);
        if (projectRows.length > 0) {
            const user_id = projectRows[0].user_id;

            await pool.query('DELETE FROM personal_access_tokens WHERE user_id = $1', [user_id]);
            await pool.query('DELETE FROM audit_logs WHERE user_id = $1', [user_id]);

            await pool.query(
                'UPDATE users SET email = CONCAT(\'deleted-user-\', id, \'@anonymized.orbitcheck\'), password_hash = \'deleted\' WHERE id = $1',
                [user_id]
            );
        }

        // Send confirmation email
        try {
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: false,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });

            const complianceType = reason.toUpperCase();
            await transporter.sendMail({
                from: process.env.SMTP_FROM || 'noreply@orbitcheck.io',
                to: email,
                subject: `Data Erasure Confirmation - ${complianceType} Compliance`,
                html: `
                    <h2>Data Erasure Completed</h2>
                    <p>Your data erasure request has been processed successfully.</p>
                    <p><strong>Compliance Type:</strong> ${complianceType}</p>
                    <p><strong>Project:</strong> ${project_name}</p>
                    <p><strong>Request ID:</strong> ${request_id}</p>
                    <p><strong>Completed At:</strong> ${new Date().toISOString()}</p>
                    <p>All personal data, logs, API keys, and related information have been permanently deleted from our systems.</p>
                    <p>If you have any questions, please contact our support team.</p>
                    <br>
                    <p>Best regards,<br>The OrbitCheck Team</p>
                `
            });
        } catch (emailError) {
            console.error('Failed to send confirmation email:', emailError);
        }

        const response: EraseDataResponses[202] = {
            message: MESSAGES.DATA_ERASURE_INITIATED(reason.toUpperCase()),
            request_id
        };
        return rep.code(202).send(response);
    } catch (error) {
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.DATA.ERASE_USER_DATA, generateRequestId());
    }
}

export async function deleteLogEntry(
    request: FastifyRequest<{ Params: DeleteLogData['path'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply<{ Body: DeleteLogResponses }>> {
    try {
        const request_id = generateRequestId();
        const project_id = (request as any).project_id;
        const { id } = request.params as DeleteLogData['path'];

        const result = await pool.query(
            'DELETE FROM logs WHERE id = $1 AND project_id = $2',
            [id, project_id]
        );

        if (result.rowCount === 0) {
            return sendError(rep, HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, MESSAGES.LOG_ENTRY_NOT_FOUND, request_id);
        }
        const response: DeleteLogResponses[200] = {
            message: MESSAGES.LOG_ENTRY_DELETED,
            request_id
        };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.LOGS.DELETE_LOG_ENTRY, generateRequestId());
    }
}