import type { FastifyReply, FastifyRequest } from "fastify";
import type { NormalizeAddressData, NormalizeAddressResponses } from "../generated/fastify/types.gen.js";
import { generateRequestId, sendServerError } from "./utils.js";

export async function normalizeAddressCheap(
    request: FastifyRequest<{ Body: NormalizeAddressData['body'] }>,
    rep: FastifyReply
): Promise<FastifyReply<{ Body: NormalizeAddressResponses }>> {
    try {
        const request_id = generateRequestId();
        const body = request.body as NormalizeAddressData['body'];
        const { address } = body;

        // Basic normalization: trim strings and uppercase country
        const normalized = {
            line1: address.line1?.trim() || '',
            line2: address.line2?.trim() || '',
            city: address.city?.trim() || '',
            state: address.state?.trim() || '',
            postal_code: address.postal_code?.trim() || '',
            country: address.country?.toUpperCase() || ''
        };

        const response: NormalizeAddressResponses[200] = { normalized, request_id };
        return rep.send(response);
    } catch (error) {
        return sendServerError(request, rep, error, "/v1/normalize", generateRequestId());
    }
}