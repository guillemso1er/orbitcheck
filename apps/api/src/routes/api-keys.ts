import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Pool } from "pg";
import crypto from "crypto";

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

export function registerApiKeysRoutes(app: FastifyInstance, pool: Pool) {
    app.get('/api-keys', {
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
    }, async (req, rep) => {
        const project_id = (req as any).project_id;
        const request_id = crypto.randomUUID();
        const { rows } = await pool.query(
            "SELECT id, prefix, name, status, created_at, last_used_at FROM api_keys WHERE project_id = $1 ORDER BY created_at DESC",
            [project_id]
        );
        return rep.send({ data: rows, request_id });
    });

    app.post('/api-keys', {
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
    }, async (req, rep) => {
        const project_id = (req as any).project_id;
        const { name } = req.body as { name?: string };
        const request_id = crypto.randomUUID();

        // Generate full key
        const full_key = "ok_" + crypto.randomBytes(32).toString('hex');
        const prefix = full_key.slice(0, 6);
        const keyHash = crypto.createHash('sha256').update(full_key).digest('hex');

        const { rows } = await pool.query(
            "INSERT INTO api_keys (project_id, prefix, hash, status, name) VALUES ($1, $2, $3, 'active', $4) RETURNING id, created_at",
            [project_id, prefix, keyHash, name || null]
        );

        const newKey = rows[0];
        return rep.status(201).send({
            id: newKey.id,
            prefix,
            full_key, // Only return full_key once
            status: 'active',
            created_at: newKey.created_at,
            request_id
        });
    });

    app.delete('/api-keys/:id', {
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
                404: { description: 'API key not found' }
            }
        }
    }, async (req, rep) => {
        const project_id = (req as any).project_id;
        const { id } = req.params as { id: string };
        const request_id = crypto.randomUUID();

        const { rowCount } = await pool.query(
            "UPDATE api_keys SET status = 'revoked' WHERE id = $1 AND project_id = $2",
            [id, project_id]
        );

        if (rowCount === 0) {
            return rep.status(404).send({ error: { code: 'not_found', message: 'API key not found' } });
        }

        return rep.send({ id, status: 'revoked', request_id });
    });
}