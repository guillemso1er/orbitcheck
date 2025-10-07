import type { Pool } from 'pg';

import { runLogRetention } from '../retention.js';

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../environment', () => ({
  environment: {
    RETENTION_DAYS: 90,
  }
}));

describe('Log Retention Cron Job', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test_jwt_secret';
  });
  let mockPool: jest.Mocked<Pool>;
  let mockQuery: jest.Mock;

  beforeEach(() => {
    mockQuery = jest.fn();
    mockPool = {
      query: mockQuery,
    } as any;
  });

  it('should successfully delete old log entries', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 5 });

    await runLogRetention(mockPool);

    expect(mockQuery).toHaveBeenCalledWith(
      'DELETE FROM logs WHERE created_at < NOW() - INTERVAL $1',
      ['90 days']
    );
    // Console output is mocked, but we can check the call
  });

  it('should handle query errors gracefully', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
    mockQuery.mockRejectedValueOnce(new Error('Database error'));

    // Since it logs but doesn't throw, it should resolve
    await expect(runLogRetention(mockPool)).resolves.not.toThrow();

    consoleErrorSpy.mockRestore();
  });
});