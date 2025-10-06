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
  TestWebhookBody
} from './api-client/orbiCheckAPI.js';

import {
  createApiKey,
  getLogs,
  getUsage,
  listApiKeys,
  loginUser,
  registerUser,
  revokeApiKey,
  testWebhook
} from './api-client/orbiCheckAPI.js';

export interface ApiClientConfig {
  baseURL: string;
  token: string;
}

export class ApiClient {
  private baseURL: string;
  private token: string;

  constructor(config: ApiClientConfig) {
    this.baseURL = config.baseURL;
    this.token = config.token;
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
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
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
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
    });
    return response.data;
  }

  // API Keys API
  async listApiKeys(): Promise<ListApiKeys200> {
    const response = await listApiKeys({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
    });
    return response.data;
  }

  async createApiKey(name?: string): Promise<CreateApiKey201> {
    const body: CreateApiKeyBody = name ? { name } : {};
    const response = await createApiKey(body, {
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
    });
    return response.data;
  }

  async revokeApiKey(id: string): Promise<RevokeApiKey200> {
    const response = await revokeApiKey(id, {
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
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
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
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