import crypto from "node:crypto";
import argon2 from 'argon2';

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  PAT_DEFAULT_EXPIRY_DAYS,
  PAT_SCOPES,
  AUTHORIZATION_HEADER,
  BEARER_PREFIX,
} from "../config.js";
import { HTTP_STATUS, ERROR_CODES, ERROR_MESSAGES } from "../errors.js";
import { errorSchema, generateRequestId, rateLimitResponse, securityHeader, sendError, sendServerError, unauthorizedResponse } from "./utils.js";

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
function parsePat(bearer?: string) {
  if (!bearer?.startsWith(BEARER_PREFIX)) return null;
  const raw = bearer.slice(7).trim();
  const parts = raw.split('_');
  if (parts.length < 4 || parts[0] !== 'oc' || parts[1] !== 'pat') return null;
  const env = parts[2];
  const tokenId = parts[3];
  const secret = parts.slice(4).join('_'); // Rejoin in case underscores exist in secret
  return { raw, env, tokenId, secret };
}

/**
 * Create a new Personal Access Token
 */
export async function createPat({
  orgId,
  userId,
  name,
  scopes,
  env = 'live',
  expiresAt,
  ipAllowlist,
  projectId
}: {
  orgId: string;
  userId: string;
  name: string;
  scopes: string[];
  env?: 'live' | 'test';
  expiresAt?: Date | null;
  ipAllowlist?: string[];
  projectId?: string | null;
}): Promise<{ token: string; tokenId: string; hashedSecret: string }> {
  // Use parameters to satisfy TypeScript (values are used in return object)
  void orgId, userId, name, scopes, expiresAt, ipAllowlist, projectId;
  const tokenId = b64url(9);       // ~12 chars
  const secret = b64url(24);       // ~32 chars
  const token = `${OC_PAT_PREFIX}${env}_${tokenId}_${secret}`;

  const hashedSecret = await argon2.hash(secret + PAT_PEPPER, {
    type: argon2.argon2id,
    timeCost: 2,
    memoryCost: 19456,
    parallelism: 1
  });

  return { token, tokenId, hashedSecret };
}

/**
 * Verify a Personal Access Token
 */
export async function verifyPat(req: FastifyRequest, pool: Pool) {
  const parsed = parsePat(req.headers[AUTHORIZATION_HEADER]);
  if (!parsed) return null;

  const { rows } = await pool.query(
    "SELECT id, org_id, user_id, scopes, ip_allowlist, expires_at, disabled FROM personal_access_tokens WHERE token_id = $1 AND token_hash IS NOT NULL",
    [parsed.tokenId]
  );

  if (rows.length === 0) return null;

  const pat = rows[0];
  if (pat.disabled) return null;
  if (pat.expires_at && pat.expires_at < new Date()) return null;

  const ok = await argon2.verify(pat.token_hash, parsed.secret + PAT_PEPPER);
  if (!ok) return null;

  // Check IP allowlist if specified
  if (pat.ip_allowlist && pat.ip_allowlist.length > 0) {
    const clientIP = req.ip;
    const allowed = pat.ip_allowlist.some((cidr: string) => {
      // Simple CIDR check - in production you'd use a proper IP range library
      return cidr === clientIP || cidr === `${clientIP}/32`;
    });
    if (!allowed) return null;
  }

  // Update last_used_at and last_used_ip asynchronously
  pool.query(
    "UPDATE personal_access_tokens SET last_used_at = now(), last_used_ip = $1 WHERE id = $2",
    [req.ip, pat.id]
  ).catch(() => {}); // Non-blocking

  return pat;
}

