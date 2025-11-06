import { DASHBOARD_ROUTES } from '@orbitcheck/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { HTTP_STATUS } from '../errors.js';
import { createPlansService } from '../services/plans.js';

export function registerPlanRoutes(app: FastifyInstance, pool: Pool): void {
  const plansService = createPlansService(pool);

  // Get current user plan
  app.get(DASHBOARD_ROUTES.GET_CURRENT_USER_PLAN, {
    schema: {
      summary: 'Get Current User Plan',
      description: 'Retrieves the current plan and usage information for the authenticated user.',
      tags: ['Plans'],
      response: {
        200: {
          description: 'User plan information',
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            plan: { type: 'object' },
            monthlyValidationsUsed: { type: 'integer' },
            subscriptionStatus: { type: 'string' },
            trialEndDate: { type: ['string', 'null'] },
            projectsCount: { type: 'integer' }
          }
        },
        401: { description: 'Unauthorized' },
        500: { description: 'Internal server error' }
      }
    }
  }, async (request, reply) => {
    try {
      const userId = request.user_id;
      if (!userId) {
        return reply.status(HTTP_STATUS.UNAUTHORIZED).send({
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
        });
      }

      const userPlan = await plansService.getUserPlan(userId);

      return reply.send(userPlan);
    } catch (error) {
      return reply.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch user plan' }
      });
    }
  });

  // Update user plan (upgrade/downgrade)
  app.patch(DASHBOARD_ROUTES.UPDATE_USER_PLAN, {
    schema: {
      summary: 'Update User Plan',
      description: 'Updates the user\'s subscription plan. For paid plans, this should be called after successful payment.',
      tags: ['Plans'],
      body: {
        type: 'object',
        required: ['planSlug'],
        properties: {
          planSlug: { type: 'string', enum: ['free', 'starter', 'growth', 'scale', 'enterprise'] },
          trialDays: { type: 'integer', minimum: 1, maximum: 30, description: 'Days for trial period (optional)' }
        }
      },
      response: {
        200: {
          description: 'Plan updated successfully',
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            plan: { type: 'object' },
            monthlyValidationsUsed: { type: 'integer' },
            subscriptionStatus: { type: 'string' },
            trialEndDate: { type: ['string', 'null'] },
            projectsCount: { type: 'integer' }
          }
        },
        400: { description: 'Invalid plan slug' },
        401: { description: 'Unauthorized' },
        500: { description: 'Internal server error' }
      }
    }
  }, async (request, reply) => {
    try {
      const userId = request.user_id;
      if (!userId) {
        return reply.status(HTTP_STATUS.UNAUTHORIZED).send({
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
        });
      }

      const { planSlug, trialDays } = request.body as any;
      const updatedPlan = await plansService.updateUserPlan(userId, planSlug, trialDays);

      return reply.send(updatedPlan);
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        return reply.status(HTTP_STATUS.BAD_REQUEST).send({
          error: { code: 'INVALID_PLAN', message: 'Plan not found' }
        });
      }
      return reply.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
        error: { code: 'SERVER_ERROR', message: 'Failed to update plan' }
      });
    }
  });

  // Get available plans
  app.get(DASHBOARD_ROUTES.GET_AVAILABLE_PLANS, {
    schema: {
      summary: 'Get Available Plans',
      description: 'Returns all available subscription plans.',
      tags: ['Plans'],
      response: {
        200: {
          description: 'List of available plans',
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              slug: { type: 'string' },
              price: { type: 'number' },
              validationsLimit: { type: 'integer' },
              projectsLimit: { type: 'integer' },
              logsRetentionDays: { type: 'integer' },
              features: { type: 'object' },
              overageRate: { type: 'number' },
              maxOverage: { type: ['integer', 'null'] },
              sla: { type: ['string', 'null'] },
              isCustom: { type: 'boolean' },
              createdAt: { type: 'string' },
              updatedAt: { type: 'string' }
            }
          }
        },
        500: { description: 'Internal server error' }
      }
    }
  }, async (_request, reply) => {
    try {
      const { rows } = await pool.query('SELECT * FROM plans WHERE is_custom = false ORDER BY price ASC');
      const plans = rows.map(row => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        price: Number(row.price),
        validationsLimit: row.validations_limit,
        projectsLimit: row.projects_limit,
        logsRetentionDays: row.logs_retention_days,
        features: row.features,
        overageRate: Number(row.overage_rate),
        maxOverage: row.max_overage,
        sla: row.sla,
        isCustom: row.is_custom,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));

      return reply.send(plans);
    } catch (error) {
      return reply.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch plans' }
      });
    }
  });

  // Check validation limits (for pre-flight checks)
  app.post(DASHBOARD_ROUTES.CHECK_VALIDATION_LIMITS, {
    schema: {
      summary: 'Check Validation Limits',
      description: 'Checks if the user has enough validation quota remaining for a requested number of validations.',
      tags: ['Plans'],
      body: {
        type: 'object',
        required: ['count'],
        properties: {
          count: { type: 'integer', minimum: 1, description: 'Number of validations to check' }
        }
      },
      response: {
        200: {
          description: 'Usage check result',
          type: 'object',
          properties: {
            canProceed: { type: 'boolean' },
            remainingValidations: { type: 'integer' },
            overageAllowed: { type: 'boolean' },
            monthlyValidationsUsed: { type: 'integer' },
            planValidationsLimit: { type: 'integer' }
          }
        },
        401: { description: 'Unauthorized' },
        402: { description: 'Payment required (limit exceeded)' },
        500: { description: 'Internal server error' }
      }
    }
  }, async (request, reply) => {
    try {
      const userId = request.user_id;
      if (!userId) {
        return reply.status(HTTP_STATUS.UNAUTHORIZED).send({
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
        });
      }

      const { count = 1 } = request.body as any;
      const usage = await plansService.checkValidationLimit(userId, count);

      const canProceed = usage.remainingValidations >= count || usage.overageAllowed;

      return reply.send({
        canProceed,
        ...usage
      });
    } catch (error: any) {
      if (error.status === 402) {
        return reply.status(402).send(error);
      }
      return reply.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
        error: { code: 'SERVER_ERROR', message: 'Failed to check usage limits' }
      });
    }
  });
}
