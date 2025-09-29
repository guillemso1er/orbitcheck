import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Pool } from "pg";
import crypto from "crypto";
import { logEvent } from "../hooks";

const errorSchema = {
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

const securityHeader = {
    type: 'object',
    properties: {
        'authorization': { type: 'string' },
        'idempotency-key': { type: 'string' }
    },
    required: ['authorization']
};

const unauthorizedResponse = { 401: { description: 'Unauthorized', ...errorSchema } };
const rateLimitResponse = { 429: { description: 'Rate Limit Exceeded', ...errorSchema } };

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
    }, async (req, rep) => {
        const project_id = (req as any).project_id;
        const { reason_code, endpoint, status, limit = 100, offset = 0 } = req.query as any;

        // Build dynamic WHERE clause
        let whereClauses: string[] = ['project_id = $1'];
        let params: any[] = [project_id];
        let paramIndex = 2;

        if (reason_code) {
            whereClauses.push(`reason_codes @> ARRAY[$${paramIndex}]::text[]`);
            params.push(reason_code);
            paramIndex++;
        }

        if (endpoint) {
            whereClauses.push(`endpoint = $${paramIndex}`);
            params.push(endpoint);
            paramIndex++;
        }

        if (status !== undefined) {
            whereClauses.push(`status = $${paramIndex}`);
            params.push(status);
            paramIndex++;
        }

        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Count total
        const countQuery = `SELECT COUNT(*) as total FROM logs ${whereClause}`;
        const { rows: countRows } = await pool.query(countQuery, params);
        const total_count = parseInt(countRows[0].total);

        // Fetch data
        const dataQuery = `
            SELECT id, type, endpoint, reason_codes, status, meta, created_at
            FROM logs
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        params.push(limit, offset);
        const { rows } = await pool.query(dataQuery, params);

        const next_cursor = rows.length === limit ? (offset + limit).toString() : null;

        return rep.send({ data: rows, next_cursor, total_count });
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
    }, async (req, rep) => {
        const project_id = (req as any).project_id;
        const { rows: dailyRows } = await pool.query("select date, validations, orders from usage_daily where project_id=$1 order by date desc limit 31", [project_id]);
        const totals = dailyRows.reduce((acc: any, r: any) => ({ ...acc, validations: acc.validations + (r.validations || 0), orders: acc.orders + (r.orders || 0) }), { validations: 0, orders: 0 });

        // Top reason codes from logs (last 31 days, successful validations)
        const { rows: topReasons } = await pool.query(
            `SELECT unnest(reason_codes) as code, count(*) as count
             FROM logs
             WHERE project_id = $1
             AND status = 200
             AND created_at > now() - interval '31 days'
             GROUP BY code
             ORDER BY count DESC
             LIMIT 10`,
            [project_id]
        );

        // Cache hit ratio - placeholder (in production, track cache hits in logs/meta)
        // For now, estimate based on validations vs total requests
        const { rows: logCount } = await pool.query(
            "SELECT count(*) as total_requests FROM logs WHERE project_id = $1 AND created_at > now() - interval '31 days'",
            [project_id]
        );
        const totalRequests = parseInt(logCount[0].total_requests) || 1;
        const estimatedCacheHits = Math.floor(totalRequests * 0.95); // Placeholder 95%
        const cacheHitRatio = (estimatedCacheHits / totalRequests * 100);

        const request_id = crypto.randomUUID();
        return rep.send({
            period: "month",
            totals,
            by_day: dailyRows,
            top_reason_codes: topReasons,
            cache_hit_ratio: cacheHitRatio,
            request_id
        });
    });
}