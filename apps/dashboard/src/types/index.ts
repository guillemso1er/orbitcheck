
export interface Rule {
  id: string;
  name: string;
  description?: string;
  condition: string;
  action: 'approve' | 'hold' | 'block';
  priority: number;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
}

export interface TestResult {
  results: {
    email?: any;
    phone?: any;
    address?: any;
    name?: any;
  };
  request_id: string;
}

export interface RuleTestResult {
  ruleId: string;
  ruleName: string;
  condition: string;
  action: string;
  triggered: boolean;
  details: string;
  evaluationTime: number;
  error?: string;
}

export interface ConditionTemplate {
  label: string;
  value: string;
  description: string;
}