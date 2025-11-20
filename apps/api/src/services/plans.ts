import type { Pool } from 'pg';

import { HTTP_STATUS } from '../errors.js';
import type { Plan, Usage, UserPlan } from '../types/plans.js';

const DEFAULT_PLAN_SLUG = 'free';

export class PlansService {
  constructor(private pool: Pool) { }

  async getPlanBySlug(slug: string): Promise<Plan | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM plans WHERE slug = $1',
      [slug]
    );
    return rows[0] || null;
  }

  async getUserPlan(userId: string): Promise<UserPlan> {
    const { rows } = await this.pool.query(
      `SELECT
        u.id as user_id, u.email, u.monthly_validations_used, u.subscription_status, u.trial_end_date,
        p.*,
        (SELECT COUNT(*) FROM projects WHERE user_id = u.id) as projects_count
       FROM users u
       JOIN plans p ON u.plan_id = p.id
       WHERE u.id = $1`,
      [userId]
    );

    if (!rows || rows.length === 0) {
      throw new Error('User not found');
    }

    return {
      id: rows[0].user_id,
      email: rows[0].email,
      monthlyValidationsUsed: rows[0].monthly_validations_used,
      subscriptionStatus: rows[0].subscription_status,
      trialEndDate: rows[0].trial_end_date,
      projectsCount: rows[0].projects_count,
      plan: {
        id: rows[0].id,
        name: rows[0].name,
        slug: rows[0].slug,
        price: Number(rows[0].price),
        validationsLimit: rows[0].validations_limit,
        projectsLimit: rows[0].projects_limit,
        logsRetentionDays: rows[0].logs_retention_days,
        features: rows[0].features,
        overageRate: Number(rows[0].overage_rate),
        maxOverage: rows[0].max_overage || null,
        sla: rows[0].sla || null,
        isCustom: rows[0].is_custom,
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at
      }
    };
  }

  async updateUserPlan(userId: string, planSlug: string, trialDays?: number): Promise<UserPlan> {
    const plan = await this.getPlanBySlug(planSlug);
    if (!plan) {
      throw new Error(`Plan ${planSlug} not found`);
    }

    const trialEndDate = trialDays ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString() : null;

    await this.pool.query(
      'UPDATE users SET plan_id = $1, subscription_status = $2, trial_end_date = $3 WHERE id = $4',
      [plan.id, trialDays ? 'trial' : 'active', trialEndDate, userId]
    );

    return this.getUserPlan(userId);
  }

  async incrementValidationUsage(userId: string, count: number = 1): Promise<Usage> {
    await this.pool.query(
      'UPDATE users SET monthly_validations_used = monthly_validations_used + $1 WHERE id = $2',
      [count, userId]
    );

    const userPlan = await this.getUserPlan(userId);
    const limit = userPlan.plan.validationsLimit;
    const used = userPlan.monthlyValidationsUsed; // Already incremented by the UPDATE
    const maxTotal = limit + (userPlan.plan.maxOverage || 0);
    const remaining = Math.max(0, limit - used);
    const overageAllowed = used <= maxTotal && userPlan.plan.overageRate > 0;

    return {
      monthlyValidationsUsed: used,
      planValidationsLimit: limit,
      overageAllowed,
      remainingValidations: remaining
    };
  }

  async checkValidationLimit(userId: string, requestedCount: number = 1): Promise<Usage> {
    const userPlan = await this.getUserPlan(userId);
    const currentUsed = userPlan.monthlyValidationsUsed;
    const limit = userPlan.plan.validationsLimit;
    const maxTotal = limit + (userPlan.plan.maxOverage || 0);
    const projectedUsed = currentUsed + requestedCount;
    const remaining = Math.max(0, limit - currentUsed);
    const overageAllowed = projectedUsed <= maxTotal && userPlan.plan.overageRate > 0;

    if (projectedUsed > limit && !overageAllowed) {
      throw {
        status: HTTP_STATUS.PAYMENT_REQUIRED,
        error: {
          code: 'LIMIT_EXCEEDED',
          message: `Validation limit exceeded. Current plan allows ${limit} validations per month. Upgrade to continue.`
        }
      };
    }

    return {
      monthlyValidationsUsed: currentUsed,
      planValidationsLimit: limit,
      overageAllowed,
      remainingValidations: remaining
    };
  }

  async checkProjectLimit(userId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      'SELECT p.projects_limit, COUNT(pr.id) as project_count FROM users u JOIN plans p ON u.plan_id = p.id LEFT JOIN projects pr ON u.id = pr.user_id WHERE u.id = $1 GROUP BY u.id, p.projects_limit',
      [userId]
    );

    if (!rows || rows.length === 0) {
      throw new Error('User not found');
    }

    return rows[0].project_count < rows[0].projects_limit;
  }

  async resetMonthlyUsage(userId: string): Promise<void> {
    await this.pool.query(
      'UPDATE users SET monthly_validations_used = 0 WHERE id = $1',
      [userId]
    );
  }

  async getDefaultPlan(): Promise<Plan> {
    const plan = await this.getPlanBySlug(DEFAULT_PLAN_SLUG);
    if (!plan) {
      throw new Error('Default plan not found');
    }
    return plan;
  }

  async assignDefaultPlan(userId: string): Promise<void> {
    const defaultPlan = await this.getDefaultPlan();
    if (!defaultPlan) {
      throw new Error('Default plan not found');
    }

    await this.pool.query(
      'UPDATE users SET plan_id = $1, monthly_validations_used = 0, subscription_status = $2 WHERE id = $3',
      [defaultPlan.id, 'active', userId]
    );
  }

  hasFeature(userPlan: UserPlan, feature: string): boolean {
    const features = userPlan.plan.features as Record<string, any>;
    return features[feature] === true || features.all_v1_features === true || features.all_features === true;
  }

  // Response formatting methods to move logic from handlers to service
  async getUserPlanResponse(userId: string): Promise<{
    id: string;
    email: string;
    monthlyValidationsUsed: number;
    subscriptionStatus: string;
    trialEndDate?: string;
    projectsCount: number;
    plan: Plan;
  }> {
    const userPlan = await this.getUserPlan(userId);
    return {
      id: userPlan.id,
      email: userPlan.email,
      monthlyValidationsUsed: userPlan.monthlyValidationsUsed,
      subscriptionStatus: userPlan.subscriptionStatus,
      trialEndDate: userPlan.trialEndDate,
      projectsCount: userPlan.projectsCount,
      plan: userPlan.plan
    };
  }

  async updateUserPlanResponse(userId: string, planSlug: string, trialDays?: number): Promise<{
    id: string;
    email: string;
    monthlyValidationsUsed: number;
    subscriptionStatus: string;
    trialEndDate?: string;
    projectsCount: number;
    plan: Plan;
  }> {
    const userPlan = await this.updateUserPlan(userId, planSlug, trialDays);
    return {
      id: userPlan.id,
      email: userPlan.email,
      monthlyValidationsUsed: userPlan.monthlyValidationsUsed,
      subscriptionStatus: userPlan.subscriptionStatus,
      trialEndDate: userPlan.trialEndDate,
      projectsCount: userPlan.projectsCount,
      plan: userPlan.plan
    };
  }

  async getAvailablePlansResponse(): Promise<Array<{
    id: string;
    name: string;
    slug: string;
    price: number;
    validationsLimit: number;
    projectsLimit: number;
    features: Record<string, any>;
  }>> {
    // Temporary: return only the free plan as array, shape matching spec
    const free = await this.getPlanBySlug('free');
    return free ? [{
      id: free.id,
      name: free.name,
      slug: free.slug,
      price: free.price,
      validationsLimit: free.validationsLimit,
      projectsLimit: free.projectsLimit,
      features: free.features
    }] : [];
  }

  async checkValidationLimitsResponse(userId: string, count: number = 1): Promise<{
    canProceed: boolean;
    remainingValidations: number;
    overageAllowed: boolean;
    monthlyValidationsUsed: number;
    planValidationsLimit: number;
  }> {
    const usage = await this.checkValidationLimit(userId, count);
    return {
      canProceed: usage.remainingValidations > 0 || usage.overageAllowed,
      remainingValidations: usage.remainingValidations,
      overageAllowed: usage.overageAllowed,
      monthlyValidationsUsed: usage.monthlyValidationsUsed,
      planValidationsLimit: usage.planValidationsLimit
    };
  }
}

