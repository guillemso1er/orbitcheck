import type { FastifyInstance} from "fastify";
import { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { CACHE_HIT_PLACEHOLDER,HTTP_STATUS, LOGS_DEFAULT_LIMIT, LOGS_MAX_LIMIT, TOP_REASONS_LIMIT, USAGE_DAYS, USAGE_PERIOD } from "../constants";
import { logEvent } from "../hooks";
import { generateRequestId, rateLimitResponse, securityHeader, sendServerError,unauthorizedResponse } from "./utils";


export function registerDataRoutes(app: FastifyInstance, pool: Pool) {
    app.get("/logs", {
        schema: {
            summary: 'Get Event Logs',
            description: 'Retrieves event logs for the project with optional filters by reason code, endpoint, and status. Supports pagination via limit and offset.',
            tags: ['Data Retrieval'],
            headers: securityHeader,
            querystring: {
                type: 'object',
                properties: {
                    reason_code: { type: 'string', description: 'Filter by exact reason code (must be in reason_codes array)' },
                    endpoint: { type: 'string', description: 'Filter by exact endpoint' },
                    status: { type: 'integer', description: 'Filter by HTTP status code' },
                    limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100, description: 'Number of logs to return' },
                    offset: { type: 'integer', minimum: 0, default: 0, description: 'Offset for pagination' }
                }
            },
            response: {
                200: {
                    description: 'A list of log entries.',
                    type: 'object',
                    properties: {
                        data: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    type: { type: 'string' },
                                    endpoint: { type: 'string' },
                                    reason_codes: { type: 'array', items: { type: 'string' } },
                                    status: { type: 'integer' },
                                    meta: { type: 'object' },
                                    created_at: { type: 'string', format: 'date-time' }
                                }
                            }
                        },
                        next_cursor: { type: 'string', nullable: true, description: 'Next offset for pagination' },
                        total_count: { type: 'integer', description: 'Total number of matching logs' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse
            }
        }
    }, async (request, rep) => {
        try {
            const request_id = generateRequestId();
            const project_id = (request as any).project_id;
            let limit = (request.query as any).limit || LOGS_DEFAULT_LIMIT;
            const offset = (request.query as any).offset || 0;
            const { reason_code, endpoint, status } = request.query as any;
        
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

            return rep.send({ data: rows, next_cursor, total_count, request_id });
        } catch (error) {
            return sendServerError(request, rep, error, '/logs', generateRequestId());
        }
    });

    app.get("/usage", {
        schema: {
            summary: 'Get Usage Statistics',
            description: 'Retrieves usage statistics for the last 31 days for the project associated with the API key.',
            tags: ['Data Retrieval'],
            headers: securityHeader,
            response: {
                200: {
                    description: 'A summary of usage data.',
                    type: 'object',
                    properties: {
                        period: { type: 'string', example: 'month' },
                        totals: {
                            type: 'object',
                            properties: {
                                validations: { type: 'integer' },
                                orders: { type: 'integer' }
                            }
                        },
                        by_day: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    date: { type: 'string', format: 'date' },
                                    validations: { type: 'integer' },
                                    orders: { type: 'integer' }
                                }
                            }
                        },
                        top_reason_codes: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    code: { type: 'string' },
                                    count: { type: 'integer' }
                                }
                            }
                        },
                        cache_hit_ratio: { type: 'number' },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse
            }
        }
    }, async (request, rep) => {
        try {
            const request_id = generateRequestId();
            const project_id = (request as any).project_id;
            const { rows: dailyRows } = await pool.query("select date, validations, orders from usage_daily where project_id=$1 order by date desc limit $2", [project_id, USAGE_DAYS]);
            const totals = dailyRows.reduce((accumulator: any, r: any) => ({ ...accumulator, validations: accumulator.validations + (r.validations || 0), orders: accumulator.orders + (r.orders || 0) }), { validations: 0, orders: 0 });

            // Top reason codes from logs (last 31 days, successful validations)
            const { rows: topReasons } = await pool.query(
                `SELECT unnest(reason_codes) as code, count(*) as count
                 FROM logs
                 WHERE project_id = $1
                 AND status = $2
                 AND created_at > now() - interval '$3 days'
                 GROUP BY code
                 ORDER BY count DESC
                 LIMIT $4`,
                [project_id, HTTP_STATUS.OK, USAGE_DAYS, TOP_REASONS_LIMIT]
            );

            // Cache hit ratio - placeholder (in production, track cache hits in logs/meta)
            // For now, estimate based on validations vs total requests
            const { rows: logCount } = await pool.query(
                "SELECT count(*) as total_requests FROM logs WHERE project_id = $1 AND created_at > now() - interval '$2 days'",
                [project_id, USAGE_DAYS]
            );
            const totalRequests = Number.parseInt(logCount[0].total_requests) || 1;
            const estimatedCacheHits = Math.floor(totalRequests * CACHE_HIT_PLACEHOLDER); // Placeholder 95%
            const cacheHitRatio = (estimatedCacheHits / totalRequests * 100);

            return rep.send({
                period: USAGE_PERIOD,
                totals,
                by_day: dailyRows,
                top_reason_codes: topReasons,
                cache_hit_ratio: cacheHitRatio,
                request_id
            });
        } catch (error) {
            return sendServerError(request, rep, error, '/usage', generateRequestId());
        }
    });
}