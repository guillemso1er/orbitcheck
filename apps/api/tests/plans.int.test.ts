import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlansService } from '../src/services/plans.js';

describe('PlansService', () => {
  let pool: Pool;
  let plansService: PlansService;
  let mockUserId: string;
  let mockPlanId: string;

  beforeEach(async () => {
    // Mock pool setup
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
        id: mockUserId,
        email: 'test@example.com',
        monthly_validations_used: 1200,
        subscription_status: 'active',
        trial_end_date: null,
        name: 'Free (Developer)',
        slug: 'free',
        price: '0.00',
        validations_limit: 1000,
        projects_limit: 2,
        logs_retention_days: 7,
        features: { basic_rules: true },
        overage_rate: 0,
        max_overage: 0,
        sla: 'none',
        is_custom: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        projects_count: 1
      };

      vi.mocked(pool.query).mockResolvedValue({ rows: [mockRow] });

      await expect(plansService.checkValidationLimit(mockUserId, 1)).rejects.toMatchObject({
        status: 402,
        error: { code: 'LIMIT_EXCEEDED' }
      });
    });

    it('should throw error if user not found', async () => {
      (pool.query as any).mockResolvedValue({ rows: [] });

      await expect(plansService.getUserPlan(mockUserId)).rejects.toThrow('User not found');
    });

    it('should throw error if user not found', async () => {
      (pool.query as any).mockResolvedValue({ rows: [] });

      await expect(plansService.getUserPlan(mockUserId)).rejects.toThrow('User not found');
    });
  });

  describe('checkValidationLimit', () => {
    it('should allow validation within limits', async () => {
      const mockRow = {
        id: mockUserId,
        email: 'test@example.com',
        monthly_validations_used: 500,
        subscription_status: 'active',
        trial_end_date: null,
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

      vi.mocked(pool.query).mockResolvedValue({ rows: [mockRow] });

      const result = await plansService.checkValidationLimit(mockUserId, 100);

      expect(result.remainingValidations).toBe(500);
      expect(result.overageAllowed).toBe(true);
    });

    it('should throw limit exceeded error when over limit without overage', async () => {
      const mockRow = {
        id: mockUserId,
        email: 'test@example.com',
        monthly_validations_used: 500,
        subscription_status: 'active',
        trial_end_date: null,
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

      vi.mocked(pool.query).mockResolvedValue({ rows: [mockRow] });

      (pool.query as any).mockResolvedValue({ rows: [mockRow] });

      await expect(plansService.checkValidationLimit(mockUserId, 1)).rejects.toMatchObject({
        status: 402,
        error: { code: 'LIMIT_EXCEEDED' }
      });
    });
  });

  describe('incrementValidationUsage', () => {
    it('should increment usage counter', async () => {
      const mockRow = {
        id: mockUserId,
        email: 'test@example.com',
        monthly_validations_used: 500,
        subscription_status: 'active',
        trial_end_date: null,
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

      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [mockRow] }) // getUserPlan
        .mockResolvedValueOnce({ rows: [] }); // update

      const result = await plansService.incrementValidationUsage(mockUserId, 10);

      expect(result.monthlyValidationsUsed).toBe(510);
      expect(vi.mocked(pool.query)).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SELECT'),
        [mockUserId]
      );
      expect(vi.mocked(pool.query)).toHaveBeenNthCalledWith(
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
      vi.mocked(pool.query).mockResolvedValue({
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
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });

      await plansService.assignDefaultPlan(mockUserId);

      expect(vi.mocked(pool.query)).toHaveBeenCalledWith(
        'UPDATE users SET plan_id = $1, monthly_validations_used = 0, subscription_status = $2 WHERE id = $3',
        [mockDefaultPlan.id, 'active', mockUserId]
      );
    });
  });
});
