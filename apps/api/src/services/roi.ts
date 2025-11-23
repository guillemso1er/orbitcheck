import type { FastifyReply, FastifyRequest } from "fastify";

import { generateRequestId, sendServerError } from "./utils.js";

export interface RoiInputs {
    orders_per_month: number;
    issue_rate: number;
    carrier_fee_share: number;
    avg_correction_fee: number;
    reship_share: number;
    reship_cost: number;
    prevention_rate: number;
}

export interface RoiEstimates {
    issues_per_month: number;
    loss_per_issue: number;
    baseline_loss_per_month: number;
    savings_per_month: number;
}

export interface RoiResponse {
    inputs?: {
        orders_per_month?: number;
        issue_rate?: number;
        carrier_fee_share?: number;
        avg_correction_fee?: number;
        reship_share?: number;
        reship_cost?: number;
        prevention_rate?: number;
        currency?: string;
    };
    estimates?: {
        issues_per_month?: number;
        loss_per_issue?: number;
        baseline_loss_per_month?: number;
        savings_per_month?: number;
    };
    meta?: {
        model_version?: string;
        request_id?: string;
    };
}

const DEFAULTS = {
    issue_rate: 0.021,
    carrier_fee_share: 0.5,
    avg_correction_fee: 23.75,
    reship_share: 0.1,
    reship_cost: 10,
    prevention_rate: 0.5
} as const;

function computeRoiEstimateLogic(
    partial: Partial<RoiInputs> & { orders_per_month: number },
    currency: string = 'USD',
    request_id?: string
): RoiResponse {
    const inputs: RoiInputs = {
        orders_per_month: partial.orders_per_month,
        issue_rate: partial.issue_rate ?? DEFAULTS.issue_rate,
        carrier_fee_share: partial.carrier_fee_share ?? DEFAULTS.carrier_fee_share,
        avg_correction_fee: partial.avg_correction_fee ?? DEFAULTS.avg_correction_fee,
        reship_share: partial.reship_share ?? DEFAULTS.reship_share,
        reship_cost: partial.reship_cost ?? DEFAULTS.reship_cost,
        prevention_rate: partial.prevention_rate ?? DEFAULTS.prevention_rate
    };

    const issues_per_month =
        inputs.orders_per_month * inputs.issue_rate;

    const loss_per_issue =
        inputs.carrier_fee_share * inputs.avg_correction_fee +
        inputs.reship_share * inputs.reship_cost;

    const baseline_loss_per_month =
        issues_per_month * loss_per_issue;

    const savings_per_month =
        baseline_loss_per_month * inputs.prevention_rate;

    return {
        inputs: {
            orders_per_month: inputs.orders_per_month,
            issue_rate: inputs.issue_rate,
            carrier_fee_share: inputs.carrier_fee_share,
            avg_correction_fee: inputs.avg_correction_fee,
            reship_share: inputs.reship_share,
            reship_cost: inputs.reship_cost,
            prevention_rate: inputs.prevention_rate,
            currency
        },
        estimates: {
            issues_per_month,
            loss_per_issue: Number(loss_per_issue.toFixed(2)),
            baseline_loss_per_month: Number(baseline_loss_per_month.toFixed(2)),
            savings_per_month: Number(savings_per_month.toFixed(2))
        },
        meta: {
            model_version: 'roi-v1',
            request_id: request_id ?? globalThis.crypto?.randomUUID?.() ?? 'unknown'
        }
    };
}

export async function computeRoiEstimate(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<FastifyReply> {
    try {
        const request_id = generateRequestId();
        const body = request.body as any;
        const response = computeRoiEstimateLogic({
            orders_per_month: body.orders_per_month,
            issue_rate: body.issue_rate,
            carrier_fee_share: body.carrier_fee_share,
            avg_correction_fee: body.avg_correction_fee,
            reship_share: body.reship_share,
            reship_cost: body.reship_cost,
            prevention_rate: body.prevention_rate
        }, body.currency ?? 'USD', request_id);

        return reply.status(200).send(response);
    } catch (error) {
        return sendServerError(request, reply, error, "/v1/roi/estimate", generateRequestId());
    }
}