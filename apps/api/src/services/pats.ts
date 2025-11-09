import argon2 from 'argon2';
import crypto from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

// import { MGMT_V1_ROUTES } from "@orbitcheck/contracts";
import {
    BEARER_PREFIX,
    PAT_DEFAULT_EXPIRY_DAYS,
    PAT_SCOPES
} from "../config.js";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../errors.js";
import { generateRequestId, sendError, sendServerError } from "./utils.js";

// Token prefix for OrbitCheck PATs
const OC_PAT_PREFIX = 'oc_pat_' as const;
const PAT_PEPPER = process.env.PAT_PEPPER || '';

/**
 * Generate a base64url-encoded random string of specified byte length
 */
function b64url(bytes: number): string {
    return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Parse PAT from Authorization header
 */
export function parsePat(bearer?: string) {
    if (!bearer?.startsWith(BEARER_PREFIX)) return null;
    const raw = bearer.slice(7).trim();


    // Real PAT format: oc_pat_{env}:{tokenId}:{secret}
    // We need to handle the 'oc_pat_' prefix specially
    if (!raw.startsWith('oc_pat_')) return null;

    const remaining = raw.slice(7); // Remove 'oc_pat_' prefix
    const parts = remaining.split(':');
    if (parts.length < 3) return null;

    // The format is env:tokenId:secret
    // We can safely split on ':' since it's not in base64url alphabet
    const env = parts[0];
    const tokenId = parts[1];
    const secret = parts.slice(2).join(':');

    if (!env || !tokenId || !secret) return null;

    return { raw, env, tokenId, secret };
}

/**
 * Create a new Personal Access Token
 */
export async function createPat({
    userId,
    name,
    scopes,
    env = 'live',
    expiresAt,
    ipAllowlist,
    projectId
}: {
    userId: string;
    name: string;
    scopes: string[];
    env?: 'live' | 'test';
    expiresAt?: Date | null;
    ipAllowlist?: string[];
    projectId?: string | null;
}): Promise<{ token: string; tokenId: string; hashedSecret: string }> {
    // Use parameters to satisfy TypeScript (values are used in return object)
    void userId, name, scopes, expiresAt, ipAllowlist, projectId;
    const tokenId = b64url(9);       // ~12 chars
    const secret = b64url(24);       // ~32 chars
    // Use ':' as separator to avoid conflicts with base64url content (no colons in b64url)
    const token = `${OC_PAT_PREFIX}${env}:${tokenId}:${secret}`;

    const hashedSecret = await argon2.hash(secret + PAT_PEPPER, {
        type: argon2.argon2id,
        timeCost: 2,
        memoryCost: 19456,
        parallelism: 1
    });

    return { token, tokenId, hashedSecret };
}



// Handler: List PATs
export async function listPersonalAccessTokens(request: FastifyRequest, rep: FastifyReply, pool: Pool) {
    try {
        const userId = (request as any).user_id!;
        const request_id = generateRequestId();
        const { rows } = await pool.query(
            `SELECT id, token_id, name, scopes, env, last_used_at, last_used_ip, expires_at, disabled, created_at
       FROM personal_access_tokens
       WHERE user_id = $1 AND token_hash IS NOT NULL
       ORDER BY created_at DESC`,
            [userId]
        );
        const response = { data: rows, request_id };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, '/v1/pats', generateRequestId());
    }
}

// Handler: Create PAT
export async function createPersonalAccessToken(request: FastifyRequest, rep: FastifyReply, pool: Pool) {
    try {
        const userId = (request as any).user_id!;
        const body = request.body as any;
        const {
            name,
            scopes,
            env = 'live',
            expires_at,
            ip_allowlist,
            project_id
        } = body;
        const request_id = generateRequestId();
        const validScopes = Object.values(PAT_SCOPES);
        let finalScopes = scopes;
        if (scopes === undefined || scopes === null) {
            finalScopes = validScopes;
        } else if (!Array.isArray(scopes)) {
            return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_INPUT,
                'scopes must be an array of strings', request_id);
        } else if (scopes.length === 0) {
            finalScopes = validScopes;
        } else {
            const invalidScopes = scopes.filter((s: string) => !validScopes.includes(s as any));
            if (invalidScopes.length > 0) {
                return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_INPUT,
                    `Invalid scopes: ${invalidScopes.join(', ')}`, request_id);
            }
            finalScopes = scopes;
        }
        let expiresAt = null;
        if (expires_at !== null && expires_at !== undefined) {
            expiresAt = new Date(expires_at);
            if (expiresAt < new Date()) {
                return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_INPUT,
                    'Expiration date cannot be in the past', request_id);
            }
        } else {
            const defaultExpiry = new Date();
            defaultExpiry.setDate(defaultExpiry.getDate() + PAT_DEFAULT_EXPIRY_DAYS);
            expiresAt = defaultExpiry;
        }
        const { token, tokenId, hashedSecret } = await createPat({
            userId,
            name,
            scopes: finalScopes,
            env: env as 'live' | 'test',
            expiresAt,
            ipAllowlist: ip_allowlist,
            projectId: project_id
        });
        const { rows } = await pool.query(
            `INSERT INTO personal_access_tokens
       (user_id, token_id, token_hash, name, scopes, env, expires_at, ip_allowlist, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, created_at`,
            [userId, tokenId, hashedSecret, name, finalScopes, env, expiresAt, ip_allowlist || [], project_id]
        );
        const response = {
            token,
            token_id: tokenId,
            name,
            scopes: finalScopes,
            env,
            expires_at: expiresAt,
            created_at: rows[0].created_at,
            request_id
        };
        return rep.status(HTTP_STATUS.CREATED).send(response);
    } catch (error) {
        return sendServerError(request, rep, error, '/v1/pats', generateRequestId());
    }
}

// Handler: Revoke PAT
export async function revokePersonalAccessToken(request: FastifyRequest, rep: FastifyReply, pool: Pool) {
    try {
        const userId = (request as any).user_id!;
        const { token_id } = (request.params || {}) as { token_id: string };
        const request_id = generateRequestId();
        const { rows } = await pool.query(
            `SELECT id, disabled FROM personal_access_tokens
       WHERE token_id = $1 AND user_id = $2`,
            [token_id, userId]
        );
        if (rows.length === 0) {
            return sendError(rep, HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND,
                ERROR_MESSAGES[ERROR_CODES.NOT_FOUND], request_id);
        }
        const wasAlreadyDisabled = rows[0].disabled;
        await pool.query(
            `UPDATE personal_access_tokens
       SET disabled = true
       WHERE token_id = $1 AND user_id = $2`,
            [token_id, userId]
        );
        return rep.status(wasAlreadyDisabled ? 200 : 204).send();
    } catch (error) {
        return sendServerError(request, rep, error, `/v1/pats/${(request.params as any)?.token_id || ''}`, generateRequestId());
    }
}