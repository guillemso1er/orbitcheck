import crypto from "node:crypto";

import { DASHBOARD_ROUTES } from "@orbitcheck/contracts";
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest, RawServerBase, RouteGenericInterface } from "fastify";
import type { Pool } from "pg";

import { API_KEY_PREFIX_LENGTH, AUDIT_ACTION_PAT_USED, AUDIT_RESOURCE_API, AUTHORIZATION_HEADER, BCRYPT_ROUNDS, BEARER_PREFIX, CRYPTO_KEY_BYTES, DEFAULT_PAT_NAME, ENCODING_HEX, ENCODING_UTF8, ENCRYPTION_ALGORITHM, HASH_ALGORITHM, HMAC_VALIDITY_MINUTES, LOGOUT_MESSAGE, PAT_PREFIX, PAT_SCOPES_ALL, PG_UNIQUE_VIOLATION, PLAN_TYPES, PROJECT_NAMES, STATUS } from "../config.js";
import { environment } from "../environment.js";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../errors.js";
import { errorSchema, generateRequestId, getDefaultProjectId, sendError, sendServerError } from "./utils.js";

// Enum for authentication methods
enum AuthMethod {
    SESSION = 'session',
    PAT = 'pat',
    API_KEY = 'api_key',
    HMAC = 'hmac',
    NONE = 'none'
}

// Helper function to detect authentication method
function detectAuthMethod<TServer extends RawServerBase = RawServerBase>(request: FastifyRequest<RouteGenericInterface, TServer>): AuthMethod {
    const authHeader = request.headers["authorization"];

    // Check for session
    if (request.session?.user_id) {
        return AuthMethod.SESSION;
    }

    // Check for Bearer token (could be PAT or API key)
    if (authHeader?.startsWith("Bearer ")) {
        // We'll determine if it's PAT or API key during verification
        return AuthMethod.PAT; // Default to PAT, will fallback if needed
    }

    // Check for HMAC
    if (authHeader?.startsWith("HMAC ")) {
        return AuthMethod.HMAC;
    }

    return AuthMethod.NONE;
}

export async function verifyAPIKey<TServer extends RawServerBase = RawServerBase>(request: FastifyRequest<RouteGenericInterface, TServer>, rep: FastifyReply<RouteGenericInterface, TServer>, pool: Pool): Promise<void> {
    const header = request.headers["authorization"];
    if (!header || !header.startsWith("Bearer ")) {
        request.log.info('No Bearer header for API key auth');
        rep.status(HTTP_STATUS.UNAUTHORIZED).send({
            error: {
                code: ERROR_CODES.UNAUTHORIZED,
                message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED]
            }
        });
        return;
    }

    const key = header.slice(7).trim();
    const prefix = key.slice(0, API_KEY_PREFIX_LENGTH);

    // Compute SHA-256 hash for secure storage and comparison
    const keyHash = crypto.createHash(HASH_ALGORITHM).update(key).digest('hex');

    // Query for active key matching full hash and prefix
    const { rows } = await pool.query(
        "select id, project_id from api_keys where hash=$1 and prefix=$2 and status=$3",
        [keyHash, prefix, STATUS.ACTIVE]
    );

    if (rows.length === 0) {
        rep.status(HTTP_STATUS.UNAUTHORIZED).send({
            error: {
                code: ERROR_CODES.UNAUTHORIZED,
                message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED]
            }
        });
        return;
    }

    // Update usage timestamp for auditing and analytics
    await pool.query(
        "UPDATE api_keys SET last_used_at = now() WHERE id = $1",
        [rows[0].id]
    );

    // Attach project_id to request for downstream route access
    request.project_id = rows[0].project_id;
}

