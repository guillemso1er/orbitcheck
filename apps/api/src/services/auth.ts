import { DASHBOARD_ROUTES } from "@orbitcheck/contracts";
import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest, RawServerBase, RouteGenericInterface } from "fastify";
import crypto from "node:crypto";
import type { Pool } from "pg";
import { API_KEY_PREFIX_LENGTH, BCRYPT_ROUNDS, DEFAULT_PAT_NAME, HASH_ALGORITHM, LOGOUT_MESSAGE, PAT_SCOPES_ALL, PG_UNIQUE_VIOLATION, PROJECT_NAMES, STATUS } from "../config.js";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../errors.js";
import type { LoginUserData, LoginUserResponses, LogoutUserResponses, RegisterUserData, RegisterUserResponses } from "../generated/fastify/types.gen.js";
import { createPat } from "../routes/pats.js";
import { getDefaultProjectId, sendError, sendServerError } from "../routes/utils.js";
import { createPlansService } from "./plans.js";



export async function verifyAPIKey<TServer extends RawServerBase = RawServerBase>(request: FastifyRequest<RouteGenericInterface, TServer>, _rep: FastifyReply<RouteGenericInterface, TServer>, pool: Pool): Promise<boolean> {
    const header = request.headers["authorization"];
    if (!header || !header.startsWith("Bearer ")) {
        request.log.info('No Bearer header for API key auth');
        return false;
    }

    const key = header.slice(7).trim();
    const prefix = key.slice(0, API_KEY_PREFIX_LENGTH);
    const keyHash = crypto.createHash(HASH_ALGORITHM).update(key).digest('hex');

    const { rows } = await pool.query(
        "select id, project_id from api_keys where hash=$1 and prefix=$2 and status=$3",
        [keyHash, prefix, STATUS.ACTIVE]
    );

    if (rows.length === 0) {
        request.log.info('Invalid API key provided');
        return false;
    }

    await pool.query(
        "UPDATE api_keys SET last_used_at = now() WHERE id = $1",
        [rows[0].id]
    );

    (request as any).project_id = rows[0].project_id;
    return true;
}

export async function verifySession<TServer extends RawServerBase = RawServerBase>(request: FastifyRequest<RouteGenericInterface, TServer>, pool: Pool): Promise<void> {
    if (!request.session || !request.session.user_id) {
        throw { status: HTTP_STATUS.UNAUTHORIZED, error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES[ERROR_CODES.UNAUTHORIZED] } };
    }

    const user_id = request.session.user_id;
    const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [user_id]);
    if (rows.length === 0) {
        request.session.user_id = undefined;
        throw { status: HTTP_STATUS.UNAUTHORIZED, error: { code: ERROR_CODES.INVALID_TOKEN, message: ERROR_MESSAGES[ERROR_CODES.INVALID_TOKEN] } };
    }

    try {
        const projectId = await getDefaultProjectId(pool, user_id);
        request.user_id = user_id;
        request.project_id = projectId;
    } catch (error) {
        throw { status: HTTP_STATUS.FORBIDDEN, error: { code: ERROR_CODES.NO_PROJECT, message: ERROR_MESSAGES[ERROR_CODES.NO_PROJECT] } };
    }
}

export async function registerUser(
    request: FastifyRequest<{ Body: RegisterUserData['body'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    try {
        const request_id = generateRequestId();
        const body = request.body as RegisterUserData['body'];
        const { email, password, confirm_password } = body;

        if (!email || typeof email !== 'string' || !email.includes('@')) {
            return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_INPUT, 'Valid email is required', request_id);
        }
        if (!password || typeof password !== 'string') {
            return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_INPUT, 'Valid password is required', request_id);
        }
        if (password.length < 8) {
            return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_INPUT, 'Password must be at least 8 characters', request_id);
        }
        if (!confirm_password || typeof confirm_password !== 'string') {
            return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_INPUT, 'Valid confirm_password is required', request_id);
        }
        if (password !== confirm_password) {
            return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_INPUT, 'Password and confirm_password do not match', request_id);
        }

        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

        const { rows: userRows } = await pool.query(
            'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
            [email, hashedPassword]
        );

        if (userRows.length === 0) {
            return await sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.USER_EXISTS, ERROR_MESSAGES[ERROR_CODES.USER_EXISTS], request_id);
        }

        const user = userRows[0];

        // Assign default Free plan to user
        await createPlansService(pool).assignDefaultPlan(user.id);

        // Create default project for user
        await pool.query(
            'INSERT INTO projects (name, user_id) VALUES ($1, $2) RETURNING id',
            [PROJECT_NAMES.DEFAULT, user.id]
        );

        // Set session cookie for dashboard access
        request.session.user_id = user.id;

        const response: RegisterUserResponses[201] = { user, request_id };
        return rep.status(HTTP_STATUS.CREATED).send(response);
    } catch (error: any) {
        if (error.code === PG_UNIQUE_VIOLATION) {
            return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.USER_EXISTS, ERROR_MESSAGES[ERROR_CODES.USER_EXISTS], generateRequestId());
        }
        return sendServerError(request, rep, error, DASHBOARD_ROUTES.REGISTER_NEW_USER, generateRequestId());
    }
}

export async function loginUser(
    request: FastifyRequest<{ Body: LoginUserData['body'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    try {
        const request_id = generateRequestId();
        const body = request.body as LoginUserData['body'];
        const { email, password } = body;

        const { rows } = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);

        if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password_hash))) {
            return await sendError(rep, HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.INVALID_CREDENTIALS, ERROR_MESSAGES[ERROR_CODES.INVALID_CREDENTIALS], request_id);
        }

        const user = rows[0];

        // Generate PAT for dashboard access
        const { token: patToken, tokenId, hashedSecret } = await createPat({
            userId: user.id,
            name: DEFAULT_PAT_NAME,
            scopes: [...PAT_SCOPES_ALL],
            env: 'live',
            expiresAt: null,
            ipAllowlist: undefined,
            projectId: undefined
        });

        await pool.query(
            "INSERT INTO personal_access_tokens (user_id, token_id, token_hash, name, scopes, env, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [user.id, tokenId, hashedSecret, DEFAULT_PAT_NAME, [...PAT_SCOPES_ALL], 'live', null]
        );

        // Set session cookie for dashboard access
        request.session.user_id = user.id;

        const response: LoginUserResponses[200] = {
            user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, created_at: user.created_at, updated_at: user.updated_at },
            pat_token: patToken,
            request_id
        };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, DASHBOARD_ROUTES.USER_LOGIN, generateRequestId());
    }
}

export async function logoutUser(
    request: FastifyRequest,
    rep: FastifyReply
): Promise<FastifyReply> {
    try {
        if (request.session) {
            request.session.user_id = undefined;
        }

        const response: LogoutUserResponses[200] = { message: LOGOUT_MESSAGE };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, DASHBOARD_ROUTES.USER_LOGOUT, generateRequestId());
    }
}

function generateRequestId(): string {
    return crypto.randomUUID();
}