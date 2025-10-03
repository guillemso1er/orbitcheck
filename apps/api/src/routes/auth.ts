import crypto from "node:crypto";

import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import jwt from 'jsonwebtoken';
import type { Pool } from "pg";

import { API_KEY_NAMES, API_KEY_PREFIX, ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS, JWT_EXPIRES_IN, PG_UNIQUE_VIOLATION, PLAN_TYPES, PROJECT_NAMES, STATUS } from "../constants.js";
import { environment } from "../env.js";
import { generateRequestId, sendError, sendServerError } from "./utils.js";

export async function verifyJWT(request: FastifyRequest, rep: FastifyReply, pool: Pool) {
    const header = request.headers["authorization"];
    if (!header || !header.startsWith("Bearer ")) {
        rep.status(HTTP_STATUS.UNAUTHORIZED).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } });
        return;
    }
    const token = header.slice(7).trim();

    try {
        const decoded = jwt.verify(token, environment.JWT_SECRET) as { user_id: string };
        const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [decoded.user_id]);
        if (rows.length === 0) {
            rep.status(HTTP_STATUS.UNAUTHORIZED).send({ error: { code: ERROR_CODES.INVALID_TOKEN, message: ERROR_MESSAGES[ERROR_CODES.INVALID_TOKEN] } });
            return;
        }
        // eslint-disable-next-line require-atomic-updates
        request.user_id = decoded.user_id;

        // Get default project for user
        const { rows: projectRows } = await pool.query(
            'SELECT p.id as project_id FROM projects p WHERE p.user_id = $1 AND p.name = $2',
            [decoded.user_id, PROJECT_NAMES.DEFAULT]
        );
        if (projectRows.length === 0) {
            rep.status(HTTP_STATUS.FORBIDDEN).send({ error: { code: ERROR_CODES.NO_PROJECT, message: ERROR_MESSAGES[ERROR_CODES.NO_PROJECT] } });
            return;
        }
        // eslint-disable-next-line require-atomic-updates
        request.project_id = projectRows[0].project_id;
    } catch {
        rep.status(HTTP_STATUS.UNAUTHORIZED).send({ error: { code: ERROR_CODES.INVALID_TOKEN, message: "Invalid or expired token" } });
        return;
    }
}

export function registerAuthRoutes(app: FastifyInstance, pool: Pool) {
    app.post('/auth/register', {
        schema: {
            body: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 8 }
                }
            },
            response: {
                201: {
                    type: 'object',
                    properties: {
                        token: { type: 'string' },
                        user: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                email: { type: 'string' }
                            }
                        },
                        request_id: { type: 'string' }
                    }
                },
                400: { description: 'Invalid input' },
                409: { description: 'User already exists' }
            }
        }
    }, async (request, rep) => {
        try {
            const request_id = generateRequestId();
            const { email, password } = request.body as { email: string; password: string };
            const hashedPassword = await bcrypt.hash(password, 12);

            // Create user
            const { rows: userRows } = await pool.query(
                'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
                [email, hashedPassword]
            );

            if (userRows.length === 0) {
                return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.USER_EXISTS, ERROR_MESSAGES[ERROR_CODES.USER_EXISTS], request_id);
            }

            const user = userRows[0];

            // Create default project for user
            const { rows: projectRows } = await pool.query(
                'INSERT INTO projects (name, plan, user_id) VALUES ($1, $2, $3) RETURNING id',
                [PROJECT_NAMES.DEFAULT, PLAN_TYPES.DEV, user.id]
            );

            const projectId = projectRows[0].id;

            // Generate default API key
            const buf = new Promise<Buffer>((resolve, reject) => {
                crypto.randomBytes(32, (error, buf) => {
                    if (error) reject(error);
                    else resolve(buf);
                });
            });
            const fullKey = API_KEY_PREFIX + (await buf).toString('hex');
            const prefix = fullKey.slice(0, 6);
            const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');

            await pool.query(
                "INSERT INTO api_keys (project_id, prefix, hash, status, name) VALUES ($1, $2, $3, $4, $5)",
                [projectId, prefix, keyHash, STATUS.ACTIVE, API_KEY_NAMES.DEFAULT]
            );

            // Generate JWT
            const token = jwt.sign({ user_id: user.id }, environment.JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

            return rep.status(HTTP_STATUS.CREATED).send({ token, user, request_id });
        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === PG_UNIQUE_VIOLATION) { // Unique violation
                return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.USER_EXISTS, ERROR_MESSAGES[ERROR_CODES.USER_EXISTS], generateRequestId());
            }
            return sendServerError(request, rep, error, '/auth/register', generateRequestId());
        }
    });

    app.post('/auth/login', {
        schema: {
            body: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string' }
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        token: { type: 'string' },
                        user: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                email: { type: 'string' }
                            }
                        },
                        request_id: { type: 'string' }
                    }
                },
                401: { description: 'Invalid credentials' }
            }
        }
    }, async (request, rep) => {
        try {
            const request_id = generateRequestId();
            const { email, password } = request.body as { email: string; password: string };

            const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);

            if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password_hash))) {
                return sendError(rep, HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.INVALID_CREDENTIALS, ERROR_MESSAGES[ERROR_CODES.INVALID_CREDENTIALS], request_id);
            }

            const user = rows[0];
            const token = jwt.sign({ user_id: user.id }, environment.JWT_SECRET, { expiresIn: '7d' });

            return rep.send({ token, user: { id: user.id, email }, request_id });
        } catch (error) {
            return sendServerError(request, rep, error, '/auth/login', generateRequestId());
        }
    });
}