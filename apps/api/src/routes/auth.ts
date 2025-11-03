import crypto from "node:crypto";

import { DASHBOARD_ROUTES } from "@orbitcheck/contracts";
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { API_KEY_NAMES, API_KEY_PREFIX, API_KEY_PREFIX_LENGTH, AUDIT_ACTION_PAT_USED, AUDIT_RESOURCE_API, AUTHORIZATION_HEADER, BCRYPT_ROUNDS, BEARER_PREFIX, CRYPTO_IV_BYTES, CRYPTO_KEY_BYTES, DEFAULT_PAT_NAME, ENCODING_HEX, ENCODING_UTF8, ENCRYPTION_ALGORITHM, HASH_ALGORITHM, LOGOUT_MESSAGE, PAT_PREFIX, PAT_SCOPES_ALL, PG_UNIQUE_VIOLATION, PLAN_TYPES, PROJECT_NAMES, RANDOM_BYTES_FOR_API_KEY, STATUS } from "../config.js";
import { environment } from "../environment.js";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../errors.js";
import { errorSchema, generateRequestId, getDefaultProjectId, sendError, sendServerError } from "./utils.js";

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
    if (!request.session || !request.session.user_id) {
        rep.status(HTTP_STATUS.BAD_REQUEST).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } });
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

    // Get default project for user
    try {
        const projectId = await getDefaultProjectId(pool, user_id);
        request.user_id = user_id;
        request.project_id = projectId;
    } catch (error) {
        rep.status(HTTP_STATUS.FORBIDDEN).send({ error: { code: ERROR_CODES.NO_PROJECT, message: ERROR_MESSAGES[ERROR_CODES.NO_PROJECT] } });
        return;
    }
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
    const header = request.headers[AUTHORIZATION_HEADER];
    const authHeader = Array.isArray(header) ? header[0] : header;
    if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
        request.log.info('No or invalid Bearer header for PAT auth');
        rep.status(HTTP_STATUS.BAD_REQUEST).send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } });
        return;
    }
    const token = authHeader.slice(7).trim();
    const tokenHash = crypto.createHash(HASH_ALGORITHM).update(token).digest('hex');

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

    // Get default project for user and attach all properties atomically
    try {
        const userId = rows[0].user_id;
        const projectId = await getDefaultProjectId(pool, userId);
        request.user_id = userId;
        request.pat_scopes = rows[0].scopes || [];
        request.project_id = projectId;
    } catch (error) {
        rep.status(HTTP_STATUS.FORBIDDEN).send({ error: { code: ERROR_CODES.NO_PROJECT, message: ERROR_MESSAGES[ERROR_CODES.NO_PROJECT] } });
        return;
    }

    // Audit PAT usage
    await pool.query(
        "INSERT INTO audit_logs (user_id, action, resource, details) VALUES ($1, $2, $3, $4)",
        [rows[0].user_id, AUDIT_ACTION_PAT_USED, AUDIT_RESOURCE_API, JSON.stringify({ token_id: rows[0].id, url: request.url })]
    );
}

export function registerAuthRoutes(app: FastifyInstance, pool: Pool): void {
    app.post(DASHBOARD_ROUTES.REGISTER_NEW_USER, {
        schema: {
            body: {
                type: 'object',
                required: ['email', 'password', 'confirm_password'],
                properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 8 },
                    confirm_password: { type: 'string', minLength: 8 }
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
            const { email, password, confirm_password } = body;
            request.log.info({ email: !!email, password: !!password, confirm_password: !!confirm_password, passwordType: typeof password, bodyKeys: Object.keys(body)}, 'Auth register body check');
            if (!password || typeof password !== 'string') {
                return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_INPUT, 'Valid password is required', request_id);
            }
            if (!confirm_password || typeof confirm_password !== 'string') {
                return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_INPUT, 'Valid confirm_password is required', request_id);
            }
            if (password !== confirm_password) {
                return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_INPUT, 'Password and confirm_password do not match', request_id);
            }
            const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

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
                crypto.randomBytes(RANDOM_BYTES_FOR_API_KEY, (error, buf) => {
                    if (error) reject(error);
                    else resolve(buf);
                });
            });
            const fullKey = API_KEY_PREFIX + buf.toString('hex');
            const prefix = fullKey.slice(0, API_KEY_PREFIX_LENGTH);
            const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');

            // Encrypt the full key for HMAC verification
            const iv = await new Promise<Buffer>((resolve, reject) => {
                crypto.randomBytes(CRYPTO_IV_BYTES, (error, buf) => {
                    if (error) reject(error);
                    else resolve(buf);
                });
            });
            const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, Buffer.from(environment.ENCRYPTION_KEY, ENCODING_HEX), iv);
            let encrypted = await new Promise<string>((resolve, reject) => {
                try {
                    const updateResult = cipher.update(fullKey, ENCODING_UTF8, ENCODING_HEX);
                    const finalResult = cipher.final(ENCODING_HEX);
                    resolve(updateResult + finalResult);
                } catch (error) {
                    reject(error);
                }
            });
            const encryptedWithIv = iv.toString('hex') + ':' + encrypted;

            await pool.query(
                "INSERT INTO api_keys (project_id, prefix, hash, encrypted_key, status, name) VALUES ($1, $2, $3, $4, $5, $6)",
                [projectId, prefix, keyHash, encryptedWithIv, STATUS.ACTIVE, API_KEY_NAMES.DEFAULT]
            );

            // Generate PAT for management API access
            const patBuf = await new Promise<Buffer>((resolve, reject) => {
                crypto.randomBytes(CRYPTO_KEY_BYTES, (error, buf) => {
                    if (error) reject(error);
                    else resolve(buf);
                });
            });
            const patToken = PAT_PREFIX + patBuf.toString('hex');
            const patHash = crypto.createHash(HASH_ALGORITHM).update(patToken).digest('hex');
            const tokenId = crypto.randomUUID();

            await pool.query(
                "INSERT INTO personal_access_tokens (user_id, name, token_id, token_hash, scopes, env, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                [user.id, DEFAULT_PAT_NAME, tokenId, patHash, PAT_SCOPES_ALL, 'live', null]
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
                        pat_token: { type: 'string', description: 'Personal Access Token for dashboard access' },
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

            // Generate PAT for dashboard access
            const patBuf = await new Promise<Buffer>((resolve, reject) => {
                crypto.randomBytes(CRYPTO_KEY_BYTES, (error, buf) => {
                    if (error) reject(error);
                    else resolve(buf);
                });
            });
            const patToken = PAT_PREFIX + patBuf.toString('hex');
            const patHash = crypto.createHash(HASH_ALGORITHM).update(patToken).digest('hex');
            const tokenId = crypto.randomUUID();

            await pool.query(
                "INSERT INTO personal_access_tokens (user_id, name, token_id, token_hash, scopes, env, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                [user.id, DEFAULT_PAT_NAME, tokenId, patHash, PAT_SCOPES_ALL, 'live', null]
            );

            // Set session cookie for dashboard access
            request.session.user_id = user.id;

            const response: any = {
                user: { id: user.id, email: user.email },
                pat_token: patToken,
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
            // Clear session if it exists
            if (request.session) {
                request.session.user_id = undefined;
            }
            // For secure-session, we don't need destroy, just clear the data

            return rep.send({ message: LOGOUT_MESSAGE });
        } catch (error) {
            return sendServerError(request, rep, error, DASHBOARD_ROUTES.USER_LOGOUT, generateRequestId());
        }
    });
}