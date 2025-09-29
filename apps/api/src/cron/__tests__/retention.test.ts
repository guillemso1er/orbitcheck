import { Pool } from 'pg';
import { runLogRetention } from '../retention';

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: jest.fn(),
  })),
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
      expect.arrayContaining([expect.stringContaining('days')])
    );
    // Console output is mocked, but we can check the call
  });

  it('should handle query errors gracefully', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error('Database error'));

    // Since it logs but doesn't throw, it should resolve
    await expect(runLogRetention(mockPool)).resolves.not.toThrow();

    consoleErrorSpy.mockRestore();
  });
});