import crypto from "node:crypto";

import { MGMT_V1_ROUTES } from "@orbitcheck/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import { API_KEY_PREFIX, CRYPTO_IV_BYTES, CRYPTO_KEY_BYTES, ENCODING_HEX, ENCODING_UTF8, ENCRYPTION_ALGORITHM, HASH_ALGORITHM, STATUS } from "../config.js";
import { environment } from "../environment.js";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../errors.js";
import { errorSchema, generateRequestId, rateLimitResponse, securityHeader, sendError, sendServerError, unauthorizedResponse } from "./utils.js";


export function registerApiKeysRoutes(app: FastifyInstance, pool: Pool): void {
    app.get(MGMT_V1_ROUTES.API_KEYS.LIST_API_KEYS, {
        schema: {
            summary: 'List API Keys',
            description: 'Retrieves a list of API keys for the authenticated project, showing only the prefix (first 6 characters) for security.',
            tags: ['API Keys'],
            headers: securityHeader,
            security: [{ ApiKeyAuth: [] }],
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
            const response: any = { data: rows, request_id };
            return rep.send(response);
        } catch (error) {
            return sendServerError(request, rep, error, MGMT_V1_ROUTES.API_KEYS.LIST_API_KEYS, generateRequestId());
        }
    });

    app.post(MGMT_V1_ROUTES.API_KEYS.CREATE_API_KEY, {
        schema: {
            summary: 'Create New API Key',
            description: 'Generates a new API key for the authenticated project.',
            tags: ['API Keys'],
            headers: securityHeader,
            security: [{ BearerAuth: [] }],
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
            request.log.info('Creating API key for project_id: ' + project_id);
            const body = request.body as any;
            const { name } = body;
            const request_id = generateRequestId();

            // Generate full key
            const buf = await new Promise<Buffer>((resolve, reject) => {
                crypto.randomBytes(CRYPTO_KEY_BYTES, (error, buf) => {
                    if (error) reject(error);
                    else resolve(buf);
                });
            });
            const full_key = API_KEY_PREFIX + buf.toString('hex');
            const prefix = full_key.slice(0, 6);
            const keyHash = crypto.createHash(HASH_ALGORITHM).update(full_key).digest('hex');

            // Encrypt the full key
            const iv = await new Promise<Buffer>((resolve, reject) => {
                crypto.randomBytes(CRYPTO_IV_BYTES, (error, buf) => {
                    if (error) reject(error);
                    else resolve(buf);
                });
            });
            const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, Buffer.from(environment.ENCRYPTION_KEY, ENCODING_HEX), iv);
            let encrypted = await new Promise<string>((resolve, reject) => {
                try {
                    const updateResult = cipher.update(full_key, ENCODING_UTF8, ENCODING_HEX);
                    const finalResult = cipher.final(ENCODING_HEX);
                    resolve(updateResult + finalResult);
                } catch (error) {
                    reject(error);
                }
            });
            const encryptedWithIv = iv.toString('hex') + ':' + encrypted;

            const { rows } = await pool.query(
                "INSERT INTO api_keys (project_id, prefix, hash, encrypted_key, status, name) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at",
                [project_id, prefix, keyHash, encryptedWithIv, STATUS.ACTIVE, name || null]
            );

            const newKey = rows[0];

            // Create PAT for the new API key
            await pool.query(
                "INSERT INTO personal_access_tokens (user_id, token_id, name, token_hash, scopes, env, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                [request.user_id, crypto.randomUUID(), name || 'API Key', keyHash, ['*'], 'live', null]
            );
            const response: any = {
                id: newKey.id,
                prefix,
                full_key, // Only return full_key once
                status: STATUS.ACTIVE,
                created_at: newKey.created_at,
                request_id
            };
            return rep.status(HTTP_STATUS.CREATED).send(response);
        } catch (error) {
            return sendServerError(request, rep, error, MGMT_V1_ROUTES.API_KEYS.CREATE_API_KEY, generateRequestId());
        }
    });

    app.delete(MGMT_V1_ROUTES.API_KEYS.REVOKE_API_KEY, {
        schema: {
            summary: 'Revoke API Key',
            description: 'Revokes an API key by setting its status to revoked. Cannot be undone.',
            tags: ['API Keys'],
            headers: securityHeader,
            security: [{ BearerAuth: [] }],
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
                return await sendError(rep, HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, ERROR_MESSAGES[ERROR_CODES.NOT_FOUND], request_id);
            }

            const response: any = { id, status: STATUS.REVOKED, request_id };
            return rep.send(response);
        } catch (error) {
            return sendServerError(request, rep, error, `${MGMT_V1_ROUTES.API_KEYS.LIST_API_KEYS}/:id`, generateRequestId());
        }
    });
}