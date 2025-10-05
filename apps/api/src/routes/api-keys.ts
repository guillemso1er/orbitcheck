import crypto from "node:crypto";

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import { API_KEY_PREFIX, ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS, STATUS } from "../constants.js";
import { errorSchema, generateRequestId, rateLimitResponse, securityHeader, sendError, sendServerError, unauthorizedResponse } from "./utils.js";


export function registerApiKeysRoutes(app: FastifyInstance, pool: Pool) {
    app.get('/api/keys', {
        schema: {
            summary: 'List API Keys',
            description: 'Retrieves a list of API keys for the authenticated project, showing only the prefix (first 6 characters) for security.',
            tags: ['API Keys'],
            headers: securityHeader,
            response: {
                200: {
                    description: 'List of API keys',
                    type: 'object',
                    properties: {
                        data: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    prefix: { type: 'string' },
                                    status: { type: 'string', enum: ['active', 'revoked'] },
                                    created_at: { type: 'string', format: 'date-time' },
                                    last_used_at: { type: 'string', format: 'date-time', nullable: true }
                                }
                            }
                        },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse
            }
        }
    }, async (request, rep) => {
        try {
            const project_id = request.project_id!;
            const request_id = generateRequestId();
            const { rows } = await pool.query(
                "SELECT id, prefix, name, status, created_at, last_used_at FROM api_keys WHERE project_id = $1 ORDER BY created_at DESC",
                [project_id]
            );
            return rep.send({ data: rows, request_id });
        } catch (error) {
            return sendServerError(request, rep, error, '/api/keys', generateRequestId());
        }
    });

    app.post('/api/keys/:id', {
        schema: {
            summary: 'Create New API Key',
            description: 'Generates a new API key for the authenticated project.',
            tags: ['API Keys'],
            headers: securityHeader,
            body: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Optional name for the API key' }
                }
            },
            response: {
                201: {
                    description: 'New API key created',
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        prefix: { type: 'string' },
                        full_key: { type: 'string', description: 'The full API key (shown only once)' },
                        status: { type: 'string' },
                        created_at: { type: 'string', format: 'date-time' },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse
            }
        }
    }, async (request, rep) => {
        try {
            const project_id = request.project_id!;
            const { name } = request.body as { name?: string };
            const request_id = generateRequestId();

            // Generate full key
            const buf = new Promise<Buffer>((resolve, reject) => {
                crypto.randomBytes(32, (error, buf) => {
                    if (error) reject(error);
                    else resolve(buf);
                });
            });
            const full_key = API_KEY_PREFIX + (await buf).toString('hex');
            const prefix = full_key.slice(0, 6);
            const keyHash = crypto.createHash('sha256').update(full_key).digest('hex');

            const { rows } = await pool.query(
                "INSERT INTO api_keys (project_id, prefix, hash, status, name) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at",
                [project_id, prefix, keyHash, STATUS.ACTIVE, name || null]
            );

            const newKey = rows[0];
            return rep.status(HTTP_STATUS.CREATED).send({
                id: newKey.id,
                prefix,
                full_key, // Only return full_key once
                status: STATUS.ACTIVE,
                created_at: newKey.created_at,
                request_id
            });
        } catch (error) {
            return sendServerError(request, rep, error, '/api/keys', generateRequestId());
        }
    });

    app.delete('/api/keys/:id', {
        schema: {
            summary: 'Revoke API Key',
            description: 'Revokes an API key by setting its status to revoked. Cannot be undone.',
            tags: ['API Keys'],
            headers: securityHeader,
            params: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'ID of the API key to revoke' }
                },
                required: ['id']
            },
            response: {
                200: {
                    description: 'API key revoked',
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        status: { type: 'string' },
                        request_id: { type: 'string' }
                    }
                },
                ...unauthorizedResponse,
                ...rateLimitResponse,
                404: { description: 'API key not found', ...errorSchema }
            }
        }
    }, async (request, rep) => {
        try {
            const project_id = request.project_id!;
            const { id } = request.params as { id: string };
            const request_id = generateRequestId();

            const { rowCount } = await pool.query(
                "UPDATE api_keys SET status = $3 WHERE id = $1 AND project_id = $2",
                [id, project_id, STATUS.REVOKED]
            );

            if (rowCount === 0) {
                return sendError(rep, HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, ERROR_MESSAGES[ERROR_CODES.NOT_FOUND], request_id);
            }

            return rep.send({ id, status: STATUS.REVOKED, request_id });
        } catch (error) {
            return sendServerError(request, rep, error, '/api/keys/:id', generateRequestId());
        }
    });
}