// Refactored HMAC verification (extracted from auth function)
export async function verifyHMAC<TServer extends RawServerBase = RawServerBase>(request: FastifyRequest<RouteGenericInterface, TServer>, rep: FastifyReply<RouteGenericInterface, TServer>, pool: Pool): Promise<void> {
    const header = request.headers.authorization || '';
    if (!header.startsWith('HMAC ')) {
        rep.status(HTTP_STATUS.UNAUTHORIZED).send({
            error: {
                code: ERROR_CODES.UNAUTHORIZED,
                message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED]
            }
        });
        return;
    }

    const params = new URLSearchParams(header.slice(5).trim());
    const keyId = params.get('keyId');
    const signature = params.get('signature');
    const ts = params.get('ts');
    const nonce = params.get('nonce');

    if (!keyId || !signature || !ts || !nonce) {
        request.log.info('Missing HMAC parameters');
        rep.status(HTTP_STATUS.UNAUTHORIZED).send({
            error: {
                code: ERROR_CODES.UNAUTHORIZED,
                message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED]
            }
        });
        return;
    }

    // Check ts is recent (within 5 minutes)
    const now = Date.now();
    const requestTs = parseInt(ts);
    if (Math.abs(now - requestTs) > HMAC_VALIDITY_MINUTES * 60 * 1000) {
        request.log.info('HMAC ts too old');
        rep.status(HTTP_STATUS.UNAUTHORIZED).send({
            error: {
                code: ERROR_CODES.UNAUTHORIZED,
                message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED]
            }
        });
        return;
    }

    // Query for active key by prefix
    const { rows } = await pool.query(
        "select id, project_id, encrypted_key from api_keys where prefix=$1 and status=$2",
        [keyId, STATUS.ACTIVE]
    );

    if (rows.length === 0) {
        request.log.info('No active API key found for HMAC keyId');
        rep.status(HTTP_STATUS.UNAUTHORIZED).send({
            error: {
                code: ERROR_CODES.UNAUTHORIZED,
                message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED]
            }
        });
        return;
    }

    // Decrypt the full key
    const encryptedWithIv = rows[0].encrypted_key;
    const [ivHex, encrypted] = encryptedWithIv.split(':');
    const iv = Buffer.from(ivHex, ENCODING_HEX);
    const decipher = crypto.createDecipheriv(
        ENCRYPTION_ALGORITHM,
        Buffer.from(environment.ENCRYPTION_KEY, ENCODING_HEX),
        iv
    );
    let decrypted = decipher.update(encrypted, ENCODING_HEX, ENCODING_UTF8);
    decrypted += decipher.final(ENCODING_UTF8);
    const fullKey = decrypted;

    const message = request.method.toUpperCase() + request.url + ts + nonce;

    const expectedSignature = crypto
        .createHmac('sha256', fullKey)
        .update(message, 'utf8')
        .digest('hex');

    // timing-safe compare
    const ok =
        signature.length === expectedSignature.length &&
        crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );

    if (!ok) {
        request.log.info('HMAC signature mismatch');
        rep.status(HTTP_STATUS.UNAUTHORIZED).send({
            error: {
                code: ERROR_CODES.UNAUTHORIZED,
                message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED]
            }
        });
        return;
    }

    request.log.info('HMAC signature verified');

    // Update usage timestamp
    await pool.query(
        "UPDATE api_keys SET last_used_at = now() WHERE id = $1",
        [rows[0].id]
    );

    // Attach project_id
    request.project_id = rows[0].project_id;
}

