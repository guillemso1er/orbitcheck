import type { Pool } from 'pg';
import type { Plan, Usage, UserPlan } from '../types/plans.js';
import { HTTP_STATUS } from '../errors.js';

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

    if (rows.length === 0) {
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
    const used = userPlan.monthlyValidationsUsed + count;
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

    if (rows.length === 0) {
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
}

export const createPlansService = (pool: Pool) => new PlansService(pool);

// Middleware to attach plans service to request
// export function attachPlansService(request: FastifyRequest, pool: Pool) {
//   if (!request.plansService) {
//     request.plansService = createPlansService(pool);
//   }
//   return request.plansService;
// }
