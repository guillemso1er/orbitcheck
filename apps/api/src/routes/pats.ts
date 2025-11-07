import argon2 from 'argon2';
import crypto from "node:crypto";

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import { MGMT_V1_ROUTES } from "@orbitcheck/contracts";
import {
  BEARER_PREFIX,
  PAT_DEFAULT_EXPIRY_DAYS,
  PAT_SCOPES
} from "../config.js";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../errors.js";
import { errorSchema, generateRequestId, MGMT_V1_SECURITY, rateLimitResponse, securityHeader, sendError, sendServerError, unauthorizedResponse } from "./utils.js";

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


export function registerPatRoutes(app: FastifyInstance, pool: Pool): void {
  app.post(MGMT_V1_ROUTES.PATS.CREATE_PERSONAL_ACCESS_TOKEN, {
    schema: {
      summary: 'Create Personal Access Token',
      description: 'Creates a new personal access token for management API access',
      tags: ['Personal Access Tokens'],
      headers: securityHeader,
      security: MGMT_V1_SECURITY,
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Token name' },
          scopes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Access scopes for the token (optional, defaults to all scopes if empty)'
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
      let finalScopes = scopes;

      if (scopes === undefined || scopes === null) {
        // Default to all scopes if not provided
        finalScopes = validScopes;
      } else if (!Array.isArray(scopes)) {
        return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_INPUT,
          'scopes must be an array of strings', request_id);
      } else if (scopes.length === 0) {
        // Default to all scopes if empty array provided
        finalScopes = validScopes;
      } else {
        // Validate provided scopes
        const invalidScopes = scopes.filter((s: string) => !validScopes.includes(s as any));
        if (invalidScopes.length > 0) {
          return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_INPUT,
            `Invalid scopes: ${invalidScopes.join(', ')}`, request_id);
        }
        finalScopes = scopes;
      }

      // Calculate expiration
      let expiresAt = null;
      if (expires_at !== null && expires_at !== undefined) {
        expiresAt = new Date(expires_at);
        // Validate that the date is not in the past
        if (expiresAt < new Date()) {
          return sendError(rep, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_INPUT,
            'Expiration date cannot be in the past', request_id);
        }
      } else {
        // Default 90 days unless explicitly set to null for no expiration
        const defaultExpiry = new Date();
        defaultExpiry.setDate(defaultExpiry.getDate() + PAT_DEFAULT_EXPIRY_DAYS);
        expiresAt = defaultExpiry;
      }

      // Create token
      const { token, tokenId, hashedSecret } = await createPat({
        userId,
        name,
        scopes: finalScopes,
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
        [userId, tokenId, hashedSecret, name, finalScopes, env, expiresAt, ip_allowlist || [], project_id]
      );

      const response = {
        token, // Only returned once
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
  });

  // GET /v1/pats - List PATs
  app.get('/v1/pats', {
    schema: {
      summary: 'List Personal Access Tokens',
      description: 'Retrieves personal access tokens for the authenticated user',
      tags: ['Personal Access Tokens'],
      headers: securityHeader,
      security: MGMT_V1_SECURITY,
      response: {
        200: {
          description: 'List of PATs',
          type: 'object',
          properties: {
            pats: {
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

      const response = { pats: rows, request_id };
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
      security: MGMT_V1_SECURITY,
      params: {
        type: 'object',
        properties: {
          token_id: { type: 'string', description: 'Token ID to revoke' }
        },
        required: ['token_id']
      },
      response: {
        204: {
          description: 'PAT revoked successfully'
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

      // First check if the PAT exists and belongs to the user
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

      // Update the PAT
      await pool.query(
        `UPDATE personal_access_tokens
         SET disabled = true
         WHERE token_id = $1 AND user_id = $2`,
        [token_id, userId]
      );

      // Return different status codes based on whether it was already disabled
      return rep.status(wasAlreadyDisabled ? 200 : 204).send();
    } catch (error) {
      return sendServerError(request, rep, error, `/v1/pats/${(request.params as any)?.token_id || ''}`, generateRequestId());
    }
  });
}