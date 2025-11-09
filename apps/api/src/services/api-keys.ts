import { MGMT_V1_ROUTES } from "@orbitcheck/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import crypto, { webcrypto as nodeWebCrypto } from "node:crypto";
import type { Pool } from "pg";
import { API_KEY_PREFIX, CRYPTO_IV_BYTES, CRYPTO_KEY_BYTES, ENCODING_HEX, ENCODING_UTF8, ENCRYPTION_ALGORITHM, HASH_ALGORITHM, STATUS } from "../config.js";
import { environment } from "../environment.js";
import { HTTP_STATUS } from "../errors.js";
import type { CreateApiKeyData, CreateApiKeyResponses, ListApiKeysResponses, RevokeApiKeyData, RevokeApiKeyResponses } from "../generated/fastify/types.gen.js";
import { generateRequestId, sendServerError } from "./utils.js";

export async function listApiKeys(
    request: FastifyRequest,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    try {
        const project_id = (request as any).project_id!;
        const request_id = generateRequestId();
        const { rows } = await pool.query(
            "SELECT id, prefix, name, status, created_at, last_used_at FROM api_keys WHERE project_id = $1 ORDER BY created_at DESC",
            [project_id]
        );
        const response: ListApiKeysResponses[200] = { data: rows, request_id };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, MGMT_V1_ROUTES.API_KEYS.LIST_API_KEYS, generateRequestId());
    }
}

export async function createApiKey(
    request: FastifyRequest<{ Body: CreateApiKeyData['body'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    try {
        const project_id = (request as any).project_id!;
        request.log.info('Creating API key for project_id: ' + project_id);
        const body = request.body as CreateApiKeyData['body'];
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

        // Encrypt the full key using Web Crypto API (async)
        const ivBuffer = await new Promise<Buffer>((resolve, reject) => {
            crypto.randomBytes(CRYPTO_IV_BYTES, (error, buf) => {
                if (error) reject(error);
                else resolve(buf);
            });
        });

        // Use Web Crypto API for async encryption
        const cryptoKey = await nodeWebCrypto.subtle.importKey(
            'raw',
            Buffer.from(environment.ENCRYPTION_KEY, ENCODING_HEX),
            { name: ENCRYPTION_ALGORITHM, length: 256 },
            false,
            ['encrypt']
        );

        const encryptedBuffer = await nodeWebCrypto.subtle.encrypt(
            {
                name: ENCRYPTION_ALGORITHM,
                iv: ivBuffer
            },
            cryptoKey,
            Buffer.from(full_key, ENCODING_UTF8)
        );

        const encrypted = Buffer.from(encryptedBuffer).toString(ENCODING_HEX);
        const encryptedWithIv = ivBuffer.toString('hex') + ':' + encrypted;

        const { rows } = await pool.query(
            "INSERT INTO api_keys (project_id, prefix, hash, encrypted_key, status, name) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at",
            [project_id, prefix, keyHash, encryptedWithIv, STATUS.ACTIVE, name || null]
        );

        const newKey = rows[0];

        // Create PAT for the new API key
        await pool.query(
            "INSERT INTO personal_access_tokens (user_id, token_id, name, token_hash, scopes, env, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [(request as any).user_id, crypto.randomUUID(), name || 'API Key', keyHash, ['*'], 'live', null]
        );

        const response: CreateApiKeyResponses[201] = {
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
}

export async function revokeApiKey(
    request: FastifyRequest<{ Params: RevokeApiKeyData['path'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply> {
    try {
        const project_id = (request as any).project_id!;
        const { id } = request.params as RevokeApiKeyData['path'];
        const request_id = generateRequestId();

        const { rowCount } = await pool.query(
            "UPDATE api_keys SET status = $3 WHERE id = $1 AND project_id = $2",
            [id, project_id, STATUS.REVOKED]
        );

        if (rowCount === 0) {
            return rep.status(HTTP_STATUS.NOT_FOUND).send({
                error: {
                    code: 'not_found',
                    message: 'API key not found'
                },
                request_id
            });
        }

        const response: RevokeApiKeyResponses[200] = { id, status: STATUS.REVOKED, request_id };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, `${MGMT_V1_ROUTES.API_KEYS.LIST_API_KEYS}/:id`, generateRequestId());
    }
}