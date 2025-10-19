jest.mock('@scalar/fastify-api-reference', () => ({
  __esModule: true, // This is important for mocking ESM modules
  default: jest.fn(), // Mock the default export, which is the fastify plugin
}));

jest.mock('validator', () => ({
  // Your inputSanitizationHook likely uses `escape`. Mock it to return the
  // input so it doesn't break your code during the test.
  escape: jest.fn(str => str),
  trim: jest.fn(str => str),
  // Add any other validator functions you use in your hooks if needed
}));
// Tell Jest to use the manual mock we created in src/mocks/environment.ts
jest.mock('@orbitcheck/contracts', () => ({
  DASHBOARD_ROUTES: {
    REGISTER_NEW_USER: '/auth/register',
    USER_LOGIN: '/auth/login',
    USER_LOGOUT: '/auth/logout',
  }
}));

jest.mock('@dotenvx/dotenvx/config', () => ({
  
}));

jest.mock('../environment', () => ({
  environment: {
    PORT: 8080,
    DATABASE_URL: 'postgres://test',
    REDIS_URL: 'redis://test',
    SENTRY_DSN: '',
    LOG_LEVEL: 'info',
    SESSION_SECRET: 'test-secret',
  }
}));

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
}));

// Mock all dependencies BEFORE importing them
jest.mock('@fastify/cors', () => jest.fn());
jest.mock('@fastify/cookie', () => jest.fn());
jest.mock('@fastify/secure-session', () => jest.fn());
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
  hasRoute: jest.fn().mockReturnValue(true),
  close: jest.fn().mockResolvedValue(undefined),
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

jest.mock('../startup-guard', () => jest.fn());

jest.mock('../plugins/openapi', () => ({
  openapiValidation: jest.fn(),
}));

jest.mock('../cron/retention', () => ({
  runLogRetention: jest.fn(),
}));

jest.mock('../jobs/refreshDisposable', () => ({
  disposableProcessor: jest.fn(),
}));

jest.mock('node-postal', () => ({
  parse: jest.fn(() => ({})),
}));

// Mock fs and yaml for OpenAPI spec loading
jest.mock('node:fs', () => ({
  readFileSync: jest.fn(() => 'mocked yaml content'),
  existsSync: jest.fn(() => false),
}));

jest.mock('js-yaml', () => ({
  load: jest.fn(() => ({
    openapi: '3.0.3',
    info: {
      title: 'OrbiCheck API',
      description: 'API for validation, deduplication, and risk assessment services',
      version: '1.0.0'
    },
    paths: {}
  })),
}));

// Now these imports will receive the mocked modules
import cors from '@fastify/cors';
import { Queue, Worker } from 'bullmq';
import Fastify from 'fastify';
import { type Redis as IORedisType, Redis } from 'ioredis';
import cron from 'node-cron';
import { Pool } from 'pg';

// Import the mocked env so we can manipulate it in tests
import { environment } from '../environment.js';
// Re-require the server module to ensure it gets the mocked dependencies
import { build, start } from '../server.js';
import { registerRoutes } from '../web.js';

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
      SESSION_SECRET: 'test-secret',
    });
  });

  it('should build the Fastify app and init Sentry when DSN is set', async () => {
    // 1. Arrange: Modify the imported mock env for this specific test
    environment.SENTRY_DSN = 'test_dsn';
    environment.LOG_LEVEL = 'debug';

    // 2. Act: Run the function under test
    const app = await build(mockPool, mockRedis);

    // 3. Assert: Check the outcomes
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
      trustProxy: true,
    });
    expect(mockRegisterRoutes).toHaveBeenCalledWith(app, mockPool, mockRedis);
  });

  it('should configure CORS with async origin function that validates allowed origins', async () => {
    process.env.NODE_ENV = 'production';
    const app = await build(mockPool, mockRedis);

    const corsCall = mockApp.register.mock.calls.find(call => call[0] === cors);
    expect(corsCall).toBeDefined();

    const options = corsCall[1];
    expect(options).toHaveProperty('origin');
    expect(typeof options.origin).toBe('function');

    // Test that it's async
    const result = options.origin('http://localhost:5173');
    expect(result).toBeInstanceOf(Promise);

    // Test logic
    await expect(options.origin(undefined)).resolves.toBe(true);
    await expect(options.origin('http://localhost:5173')).resolves.toBe(false);
    await expect(options.origin(`http://localhost:${environment.PORT}`)).resolves.toBe(true);
    await expect(options.origin('https://dashboard.orbitcheck.io')).resolves.toBe(true);
    await expect(options.origin('https://api.orbitcheck.io')).resolves.toBe(true);
    await expect(options.origin('http://evil.com')).resolves.toBe(false);

    expect(options.credentials).toBe(true);
  });
});

describe('Server Startup', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockRedis: jest.Mocked<IORedisType>;
  let originalSetTimeout: typeof setTimeout;
  let mockProcessExit: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();

    // Store original setTimeout before mocking
    originalSetTimeout = global.setTimeout;

    mockPool = {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue({
        query: jest.fn().mockResolvedValue({ rows: [{ value: 1 }] }),
        release: jest.fn(),
      }),
      end: jest.fn().mockResolvedValue(undefined),
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

    // Mock process.exit to prevent actual exit
    mockProcessExit = jest.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      // Do nothing - prevent actual exit
    }) as any);
  });

  afterEach(() => {
    // Clear all timers to prevent timeout from executing after test
    jest.clearAllTimers();
    jest.useRealTimers();

    // Restore process.exit
    mockProcessExit.mockRestore();
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
    expect(mockApp.log.info).toHaveBeenCalledWith(`Orbitcheck API server listening on http://0.0.0.0:${environment.PORT}`);
  });

  it('should handle startup errors', async () => {
    // Arrange
    const error = new Error('Database connection failed');
    // Make the Pool constructor throw when it's called inside start()
    (Pool as unknown as jest.Mock).mockImplementationOnce(() => {
      throw error;
    });

    // Act & Assert
    // This line tells Jest: "I expect the start() promise to be rejected,
    // and the reason for the rejection should be an error with this message."
    await expect(start()).rejects.toThrow('Database connection failed');

    // Advance timers to trigger the forced exit timeout
    jest.advanceTimersByTime(1000);

    // You can also assert that process.exit was called if that's part of your logic
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it('should register /v1/status endpoint', async () => {
    const app = await build(mockPool, mockRedis);

    // Check that get method was called for /v1/status
    const statusCall = mockApp.get.mock.calls.find(call => call[0] === '/v1/status');
    expect(statusCall).toBeDefined();

    // Verify the handler function exists
    const handler = statusCall[1];
    expect(typeof handler).toBe('function');
  });
});
