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

const DEFAULTS = {
    issue_rate: 0.021,
    carrier_fee_share: 0.5,
    avg_correction_fee: 23.75,
    reship_share: 0.1,
    reship_cost: 10,
    prevention_rate: 0.5
} as const;

export function computeRoiEstimate(
    partial: Partial<RoiInputs> & { orders_per_month: number }
): { inputs: RoiInputs; estimates: RoiEstimates } {
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
        inputs,
        estimates: {
            issues_per_month,
            loss_per_issue,
            baseline_loss_per_month,
            savings_per_month
        }
    };
}