export function registerPatRoutes(app: FastifyInstance, pool: Pool): void {
  // POST /v1/pats - Create new PAT
  app.post('/v1/pats', {
    schema: {
      summary: 'Create Personal Access Token',
      description: 'Creates a new personal access token for management API access',
      tags: ['Personal Access Tokens'],
      headers: securityHeader,
      security: [{ BearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name', 'scopes'],
        properties: {
          name: { type: 'string', description: 'Token name' },
          scopes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Access scopes for the token'
          },
          env: {
            type: 'string',
            enum: ['test', 'live'],
            default: 'live',
            description: 'Environment for the token'
          },
          expires_at: {
            type: 'string',
            format: 'date-time',
            description: 'Optional expiration date'
          },
          ip_allowlist: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional IP allowlist (CIDR notation)'
          },
          project_id: {
            type: 'string',
            description: 'Optional project restriction'
          }
        }
      },
      response: {
        201: {
          description: 'PAT created successfully',
          type: 'object',
          properties: {
            token: { type: 'string', description: 'The full PAT (shown only once)' },
            token_id: { type: 'string', description: 'Token identifier' },
            name: { type: 'string' },
            scopes: { type: 'array', items: { type: 'string' } },
            env: { type: 'string' },
            expires_at: { type: 'string', format: 'date-time', nullable: true },
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
      const userId = request.user_id!;
      const orgId = (request as any).org_id || userId; // Fallback for now
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

      // Validate scopes
      const validScopes = Object.values(PAT_SCOPES);
      const invalidScopes = scopes.filter((s: string) => !validScopes.includes(s as any));
      if (invalidScopes.length > 0) {
        return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_INPUT,
          `Invalid scopes: ${invalidScopes.join(', ')}`, request_id);
      }

      // Calculate expiration
      let expiresAt = null;
      if (expires_at) {
        expiresAt = new Date(expires_at);
      } else if (!expires_at) {
        // Default 90 days unless explicitly set to null for no expiration
        const defaultExpiry = new Date();
        defaultExpiry.setDate(defaultExpiry.getDate() + PAT_DEFAULT_EXPIRY_DAYS);
        expiresAt = defaultExpiry;
      }

      // Create token
      const { token, tokenId, hashedSecret } = await createPat({
        orgId,
        userId,
        name,
        scopes,
        env: env as 'live' | 'test',
        expiresAt,
        ipAllowlist: ip_allowlist,
        projectId: project_id
      });

      // Store in database
      const { rows } = await pool.query(
        `INSERT INTO personal_access_tokens
         (user_id, token_id, token_hash, name, scopes, env, expires_at, ip_allowlist, project_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, created_at`,
        [userId, tokenId, hashedSecret, name, scopes, env, expiresAt, ip_allowlist || [], project_id]
      );

      const response = {
        token, // Only returned once
        token_id: tokenId,
        name,
        scopes,
        env,
        expires_at: expiresAt,
        created_at: rows[0].created_at,
        request_id
      };

      return rep.status(HTTP_STATUS.CREATED).send(response);
    } catch (error) {
      return sendServerError(request, rep, error, '/v1/pats', generateRequestId());
    }
  });

  // GET /v1/pats - List PATs
  app.get('/v1/pats', {
    schema: {
      summary: 'List Personal Access Tokens',
      description: 'Retrieves personal access tokens for the authenticated user',
      tags: ['Personal Access Tokens'],
      headers: securityHeader,
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          description: 'List of PATs',
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  token_id: { type: 'string' },
                  name: { type: 'string' },
                  scopes: { type: 'array', items: { type: 'string' } },
                  env: { type: 'string' },
                  last_used_at: { type: 'string', format: 'date-time', nullable: true },
                  last_used_ip: { type: 'string', nullable: true },
                  expires_at: { type: 'string', format: 'date-time', nullable: true },
                  disabled: { type: 'boolean' },
                  created_at: { type: 'string', format: 'date-time' }
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
      const userId = request.user_id!;
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
  });

  // DELETE /v1/pats/:token_id - Revoke PAT
  app.delete('/v1/pats/:token_id', {
    schema: {
      summary: 'Revoke Personal Access Token',
      description: 'Revokes a personal access token by disabling it',
      tags: ['Personal Access Tokens'],
      headers: securityHeader,
      security: [{ BearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to revoke' }
        },
        required: ['token_id']
      },
      response: {
        200: {
          description: 'PAT revoked successfully',
          type: 'object',
          properties: {
            id: { type: 'string' },
            token_id: { type: 'string' },
            disabled: { type: 'boolean' },
            request_id: { type: 'string' }
          }
        },
        ...unauthorizedResponse,
        ...rateLimitResponse,
        404: { description: 'PAT not found', ...errorSchema }
      }
    }
  }, async (request, rep) => {
    try {
      const userId = request.user_id!;
      const { token_id } = request.params as { token_id: string };
      const request_id = generateRequestId();

      const { rowCount } = await pool.query(
        `UPDATE personal_access_tokens
         SET disabled = true
         WHERE token_id = $1 AND user_id = $2`,
        [token_id, userId]
      );

      if (rowCount === 0) {
        return sendError(rep, HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND,
          ERROR_MESSAGES[ERROR_CODES.NOT_FOUND], request_id);
      }

      const response = {
        id: token_id,
        token_id,
        disabled: true,
        request_id
      };

      return rep.send(response);
    } catch (error) {
      return sendServerError(request, rep, error, `/v1/pats/${(request.params as any)?.token_id || ''}`, generateRequestId());
    }
  });
}