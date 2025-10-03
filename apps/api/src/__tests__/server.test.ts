import * as Sentry from '@sentry/node';
import { Queue, Worker } from 'bullmq';
import Fastify from 'fastify';
import { Redis, type Redis as IORedisType } from 'ioredis';
import cron from 'node-cron';
import { Pool } from 'pg';

import { registerRoutes } from '../web.js';

// --- Top-level Mocks ---

// Tell Jest to use the manual mock we created in src/__mocks__/env.ts
// This line MUST come before any imports from '../server.js' or its dependencies.
jest.mock('../env', () => ({
  environment: {
    PORT: 8080,
    DATABASE_URL: 'postgres://test',
    REDIS_URL: 'redis://test',
    SENTRY_DSN: '',
    LOG_LEVEL: 'info',
  }
}));

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
  inject: jest.fn().mockResolvedValue({ statusCode: 200, body: JSON.stringify({ ok: true, timestamp: 'test' }) }),
  listen: jest.fn().mockResolvedValue(undefined),
  log: { info: jest.fn(), error: jest.fn() },
  setErrorHandler: jest.fn(),
};
jest.mock('fastify', () => jest.fn(() => mockApp));

jest.mock('pg', () => ({
  Pool: jest.fn(),
}));
jest.mock('ioredis', () => ({
  Redis: jest.fn(),
}));

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
import { environment } from '../env.js';
// Re-require the server module to ensure it gets the mocked dependencies
import { build, start } from '../server.js';

const mockRegisterRoutes = registerRoutes as jest.Mock;

describe('Server Build', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockRedis: jest.Mocked<IORedisType>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = {} as any;
    mockRedis = {} as any;
    (mockApp.register).mockResolvedValue(undefined);

    // Reset env to a default, clean state before each test
    Object.assign(environment, {
      SENTRY_DSN: '',
      LOG_LEVEL: 'info',
      PORT: 8080,
    });
  });

  it('should build the Fastify app and init Sentry when DSN is set', async () => {
    // 1. Arrange: Modify the imported mock env for this specific test
    environment.SENTRY_DSN = 'test_dsn';
    environment.LOG_LEVEL = 'debug';

    // 2. Act: Run the function under test
    const app = await build(mockPool, mockRedis);

    // 3. Assert: Check the outcomes
    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'test_dsn',
      tracesSampleRate: 1,
    });
    expect(Fastify).toHaveBeenCalledWith({
      logger: {
        level: 'debug',
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard'
          }
        }
      },
      requestTimeout: 10_000,
    });
    expect(mockRegisterRoutes).toHaveBeenCalledWith(app, mockPool, mockRedis);
  });
});

describe('Server Startup', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockRedis: jest.Mocked<IORedisType>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue({
        query: jest.fn().mockResolvedValue({ rows: [{ value: 1 }] }),
        release: jest.fn(),
      }),
    } as any;
    mockRedis = {
      quit: jest.fn().mockResolvedValue(true),
      status: 'ready' as const,
      on: jest.fn(),
      ping: jest.fn().mockResolvedValue('PONG'),
      sadd: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
      rename: jest.fn().mockResolvedValue('OK'),
    } as any;
    (Pool as unknown as jest.Mock).mockImplementation(() => mockPool);
    (Redis as unknown as jest.Mock).mockImplementation(() => mockRedis);
    (mockQueue.add).mockResolvedValue({});
  });

  it('should start the server and setup all services', async () => {
    // Arrange: Configure env for the startup process
    environment.PORT = 3000;
    environment.DATABASE_URL = 'postgres://test';
    environment.REDIS_URL = 'redis://test';

    // Act
    await start();

    // Assert: Check side-effects from both build() and start()
    expect(Fastify).toHaveBeenCalled();
    expect(Queue).toHaveBeenCalledWith('disposable', { connection: mockRedis });
    expect(mockQueue.add).toHaveBeenCalledTimes(2); // Called for repeat and once on startup
    expect(Worker).toHaveBeenCalledWith('disposable', expect.any(Function), { connection: mockRedis });
    expect(cron.schedule).toHaveBeenCalledWith('0 0 * * *', expect.any(Function));
    expect(mockApp.listen).toHaveBeenCalledWith({ port: 3000, host: '0.0.0.0' });
    expect(mockApp.log.info).toHaveBeenCalledWith(`Orbicheck API server listening on http://0.0.0.0:${environment.PORT}`);
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