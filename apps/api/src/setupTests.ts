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