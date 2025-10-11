import type { FastifyInstance } from 'fastify';

import { createApp, mockPool, setupBeforeAll } from './testSetup.js';

describe('Settings Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupBeforeAll();
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock authentication query that sets project_id
    mockPool.query.mockImplementation((queryText: string) => {
      if (queryText.includes('SELECT project_id FROM api_keys')) {
        return Promise.resolve({ rows: [{ project_id: 'test_project_id' }] });
      }
      if (queryText.includes('SELECT country_defaults, formatting, risk_thresholds FROM settings')) {
        return Promise.resolve({ rows: [] });
      }
      if (queryText.includes('INSERT INTO settings')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  it('should get default settings when no settings exist', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/settings',
      headers: {
        authorization: 'Bearer test_token'
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.country_defaults).toEqual({});
    expect(body.formatting).toEqual({});
    expect(body.risk_thresholds).toEqual({});
    expect(body.request_id).toBeDefined();
  });

  it('should get existing settings', async () => {
    const mockSettings = {
      country_defaults: { country: 'US' },
      formatting: { date_format: 'MM/DD/YYYY' },
      risk_thresholds: { max_score: 0.8 }
    };

    mockPool.query.mockResolvedValueOnce({ rows: [mockSettings] });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/settings',
      headers: {
        authorization: 'Bearer test_token'
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.country_defaults).toEqual(mockSettings.country_defaults);
    expect(body.formatting).toEqual(mockSettings.formatting);
    expect(body.risk_thresholds).toEqual(mockSettings.risk_thresholds);
  });

  it('should update settings', async () => {
    const updateData = {
      country_defaults: { country: 'EU' },
      formatting: { date_format: 'DD/MM/YYYY' },
      risk_thresholds: { max_score: 0.9 }
    };

    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({
      method: 'PUT',
      url: '/v1/settings',
      headers: {
        authorization: 'Bearer test_token'
      },
      payload: updateData
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.message).toBe('Settings updated successfully');
    expect(body.request_id).toBeDefined();

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO settings'),
      expect.any(Array)
    );
  });

  it('should handle database errors on get', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB error'));

    const response = await app.inject({
      method: 'GET',
      url: '/v1/settings',
      headers: {
        authorization: 'Bearer test_token'
      }
    });

    expect(response.statusCode).toBe(500);
  });

  it('should handle database errors on put', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB error'));

    const response = await app.inject({
      method: 'PUT',
      url: '/v1/settings',
      headers: {
        authorization: 'Bearer test_token'
      },
      payload: { country_defaults: {} }
    });

    expect(response.statusCode).toBe(500);
  });
});