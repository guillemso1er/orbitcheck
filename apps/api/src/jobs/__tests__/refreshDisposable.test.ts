import IORedis from 'ioredis';
import fetch from 'node-fetch';
import { disposableProcessor } from '../refreshDisposable';

// Mock the dependencies
jest.mock('ioredis');
jest.mock('node-fetch');

// Cast the mocked fetch to its mocked type once for convenience
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('Disposable Domains Refresh Job', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test_jwt_secret';
    process.env.DISPOSABLE_LIST_URL = 'https://example.com/disposable-domains.json';
  });
  let mockRedis: jest.Mocked<IORedis>;
  let mockPipeline: {
    exec: jest.Mock;
    sadd: jest.Mock;
  };

  beforeEach(() => {
    // Set up a consistent mock for the Redis pipeline
    const mockExec = jest.fn().mockResolvedValue([[]]);
    const mockSadd = jest.fn();
    mockPipeline = {
      exec: mockExec,
      sadd: mockSadd,
    };
    // Ensure that calling `sadd` returns the pipeline to allow for chaining
    mockSadd.mockReturnValue(mockPipeline);

    // Set up the main Redis client mock
    mockRedis = {
      del: jest.fn().mockResolvedValue(1),
      rename: jest.fn().mockResolvedValue('OK'),
      pipeline: jest.fn().mockReturnValue(mockPipeline),
      quit: jest.fn().mockResolvedValue('OK'),
    } as any;

    // Mock the IORedis constructor to return our mock client
    (IORedis as unknown as jest.Mock).mockImplementation(() => mockRedis);

    // Set up a standard successful response for fetch
    const mockFetchResponse = {
      json: jest.fn().mockResolvedValue(['disposable1.com', 'disposable2.com']),
    } as any;
    mockFetch.mockResolvedValue(mockFetchResponse);
  });

  afterEach(() => {
    // Clear all mocks between tests to ensure they don't interfere with each other
    jest.clearAllMocks();
  });

  it('should successfully refresh disposable domains from the API', async () => {
    const job = { data: { redis: mockRedis } };

    await disposableProcessor(job);

    expect(mockFetch).toHaveBeenCalledWith(expect.any(String));
    expect(mockRedis.del).toHaveBeenCalledWith('disposable_domains_tmp');
    expect(mockRedis.pipeline).toHaveBeenCalled();
    expect(mockPipeline.sadd).toHaveBeenCalledTimes(2);
    expect(mockPipeline.sadd).toHaveBeenCalledWith('disposable_domains_tmp', 'disposable1.com');
    expect(mockPipeline.sadd).toHaveBeenCalledWith('disposable_domains_tmp', 'disposable2.com');
    expect(mockPipeline.exec).toHaveBeenCalled();
    expect(mockRedis.rename).toHaveBeenCalledWith('disposable_domains_tmp', 'disposable_domains');
    // quit() should not be called since we passed a Redis instance in job.data
    expect(mockRedis.quit).not.toHaveBeenCalled();
  });

  it('should quit redis if not provided in job data', async () => {
    const job = { data: {} };

    await disposableProcessor(job);

    // A new Redis instance should have been created and then quit
    expect(mockRedis.quit).toHaveBeenCalled();
  });

  it('should handle fetch errors and rethrow', async () => {
    // Spy on console.error and provide a mock implementation to suppress output
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

    const job = { data: { redis: mockRedis } };
    const mockError = new Error('Network error');
    mockFetch.mockRejectedValueOnce(mockError);

    // Expect the processor to reject with the same error
    await expect(disposableProcessor(job)).rejects.toThrow('Network error');

    // Verify that our error logging was called correctly
    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to refresh disposable domains:", mockError);

    // The process should fail before any Redis write operations are called
    expect(mockRedis.del).not.toHaveBeenCalled();

    // Restore the original console.error implementation
    consoleErrorSpy.mockRestore();
  });

  it('should handle Redis errors and rethrow', async () => {
    // Spy on console.error to suppress output for this test
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

    const job = { data: { redis: mockRedis } };
    const mockError = new Error('Redis error');
    // Mock the pipeline's exec method to simulate a Redis failure
    mockPipeline.exec.mockRejectedValueOnce(mockError);

    // Expect the processor to reject with the Redis error
    await expect(disposableProcessor(job)).rejects.toThrow('Redis error');

    // Verify that our error logging was called
    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to refresh disposable domains:", mockError);

    // Restore the original console.error
    consoleErrorSpy.mockRestore();
  });
});