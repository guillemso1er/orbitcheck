export interface Plan {
  id: string;
  name: string;
  slug: string;
  price: number;
  validationsLimit: number;
  projectsLimit: number;
  logsRetentionDays: number;
  features: Record<string, any>;
  overageRate: number;
  maxOverage?: number;
  sla?: string;
  isCustom: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserPlan {
  id: string;
  email: string;
  plan: Plan;
  monthlyValidationsUsed: number;
  subscriptionStatus: 'active' | 'trial' | 'canceled' | 'suspended';
  trialEndDate?: string;
  projectsCount: number;
}

export interface Usage {
  monthlyValidationsUsed: number;
  planValidationsLimit: number;
  overageAllowed: boolean;
  remainingValidations: number;
}
