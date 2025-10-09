import crypto from "node:crypto";

import { DASHBOARD_ROUTES } from "@orbicheck/contracts";
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { API_KEY_NAMES, API_KEY_PREFIX, ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS, PG_UNIQUE_VIOLATION, PLAN_TYPES, PROJECT_NAMES, STATUS } from "../constants.js";
import { environment } from "../environment.js";
import { errorSchema, generateRequestId, sendError, sendServerError } from "./utils.js";

/**
 * Verifies session cookie for dashboard authentication.
 * Checks if user_id exists in session and validates against database.
 * Attaches user_id and default project_id to request.
 *
 * @param request - Fastify request object with session
 * @param rep - Fastify reply object
 * @param pool - PostgreSQL connection pool
 * @returns {Promise<void>} Resolves on success, sends 401 on failure
 */
export async function verifySession(request: FastifyRequest, rep: FastifyReply, pool: Pool): Promise<void> {
    if (!request.session.user_id) {
        rep.status(HTTP_STATUS.UNAUTHORIZED).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } });
        return;
    }

    const user_id = request.session.user_id;
    const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [user_id]);
    if (rows.length === 0) {
        // Invalid session - clear it
        request.session.user_id = undefined;
        rep.status(HTTP_STATUS.UNAUTHORIZED).send({ error: { code: ERROR_CODES.INVALID_TOKEN, message: ERROR_MESSAGES[ERROR_CODES.INVALID_TOKEN] } });
        return;
    }
    // eslint-disable-next-line require-atomic-updates
    request.user_id = user_id;

    // Get default project for user
    const { rows: projectRows } = await pool.query(
        'SELECT p.id as project_id FROM projects p WHERE p.user_id = $1 AND p.name = $2',
        [user_id, PROJECT_NAMES.DEFAULT]
    );
    if (projectRows.length === 0) {
        rep.status(HTTP_STATUS.FORBIDDEN).send({ error: { code: ERROR_CODES.NO_PROJECT, message: ERROR_MESSAGES[ERROR_CODES.NO_PROJECT] } });
        return;
    }
    // eslint-disable-next-line require-atomic-updates
    request.project_id = projectRows[0].project_id;
}

/**
 * Verifies Personal Access Token for management API authentication.
 * Validates token hash, checks expiration, and applies scopes.
 * Updates last_used_at and logs audit entry.
 *
 * @param request - Fastify request object with Authorization header
 * @param rep - Fastify reply object
 * @param pool - PostgreSQL connection pool
 * @returns {Promise<void>} Resolves on success, sends 401 on failure
 */
export async function verifyPAT(request: FastifyRequest, rep: FastifyReply, pool: Pool): Promise<void> {
    const header = request.headers["authorization"];
    if (!header || !header.startsWith("Bearer ")) {
        request.log.info('No or invalid Bearer header for PAT auth');
        rep.status(HTTP_STATUS.UNAUTHORIZED).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } });
        return;
    }
    const token = header.slice(7).trim();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    request.log.info('Verifying PAT with hash');

    // Query for active PAT matching hash and not expired
    const { rows } = await pool.query(
        "select id, user_id, scopes from personal_access_tokens where token_hash=$1 and (expires_at is null or expires_at > now())",
        [tokenHash]
    );

    if (rows.length === 0) {
        rep.status(HTTP_STATUS.UNAUTHORIZED).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } });
        return;
    }

    // Update usage timestamp
    await pool.query(
        "UPDATE personal_access_tokens SET last_used_at = now() WHERE id = $1",
        [rows[0].id]
    );

    // Attach user_id and scopes to request
    // eslint-disable-next-line require-atomic-updates
    request.user_id = rows[0].user_id;
    // eslint-disable-next-line require-atomic-updates
    request.pat_scopes = rows[0].scopes || [];

    // Get default project for user
    const { rows: projectRows } = await pool.query(
        'SELECT p.id as project_id FROM projects p WHERE p.user_id = $1 AND p.name = $2',
        [rows[0].user_id, PROJECT_NAMES.DEFAULT]
    );
    if (projectRows.length === 0) {
        rep.status(HTTP_STATUS.FORBIDDEN).send({ error: { code: ERROR_CODES.NO_PROJECT, message: ERROR_MESSAGES[ERROR_CODES.NO_PROJECT] } });
        return;
    }
    // eslint-disable-next-line require-atomic-updates
    request.project_id = projectRows[0].project_id;

    // Audit PAT usage
    await pool.query(
        "INSERT INTO audit_logs (user_id, action, resource, details) VALUES ($1, $2, $3, $4)",
        [rows[0].user_id, 'pat_used', 'api', JSON.stringify({ token_id: rows[0].id, url: request.url })]
    );
}

