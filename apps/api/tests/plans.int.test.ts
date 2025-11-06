import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlansService } from '../src/services/plans.js';

describe('PlansService', () => {
  let pool: Pool;
  let plansService: PlansService;
  let mockUserId: string;
  let mockPlanId: string;

  beforeEach(async () => {
    // Mock pool setup with proper typing
    pool = {
      query: vi.fn()
    } as any;
    plansService = new PlansService(pool);
    mockUserId = 'user-123';
    mockPlanId = 'plan-123';
  });

  describe('getUserPlan', () => {
    it('should return user plan information', async () => {
      const mockRow = {
        user_id: mockUserId,
        email: 'test@example.com',
        monthly_validations_used: 1200,
        subscription_status: 'active',
        trial_end_date: null,
        id: 'plan-id',
        name: 'Free (Developer)',
        slug: 'free',
        price: '0.00',
        validations_limit: 1000,
        projects_limit: 2,
        logs_retention_days: 7,
        features: { basic_rules: true },
        overage_rate: '0.0000',
        max_overage: 0,
        sla: 'none',
        is_custom: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        projects_count: 1
      };

      (pool.query as any).mockResolvedValue({ rows: [mockRow] });

      const result = await plansService.getUserPlan(mockUserId);

      expect(result.id).toBe(mockUserId);
      expect(result.email).toBe('test@example.com');
      expect(result.monthlyValidationsUsed).toBe(1200);
      expect(result.subscriptionStatus).toBe('active');
      expect(result.plan.name).toBe('Free (Developer)');
      expect(result.plan.validationsLimit).toBe(1000);
    });

    it('should throw error if user not found', async () => {
      (pool.query as any).mockResolvedValue({ rows: [] });

      await expect(plansService.getUserPlan(mockUserId)).rejects.toThrow('User not found');
    });
  });

  describe('checkValidationLimit', () => {
    it('should throw LIMIT_EXCEEDED error when over limit without overage', async () => {
      const mockRow = {
        user_id: mockUserId,
        email: 'test@example.com',
        monthly_validations_used: 1200,
        subscription_status: 'active',
        trial_end_date: null,
        id: 'plan-id',
        name: 'Free (Developer)',
        slug: 'free',
        price: '0.00',
        validations_limit: 1000,
        projects_limit: 2,
        logs_retention_days: 7,
        features: { basic_rules: true },
        overage_rate: '0.0000',
        max_overage: 0,
        sla: 'none',
        is_custom: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        projects_count: 1
      };

      (pool.query as any).mockResolvedValue({ rows: [mockRow] });

      await expect(plansService.checkValidationLimit(mockUserId, 1)).rejects.toMatchObject({
        status: 402,
        error: { code: 'LIMIT_EXCEEDED' }
      });
    });

    it('should allow validation within limits', async () => {
      const mockRow = {
        user_id: mockUserId,
        email: 'test@example.com',
        monthly_validations_used: 500,
        subscription_status: 'active',
        trial_end_date: null,
        id: 'plan-id',
        name: 'Free (Developer)',
        slug: 'free',
        price: '0.00',
        validations_limit: 1000,
        projects_limit: 2,
        logs_retention_days: 7,
        features: { basic_rules: true },
        overage_rate: '0.0100',
        max_overage: 2000,
        sla: 'none',
        is_custom: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        projects_count: 1
      };

      (pool.query as any).mockResolvedValue({ rows: [mockRow] });

      const result = await plansService.checkValidationLimit(mockUserId, 100);

      expect(result.remainingValidations).toBe(500);
      expect(result.overageAllowed).toBe(true);
    });
  });

  describe('incrementValidationUsage', () => {
    it('should increment usage counter', async () => {
      const mockRow = {
        user_id: mockUserId,
        email: 'test@example.com',
        monthly_validations_used: 500,
        subscription_status: 'active',
        trial_end_date: null,
        id: 'plan-id',
        name: 'Free (Developer)',
        slug: 'free',
        price: '0.00',
        validations_limit: 1000,
        projects_limit: 2,
        logs_retention_days: 7,
        features: { basic_rules: true },
        overage_rate: '0.0100',
        max_overage: 2000,
        sla: 'none',
        is_custom: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        projects_count: 1
      };

      (pool.query as any)
        .mockResolvedValueOnce({ rows: [mockRow] }) // getUserPlan (before update)
        .mockResolvedValueOnce({ rowCount: 1 }) // update result
        .mockResolvedValueOnce({
          rows: [{
            ...mockRow,
            monthly_validations_used: 510
          }]
        }); // getUserPlan (after update)

      const result = await plansService.incrementValidationUsage(mockUserId, 10);

      expect(result.monthlyValidationsUsed).toBe(510);
      expect((pool.query as any)).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SELECT'),
        [mockUserId]
      );
      expect((pool.query as any)).toHaveBeenNthCalledWith(
        2,
        'UPDATE users SET monthly_validations_used = monthly_validations_used + $1 WHERE id = $2',
        [10, mockUserId]
      );
    });
  });

  describe('checkProjectLimit', () => {
    it('should return true if under project limit', async () => {
      (pool.query as any).mockResolvedValue({
        rows: [{ project_count: 1, projects_limit: 5 }]
      });

      const result = await plansService.checkProjectLimit(mockUserId);

      expect(result).toBe(true);
    });

    it('should return false if at project limit', async () => {
      (pool.query as any).mockResolvedValue({
        rows: [{ project_count: 5, projects_limit: 5 }]
      });

      const result = await plansService.checkProjectLimit(mockUserId);

      expect(result).toBe(false);
    });
  });

  describe('assignDefaultPlan', () => {
    it('should assign default plan to user', async () => {
      const mockDefaultPlan = {
        id: 'default-plan-id',
        name: 'Free',
        slug: 'free',
        price: 0,
        validations_limit: 1000,
        projects_limit: 2,
        logs_retention_days: 7,
        features: {},
        overage_rate: 0.01,
        max_overage: 2000,
        sla: 'none',
        is_custom: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      vi.spyOn(plansService as any, 'getPlanBySlug').mockResolvedValue(mockDefaultPlan);
      (pool.query as any).mockResolvedValueOnce({ rows: [] });

      await plansService.assignDefaultPlan(mockUserId);

      expect((pool.query as any)).toHaveBeenCalledWith(
        'UPDATE users SET plan_id = $1, monthly_validations_used = 0, subscription_status = $2 WHERE id = $3',
        [mockDefaultPlan.id, 'active', mockUserId]
      );
    });
  });
});
