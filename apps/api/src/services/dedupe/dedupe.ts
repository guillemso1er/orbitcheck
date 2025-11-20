import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { HTTP_STATUS } from "../../errors.js";
import type { DedupeAddressData, DedupeAddressResponses, DedupeCustomerData, DedupeCustomerResponses, MergeDeduplicatedData, MergeDeduplicatedResponses } from "../../generated/fastify/types.gen.js";
import { logEvent } from "../../hooks.js";
import { MERGE_TYPES } from "../../validation.js";
import { generateRequestId, sendServerError } from "../utils.js";
import { dedupeAddress as dedupeAddressLogic, dedupeCustomer as dedupeCustomerLogic } from "./dedupe-logic.js";
export async function dedupeCustomer(
    request: FastifyRequest<{ Body: DedupeCustomerData['body'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply<{ Body: DedupeCustomerResponses }>> {
    try {
        const request_id = generateRequestId();
        const body = request.body as DedupeCustomerData['body'];
        const project_id = (request as any).project_id;
        const reason_codes: string[] = [];

        const result = await dedupeCustomerLogic(body, project_id, pool);
        const mappedMatches = result.matches.map((match: any) => ({
            ...match,
            match_type: match.match_type as "exact_email" | "exact_phone" | "fuzzy_name" | undefined
        }));
        const response: DedupeCustomerResponses[200] = { ...result, matches: mappedMatches, request_id };
        await (rep as any).saveIdem?.(response);
        await logEvent(project_id, 'dedupe', '/dedupe/customer', reason_codes, HTTP_STATUS.OK, { matches_count: result.matches.length, suggested_action: result.suggested_action }, pool);
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, "/v1/dedupe/customer", generateRequestId());
    }
}

export async function dedupeAddress(
    request: FastifyRequest<{ Body: DedupeAddressData['body'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply<{ Body: DedupeAddressResponses }>> {
    try {
        const request_id = generateRequestId();
        const body = request.body as DedupeAddressData['body'];
        const project_id = (request as any).project_id;
        const reason_codes: string[] = [];

        const result = await dedupeAddressLogic(body, project_id, pool);
        const mappedMatches = result.matches.map((match: any) => ({
            ...match,
            match_type: match.match_type as "exact_address" | "exact_postal" | "fuzzy_address" | undefined
        }));
        const response: DedupeAddressResponses[200] = { ...result, matches: mappedMatches, request_id };
        await (rep as any).saveIdem?.(response);
        await logEvent(project_id, 'dedupe', '/dedupe/address', reason_codes, HTTP_STATUS.OK, { matches_count: result.matches.length, suggested_action: result.suggested_action }, pool);
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, "/v1/dedupe/address", generateRequestId());
    }
}

export async function mergeDeduplicatedRecords(
    request: FastifyRequest<{ Body: MergeDeduplicatedData['body'] }>,
    rep: FastifyReply,
    pool: Pool
): Promise<FastifyReply<{ Body: MergeDeduplicatedResponses }>> {
    try {
        const request_id = generateRequestId();
        const body = request.body as MergeDeduplicatedData['body'];
        const { type, ids, canonical_id } = body;
        const project_id = (request as any).project_id;
        const table = type === MERGE_TYPES.CUSTOMER ? 'customers' : 'addresses';
        const count = ids.length;

        // Verify all IDs belong to project
        const { rows: verifyRows } = await pool.query(
            `SELECT id FROM ${table} WHERE project_id = $1 AND id = ANY($2)`,
            [project_id, [...ids, canonical_id]]
        );
        if (verifyRows.length !== count + 1) {
            return rep.status(HTTP_STATUS.BAD_REQUEST).send({ error: { code: 'INVALID_IDS', message: 'Invalid IDs' } });
        }

        // Merge: update canonical, mark others as merged
        await pool.query(
            `UPDATE ${table} SET updated_at = now() WHERE id = $1 AND project_id = $2`,
            [canonical_id, project_id]
        );
        await pool.query(
            `UPDATE ${table} SET updated_at = now(), merged_to = $1 WHERE id = ANY($2) AND id != $1 AND project_id = $3`,
            [canonical_id, ids, project_id]
        );

        const response: MergeDeduplicatedResponses[200] = { success: true, merged_count: count, canonical_id, request_id };
        await (rep as any).saveIdem?.(response);
        await logEvent(project_id, 'dedupe', '/dedupe/merge', [], HTTP_STATUS.OK, { type, merged_count: count }, pool);
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, "/v1/dedupe/merge", generateRequestId());
    }
}