export const createPlansService = (pool: Pool): PlansService => new PlansService(pool);

// Middleware to attach plans service to request
// export function attachPlansService(request: FastifyRequest, pool: Pool) {
//   if (!request.plansService) {
//     request.plansService = createPlansService(pool);
//   }
//   return request.plansService;
// }

// Handler methods to move HTTP logic from handlers to service
export async function getUserPlanHandler(
  request: any,
  reply: any,
  pool: any
): Promise<any> {
  try {
    const userId = (request as any).user_id;
    const plansService = new PlansService(pool);
    const response = await plansService.getUserPlanResponse(userId);

    // Convert plan to generic object to match generated types
    return reply.status(200).send({
      ...response,
      plan: { ...response.plan }
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      return reply.status((error as any).status).send((error as any).error);
    }
    return reply.status(500).send({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' }
    });
  }
}

export async function updateUserPlanHandler(
  request: any,
  reply: any,
  pool: any
): Promise<any> {
  try {
    const userId = (request as any).user_id;
    const { planSlug, trialDays } = request.body as any;

    if (!planSlug || typeof planSlug !== 'string') {
      return reply.status(400).send({
        error: { code: 'INVALID_INPUT', message: 'planSlug is required' }
      });
    }

    const plansService = new PlansService(pool);
    const response = await plansService.updateUserPlanResponse(userId, planSlug, trialDays);

    // Convert plan to generic object to match generated types
    return reply.status(200).send({
      ...response,
      plan: { ...response.plan }
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      return reply.status((error as any).status).send((error as any).error);
    }
    return reply.status(500).send({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' }
    });
  }
}

export async function getAvailablePlansHandler(
  _request: any,
  reply: any,
  pool: any
): Promise<any> {
  try {
    const plansService = new PlansService(pool);
    const response = await plansService.getAvailablePlansResponse();
    return reply.status(200).send(response);
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      return reply.status((error as any).status).send((error as any).error);
    }
    return reply.status(500).send({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' }
    });
  }
}

export async function checkValidationLimitsHandler(
  request: any,
  reply: any,
  pool: any
): Promise<any> {
  try {
    const userId = (request as any).user_id;
    const { count = 1 } = request.body as any;

    const plansService = new PlansService(pool);
    const response = await plansService.checkValidationLimitsResponse(userId, count);
    return reply.status(200).send(response);
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      return reply.status((error as any).status).send((error as any).error);
    }
    return reply.status(500).send({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' }
    });
  }
}
