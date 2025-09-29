import * as Sentry from '@sentry/node';
import { Queue, Worker } from 'bullmq';
import Fastify from 'fastify';
import IORedis from 'ioredis';
import cron from 'node-cron';
import { Pool } from 'pg';
import { registerRoutes } from '../web';

// --- Top-level Mocks ---

// Tell Jest to use the manual mock we created in src/__mocks__/env.ts
// This line MUST come before any imports from '../server' or its dependencies.
jest.mock('../env');

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock('@fastify/cors', () => jest.fn());
jest.mock('@fastify/swagger', () => jest.fn());
jest.mock('@fastify/swagger-ui', () => jest.fn());

const mockApp = {
  register: jest.fn(),
  addHook: jest.fn(),
  get: jest.fn(),
  listen: jest.fn().mockResolvedValue(undefined),
  log: { info: jest.fn() },
};
jest.mock('fastify', () => jest.fn(() => mockApp));

jest.mock('pg', () => ({
  Pool: jest.fn(),
}));
jest.mock('ioredis', () => jest.fn());

const mockQueue = {
  add: jest.fn(),
};
jest.mock('bullmq', () => ({
  Queue: jest.fn(() => mockQueue),
  Worker: jest.fn(),
}));

jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

jest.mock('../web', () => ({
  registerRoutes: jest.fn(),
}));

// Import the mocked env so we can manipulate it in tests
import { env } from '../env';
// Re-require the server module to ensure it gets the mocked dependencies
import { build, start } from '../server';

const mockRegisterRoutes = registerRoutes as jest.Mock;

describe('Server Build', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockRedis: jest.Mocked<IORedis>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = {} as any;
    mockRedis = {} as any;
    (mockApp.register as jest.Mock).mockResolvedValue(undefined);

    // Reset env to a default, clean state before each test
    Object.assign(env, {
      SENTRY_DSN: '',
      LOG_LEVEL: 'info',
      PORT: 8080,
    });
  });

  it('should build the Fastify app and init Sentry when DSN is set', async () => {
    // 1. Arrange: Modify the imported mock env for this specific test
    env.SENTRY_DSN = 'test_dsn';
    env.LOG_LEVEL = 'debug';

    // 2. Act: Run the function under test
    const app = await build(mockPool, mockRedis);

    // 3. Assert: Check the outcomes
    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'test_dsn',
      tracesSampleRate: 1.0,
    });
    expect(Fastify).toHaveBeenCalledWith({ logger: { level: 'debug' } });
    expect(mockRegisterRoutes).toHaveBeenCalledWith(app, mockPool, mockRedis);
  });
});

describe('Server Startup', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockRedis: jest.Mocked<IORedis>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = { query: jest.fn() } as any;
    mockRedis = { quit: jest.fn() } as any;
    (Pool as unknown as jest.Mock).mockImplementation(() => mockPool);
    (IORedis as unknown as jest.Mock).mockImplementation(() => mockRedis);
    (mockQueue.add as jest.Mock).mockResolvedValue({});
  });

  it('should start the server and setup all services', async () => {
    // Arrange: Configure env for the startup process
    env.PORT = 3000;
    env.DATABASE_URL = 'postgres://test';
    env.REDIS_URL = 'redis://test';

    // Act
    await start();

    // Assert: Check side-effects from both build() and start()
    expect(Fastify).toHaveBeenCalled();
    expect(Queue).toHaveBeenCalledWith('disposable', { connection: mockRedis });
    expect(mockQueue.add).toHaveBeenCalledTimes(2); // Called for repeat and once on startup
    expect(Worker).toHaveBeenCalledWith('disposable', expect.any(Function), { connection: mockRedis });
    expect(cron.schedule).toHaveBeenCalledWith('0 0 * * *', expect.any(Function));
    expect(mockApp.listen).toHaveBeenCalledWith({ port: 3000, host: '0.0.0.0' });
    expect(mockApp.log.info).toHaveBeenCalledWith(`Orbicheck API server listening on http://0.0.0.0:${env.PORT}`);
  });

  it('should handle startup errors', async () => {
    // Arrange
    const error = new Error('Database connection failed');
    (Pool as unknown as jest.Mock).mockImplementationOnce(() => {
      throw error;
    });

    // Act & Assert
    await expect(start()).rejects.toThrow('Database connection failed');
  });
});