export function registerAuthRoutes(app: FastifyInstance, pool: Pool): void {
    app.post(DASHBOARD_ROUTES.REGISTER_NEW_USER, {
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
                    description: 'User registered successfully',
                    type: 'object',
                    properties: {
                        user: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                email: { type: 'string' }
                            }
                        },
                        pat_token: { type: 'string', description: 'Personal Access Token for CLI/automation' },
                        api_key: { type: 'string', description: 'API key for runtime endpoints' },
                        request_id: { type: 'string' }
                    }
                },
                400: { description: 'Invalid input data', ...errorSchema },
                409: { description: 'User already exists', ...errorSchema }
            }
        }
    }, async (request, rep) => {
        try {
            const request_id = generateRequestId();
            const body = request.body as any;
            const { email, password } = body;
            const hashedPassword = await bcrypt.hash(password, 12);

            // Create user
            const { rows: userRows } = await pool.query(
                'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
                [email, hashedPassword]
            );

            if (userRows.length === 0) {
                return await sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.USER_EXISTS, ERROR_MESSAGES[ERROR_CODES.USER_EXISTS], request_id);
            }

            const user = userRows[0];

            // Create default project for user
            const { rows: projectRows } = await pool.query(
                'INSERT INTO projects (name, plan, user_id) VALUES ($1, $2, $3) RETURNING id',
                [PROJECT_NAMES.DEFAULT, PLAN_TYPES.DEV, user.id]
            );

            const projectId = projectRows[0].id;

            // Generate API key for runtime endpoints
            const buf = await new Promise<Buffer>((resolve, reject) => {
                crypto.randomBytes(32, (error, buf) => {
                    if (error) reject(error);
                    else resolve(buf);
                });
            });
            const fullKey = API_KEY_PREFIX + buf.toString('hex');
            const prefix = fullKey.slice(0, 6);
            const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');

            // Encrypt the full key for HMAC verification
            const iv = await new Promise<Buffer>((resolve, reject) => {
                crypto.randomBytes(16, (error, buf) => {
                    if (error) reject(error);
                    else resolve(buf);
                });
            });
            const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(environment.ENCRYPTION_KEY, 'hex'), iv);
            let encrypted = cipher.update(fullKey, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const encryptedWithIv = iv.toString('hex') + ':' + encrypted;

            await pool.query(
                "INSERT INTO api_keys (project_id, prefix, hash, encrypted_key, status, name) VALUES ($1, $2, $3, $4, $5, $6)",
                [projectId, prefix, keyHash, encryptedWithIv, STATUS.ACTIVE, API_KEY_NAMES.DEFAULT]
            );

            // Generate PAT for management API access
            const patBuf = await new Promise<Buffer>((resolve, reject) => {
                crypto.randomBytes(32, (error, buf) => {
                    if (error) reject(error);
                    else resolve(buf);
                });
            });
            const patToken = 'pat_' + patBuf.toString('hex');
            const patHash = crypto.createHash('sha256').update(patToken).digest('hex');

            await pool.query(
                "INSERT INTO personal_access_tokens (user_id, name, token_hash, scopes, expires_at) VALUES ($1, $2, $3, $4, $5)",
                [user.id, 'Default PAT', patHash, ['*'], null]
            );

            // Set session cookie for dashboard access
            request.session.user_id = user.id;

            const response: any = {
                user,
                pat_token: patToken,
                api_key: fullKey,
                request_id
            };
            return rep.status(HTTP_STATUS.CREATED).send(response);
        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === PG_UNIQUE_VIOLATION) {
                return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.USER_EXISTS, ERROR_MESSAGES[ERROR_CODES.USER_EXISTS], generateRequestId());
            }
            return sendServerError(request, rep, error, DASHBOARD_ROUTES.REGISTER_NEW_USER, generateRequestId());
        }
    });

    app.post(DASHBOARD_ROUTES.USER_LOGIN, {
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
                    description: 'Login successful',
                    type: 'object',
                    properties: {
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
                401: { description: 'Invalid credentials', ...errorSchema }
            }
        }
    }, async (request, rep) => {
        try {
            const request_id = generateRequestId();
            const body = request.body as any;
            const { email, password } = body;

            const { rows } = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);

            if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password_hash))) {
                return await sendError(rep, HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.INVALID_CREDENTIALS, ERROR_MESSAGES[ERROR_CODES.INVALID_CREDENTIALS], request_id);
            }

            const user = rows[0];

            // Set session cookie for dashboard access
            request.session.user_id = user.id;

            const response: any = {
                user: { id: user.id, email: user.email },
                request_id
            };
            return rep.send(response);
        } catch (error) {
            return sendServerError(request, rep, error, DASHBOARD_ROUTES.USER_LOGIN, generateRequestId());
        }
    });

    // Add logout endpoint
    app.post(DASHBOARD_ROUTES.USER_LOGOUT, async (request, rep) => {
        try {
            console.log('Logout request.session exists:', !!request.session);
            // Clear session if it exists
            if (request.session) {
                request.session.user_id = undefined;
            }
            // For secure-session, we don't need destroy, just clear the data

            return rep.send({ message: 'Logged out successfully' });
        } catch (error) {
            console.log('Logout error:', error);
            return sendServerError(request, rep, error, DASHBOARD_ROUTES.USER_LOGOUT, generateRequestId());
        }
    });
}