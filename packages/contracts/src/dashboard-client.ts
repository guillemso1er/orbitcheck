/**
 * Dashboard API Client
 * A simplified client for the dashboard to use the generated OpenAPI types
 */
import type {
  CreateApiKey201,
  CreateApiKeyBody,
  GetLogs200,
  GetUsage200,
  ListApiKeys200,
  LoginUser200,
  LoginUserBody,
  RegisterUser201,
  RegisterUserBody,
  RevokeApiKey200,
  TestWebhook200,
  TestWebhookBody,
  BatchValidateBody,
  BatchValidate202,
  BatchDedupeBody,
  BatchDedupe202,
  GetJobStatus200,
  EvaluateOrderBody,
  EvaluateOrder200
} from './api-client/orbiCheckAPI.js';

import {
  createApiKey,
  getLogs,
  getUsage,
  listApiKeys,
  loginUser,
  registerUser,
  revokeApiKey,
  testWebhook,
  batchValidate,
  batchDedupe,
  getJobStatus,
  evaluateOrder
} from './api-client/orbiCheckAPI.js';

export interface ApiClientConfig {
  baseURL: string;
}

export class ApiClient {
  private baseURL: string;

  constructor(config: ApiClientConfig) {
    this.baseURL = config.baseURL;
  }

  private getHeaders() {
    const headers: Record<string, string> = {};
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }


  // Authentication methods (don't require token)
  async registerUser(body: RegisterUserBody): Promise<RegisterUser201> {
    const response = await registerUser(body, {
      baseURL: this.baseURL,
    });
    return response.data;
  }

  async loginUser(body: LoginUserBody): Promise<LoginUser200> {
    const response = await loginUser(body, {
      baseURL: this.baseURL,
    });
    return response.data;
  }

  // Usage API
  async getUsage(): Promise<GetUsage200> {
    const response = await getUsage({
      baseURL: this.baseURL,
      withCredentials: true,
      headers: this.getHeaders()
    });
    return response.data;
  }

  // Logs API
  async getLogs(params?: {
    reason_code?: string;
    endpoint?: string;
    status?: number;
    limit?: number;
    offset?: number;
  }): Promise<GetLogs200> {
    const response = await getLogs(params, {
      baseURL: this.baseURL,
      withCredentials: true,
      headers: this.getHeaders()
    });
    return response.data;
  }

  // API Keys API
  async listApiKeys(): Promise<ListApiKeys200> {
    const response = await listApiKeys({
      baseURL: this.baseURL,
      withCredentials: true,
      headers: this.getHeaders()
    });
    return response.data;
  }

  async createApiKey(name?: string): Promise<CreateApiKey201> {
    const body: CreateApiKeyBody = name ? { name } : {};
    const response = await createApiKey(body, {
      baseURL: this.baseURL,
      withCredentials: true,
      headers: this.getHeaders()
    });
    return response.data;
  }

  async revokeApiKey(id: string): Promise<RevokeApiKey200> {
    const response = await revokeApiKey(id, {
      baseURL: this.baseURL,
      withCredentials: true,
      headers: this.getHeaders()
    });
    return response.data;
  }

  // Webhook API
  async testWebhook(url: string, payloadType: 'validation' | 'order' | 'custom', payload?: any): Promise<TestWebhook200> {
    const body: TestWebhookBody = { url, payload_type: payloadType };
    if (payload) {
      body.custom_payload = payload;
    }
    const response = await testWebhook(body, {
      baseURL: this.baseURL,
      withCredentials: true,
      headers: this.getHeaders()
    });
    return response.data;
  }

  // Batch Operations API
  async batchValidateData(body: BatchValidateBody): Promise<BatchValidate202> {
    const response = await batchValidate(body, {
      baseURL: this.baseURL,
      withCredentials: true,
      headers: this.getHeaders()
    });
    return response.data;
  }

  async batchDedupeData(body: BatchDedupeBody): Promise<BatchDedupe202> {
    const response = await batchDedupe(body, {
      baseURL: this.baseURL,
      withCredentials: true,
      headers: this.getHeaders()
    });
    return response.data;
  }

  async getJobStatus(jobId: string): Promise<GetJobStatus200> {
    const response = await getJobStatus(jobId, {
      baseURL: this.baseURL,
      withCredentials: true,
      headers: this.getHeaders()
    });
    return response.data;
  }

  async evaluateOrder(body: EvaluateOrderBody): Promise<EvaluateOrder200> {
    const response = await evaluateOrder(body, {
      baseURL: this.baseURL,
      withCredentials: true,
      headers: this.getHeaders()
    });
    return response.data;
  }
}

// Factory function to create API client
export function createApiClient(config: ApiClientConfig): ApiClient {
  return new ApiClient(config);
}

// Default export for easy usage
export default ApiClient;