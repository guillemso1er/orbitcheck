import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';

// This function will be executed once before all tests
export async function setup() {
    console.log('[GlobalSetup] Starting test containers...');

    const postgresContainer = await new PostgreSqlContainer('postgres:15-alpine')
        .withDatabase('app_test')
        .withUsername('postgres')
        .withPassword('postgres')
        .withStartupTimeout(120000)
        .start();

    const redisContainer = await new RedisContainer('redis:7-alpine')
        .withExposedPorts(6379)
        .withStartupTimeout(120000)
        .start();

    // Set the environment variables globally BEFORE any application code is imported
    process.env.DATABASE_URL = postgresContainer.getConnectionUri();
    process.env.REDIS_URL = redisContainer.getConnectionUrl();

    console.log('[GlobalSetup] Test containers started and environment configured.');

    // This teardown function will be executed once after all tests have run
    return async () => {
        console.log('[GlobalSetup] Stopping test containers...');
        await postgresContainer.stop();
        await redisContainer.stop();
        console.log('[GlobalSetup] Test containers stopped.');
    };
}