export async function authenticateRouteRequest<TServer extends RawServerBase = RawServerBase>(
    request: FastifyRequest<RouteGenericInterface, TServer>,
    rep: FastifyReply<RouteGenericInterface, TServer>,
    pool: Pool,
    routeType: 'dashboard' | 'mgmt' | 'runtime' | 'public'
): Promise<void> {
    const authMethod = detectAuthMethod(request);

    request.log.info(`Route type: ${routeType}, Auth method detected: ${authMethod}`);

    // Handle public routes
    if (routeType === 'public') {
        request.log.info('No auth required for public route');
        return;
    }

    // Dashboard routes require session authentication
    if (routeType === 'dashboard') {
        if (authMethod !== AuthMethod.SESSION) {
            request.log.info('Dashboard route requires session auth');
            rep.status(HTTP_STATUS.UNAUTHORIZED).send({
                error: {
                    code: ERROR_CODES.UNAUTHORIZED,
                    message: 'Dashboard routes require session authentication'
                }
            });
            return;
        }
        try {
            await verifySession(request, pool);
            return;
        } catch (error) {
            const err = error as any;
            rep.status(err.status).send({ error: err.error });
            return;
        }
    }

    // Management routes: Allow session or PAT only
    if (routeType === 'mgmt') {
        switch (authMethod) {
            case AuthMethod.SESSION:
                request.log.info('Using session auth for management route');
                try {
                    await verifySession(request, pool);
                    return;
                } catch (error) {
                    rep.status(HTTP_STATUS.UNAUTHORIZED).send({
                        error: {
                            code: ERROR_CODES.UNAUTHORIZED,
                            message: 'Management routes require session or PAT authentication'
                        }
                    });
                    return;
                }

            case AuthMethod.PAT:
                request.log.info('Using PAT auth for management route');
                try {
                    await verifyPAT(request, pool);
                    return;
                } catch (error) {
                    rep.status(HTTP_STATUS.UNAUTHORIZED).send({
                                error: {
                                    code: ERROR_CODES.UNAUTHORIZED,
                                    message: 'Management routes require session or PAT authentication'
                                }
                            });
                    return;
                }

            default:
                request.log.info('Management route requires session or PAT auth');
                rep.status(HTTP_STATUS.UNAUTHORIZED).send({
                    error: {
                        code: ERROR_CODES.UNAUTHORIZED,
                        message: 'Management routes require session or PAT authentication'
                    }
                });
                return;
        }
    }

    // Runtime routes: Allow all authentication methods
    if (routeType === 'runtime') {
        switch (authMethod) {
            case AuthMethod.SESSION:
                request.log.info('Using session auth for runtime route');
                try {
                    await verifySession(request, pool);
                    return;
                } catch (error) {
                    rep.status(HTTP_STATUS.UNAUTHORIZED).send({
                        error: {
                            code: ERROR_CODES.UNAUTHORIZED,
                            message: 'Runtime routes require authentication'
                        }
                    });
                    return;
                }

            case AuthMethod.PAT:
                request.log.info('Attempting PAT auth for runtime route');
                try {
                    await verifyPAT(request, pool);
                    return;
                } catch (error) {
                    // If PAT fails, might be an API key
                    request.log.info('PAT auth failed, trying API key auth');
                    try {
                        await verifyAPIKey(request, rep, pool);
                        return;
                    } catch {
                        rep.status(HTTP_STATUS.UNAUTHORIZED).send({
                            error: {
                                code: ERROR_CODES.UNAUTHORIZED,
                                message: 'Runtime routes require authentication'
                            }
                        });
                        return;
                    }
                }

            case AuthMethod.HMAC:
                request.log.info('Using HMAC auth for runtime route');
                try {
                    await verifyHMAC(request, rep, pool);
                    return;
                } catch {
                    rep.status(HTTP_STATUS.UNAUTHORIZED).send({
                        error: {
                            code: ERROR_CODES.UNAUTHORIZED,
                            message: 'Runtime routes require authentication'
                        }
                    });
                    return;
                }

            default:
                // For Bearer tokens on runtime routes, try PAT first, then API key
                if (request.headers["authorization"]?.startsWith("Bearer ")) {
                    try {
                        await verifyPAT(request, pool);
                    } catch {
                        try {
                            await verifyAPIKey(request, rep, pool);
                        } catch {
                            rep.status(HTTP_STATUS.UNAUTHORIZED).send({
                                error: {
                                    code: ERROR_CODES.UNAUTHORIZED,
                                    message: 'Runtime routes require authentication'
                                }
                            });
                            return;
                        }
                    }
                    return;
                }

                request.log.info('Runtime route requires authentication');
                rep.status(HTTP_STATUS.UNAUTHORIZED).send({
                    error: {
                        code: ERROR_CODES.UNAUTHORIZED,
                        message: 'Runtime routes require authentication'
                    }
                });
                return;
        }
    }
}
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
export async function verifySession<TServer extends RawServerBase = RawServerBase>(request: FastifyRequest<RouteGenericInterface, TServer>, pool: Pool): Promise<void> {
    if (!request.session || !request.session.user_id) {
        throw { status: HTTP_STATUS.UNAUTHORIZED, error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } };
    }

    const user_id = request.session.user_id;
    const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [user_id]);
    if (rows.length === 0) {
        // Invalid session - clear it
        request.session.user_id = undefined;
        throw { status: HTTP_STATUS.UNAUTHORIZED, error: { code: ERROR_CODES.INVALID_TOKEN, message: ERROR_MESSAGES[ERROR_CODES.INVALID_TOKEN] } };
    }

    // Get default project for user
    try {
        const projectId = await getDefaultProjectId(pool, user_id);
        request.user_id = user_id;
        request.project_id = projectId;
    } catch (error) {
        throw { status: HTTP_STATUS.FORBIDDEN, error: { code: ERROR_CODES.NO_PROJECT, message: ERROR_MESSAGES[ERROR_CODES.NO_PROJECT] } };
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
export async function verifyPAT<TServer extends RawServerBase = RawServerBase>(request: FastifyRequest<RouteGenericInterface, TServer>, pool: Pool): Promise<void> {
    const header = request.headers[AUTHORIZATION_HEADER];
    const authHeader = Array.isArray(header) ? header[0] : header;
    if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
        request.log.info('No or invalid Bearer header for PAT auth');
        throw { status: HTTP_STATUS.UNAUTHORIZED, error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } };
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
        throw { status: HTTP_STATUS.UNAUTHORIZED, error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } };
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
        throw { status: HTTP_STATUS.FORBIDDEN, error: { code: ERROR_CODES.NO_PROJECT, message: ERROR_MESSAGES[ERROR_CODES.NO_PROJECT] } };
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
            request.log.info({ email: !!email, password: !!password, confirm_password: !!confirm_password, passwordType: typeof password, bodyKeys: Object.keys(body) }, 'Auth register body check');
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
            await pool.query(
                'INSERT INTO projects (name, plan, user_id) VALUES ($1, $2, $3) RETURNING id',
                [PROJECT_NAMES.DEFAULT, PLAN_TYPES.DEV, user.id]
            );

            // Set session cookie for dashboard access
            request.session.user_id = user.id;

            const response: any = {
                user,
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