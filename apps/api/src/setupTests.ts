// This file will run automatically before all tests

jest.mock('./env', () => ({
    env: {
        // Provide a default set of mock values for your entire test suite
        JWT_SECRET: 'a-default-test-secret-for-all-tests',
        LOCATIONIQ_KEY: '',
        NOMINATIM_URL: 'https://nominatim.openstreetmap.org',
        USE_GOOGLE_FALLBACK: false,
        GOOGLE_GEOCODING_KEY: '',
        DATABASE_URL: 'postgres://test:test@localhost:5432/testdb',
        REDIS_URL: 'redis://localhost:6379',
        LOG_LEVEL: 'silent',
        // Add any other env variables your application needs during tests
    },
}));

const originalConsole = { ...console };
// This array will buffer the log messages
let consoleOutput: string[] = [];

beforeEach(() => {
  // Clear the buffer before each test
  consoleOutput = [];

  // Override console methods to push to our buffer instead of the console
  Object.keys(console).forEach(key => {
    (console as any)[key] = (...args: any[]) => {
      // Simple stringification for the buffer
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      consoleOutput.push(message);
    };
  });
});

afterEach(() => {
  // The 'jest-circus' test runner (default in Jest) exposes the test status.
  // We check if there are any errors in the current test.
  // Note: This relies on the structure of Jest's test environment.
  // @ts-ignore
  if (expect.getState().currentTestName && expect.getState().suppressedErrors.length > 0) {
    // Restore the original console to print the buffered output
    Object.assign(console, originalConsole);
    
    originalConsole.log('--- CONSOLE LOGS FOR FAILED TEST ---');
    consoleOutput.forEach(log => originalConsole.log(log));
    originalConsole.log('------------------------------------');
  }

  // Restore the original console methods for all other cases
  Object.assign(console, originalConsole);
});