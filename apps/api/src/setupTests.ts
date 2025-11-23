// This file will run automatically before all tests

// Mock process.exit to prevent test suite from exiting
jest.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

// Mock fetch globally to prevent real HTTP requests during tests
global.fetch = jest.fn();

jest.mock('./environment', () => ({
    environment: {
        // Provide a default set of mock values for your entire test suite
        JWT_SECRET: 'a-default-test-secret-for-all-tests',
        LOCATIONIQ_KEY: '',
        NOMINATIM_URL: 'https://nominatim.openstreetmap.org',
        USE_GOOGLE_FALLBACK: false,
        GOOGLE_GEOCODING_KEY: '',
        DATABASE_URL: 'postgres://test:test@localhost:5432/testdb',
        REDIS_URL: 'redis://localhost:6379',
        LOG_LEVEL: 'silent',
        ENCRYPTION_KEY: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        POSTHOG_KEY: '',
        POSTHOG_HOST: 'https://us.i.posthog.com',
        // Add any other env variables your application needs during tests
    },
}));
