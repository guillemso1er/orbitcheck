jest.mock('../../env', () => ({
  environment: {
    DISPOSABLE_LIST_URL: 'https://example.com/disposable-domains.json',
  }
}));

import type { Job } from 'bullmq'; // <-- 1. Import the Job type
const { Redis: IORedisType } = require('ioredis');
import fetch from 'node-fetch';

import { disposableProcessor } from '../refreshDisposable.js';

// Mock the dependencies
// Mock the ioredis module
jest.mock('ioredis', () => ({
  Redis: jest.fn(),
}));
jest.mock('node-fetch');

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('Disposable Domains Refresh Job', () => {
  let mockRedis: jest.Mocked<typeof IORedisType>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRedis = {
      del: jest.fn().mockResolvedValue(1),
      rename: jest.fn().mockResolvedValue('OK'),
      sadd: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK'),
    } as any;

    // Mock the constructor properly
    (IORedisType as any).mockImplementation(() => mockRedis);

    const mockFetchResponse = {
      json: jest.fn().mockResolvedValue(['disposable1.com', 'disposable2.com']),
    } as any;
    mockFetch.mockResolvedValue(mockFetchResponse);
  });

  it('should successfully refresh disposable domains from the API', async () => {
    // 2. Cast the simple job object to the Job type
    const job = { data: { redis: mockRedis } } as Job;

    await disposableProcessor(job);

    expect(mockFetch).toHaveBeenCalledWith(expect.any(String));
    expect(mockRedis.del).toHaveBeenCalledWith('disposable_domains_tmp');
    expect(mockRedis.sadd).toHaveBeenCalledTimes(1);
    expect(mockRedis.sadd).toHaveBeenCalledWith('disposable_domains_tmp', 'disposable1.com', 'disposable2.com');
    expect(mockRedis.rename).toHaveBeenCalledWith('disposable_domains_tmp', 'disposable_domains');
    expect(mockRedis.quit).not.toHaveBeenCalled();
  });

  it('should quit redis if not provided in job data', async () => {
    // Cast the job object here as well
    const job = { data: {} } as Job;

    await disposableProcessor(job);

    expect(mockRedis.del).toHaveBeenCalled();
    expect(mockRedis.quit).toHaveBeenCalled();
  });

  it('should handle fetch errors and rethrow', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
    const mockError = new Error('Network error');
    mockFetch.mockRejectedValueOnce(mockError);

    // Cast the job object
    const job = { data: { redis: mockRedis } } as Job;

    await expect(disposableProcessor(job)).rejects.toThrow('Network error');
    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to refresh disposable domains:", mockError);
    expect(mockRedis.del).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should handle Redis errors and rethrow', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
    const mockError = new Error('Redis error');
    (mockRedis.sadd as jest.Mock).mockRejectedValueOnce(mockError);

    // And cast the job object here
    const job = { data: { redis: mockRedis } } as Job;

    await expect(disposableProcessor(job)).rejects.toThrow('Redis error');
    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to refresh disposable domains:", mockError);
    expect(mockRedis.del).toHaveBeenCalledWith('disposable_domains_tmp');
    expect(mockRedis.rename).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});