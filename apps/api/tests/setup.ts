
// At the top of setup.ts or in a separate test config file
if (process.env.NODE_ENV === 'test') {
  process.on('unhandledRejection', (reason, promise) => {
    // Log only if it's not an expected test database error
    if (!reason?.toString().includes('relation') && !reason?.toString().includes('does not exist')) {
      console.error('Unhandled Rejection in tests:', reason);
    }
  });
}
// Set up minimal environment variables for testing
process.env.NODE_ENV = 'test'
process.env.BASE_URL = 'http://localhost:8080'
process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/app_test'
process.env.REDIS_URL = 'redis://localhost:6379'
process.env.JWT_SECRET = 'test-jwt-secret'
process.env.ENCRYPTION_KEY = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
process.env.SESSION_SECRET = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
process.env.FRONTEND_URL = 'http://localhost:5173'
process.env.CORS_ORIGINS = 'http://localhost:5173'
process.env.LOG_LEVEL = 'error'
process.env.SENTRY_DSN = ''
process.env.NOMINATIM_URL = 'https://nominatim.openstreetmap.org'
process.env.DISPOSABLE_LIST_URL = 'https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.json'
process.env.VIES_WSDL_URL = 'https://ec.europa.eu/taxation_customs/vies/checkVatService.wsdl'
process.env.RETENTION_DAYS = '90'
process.env.RATE_LIMIT_COUNT = '300'
process.env.RATE_LIMIT_BURST = '500'
process.env.S3_ENDPOINT = ''
process.env.S3_ACCESS_KEY = 'test'
process.env.S3_SECRET_KEY = 'test'
process.env.S3_BUCKET = 'test'
process.env.STRIPE_ENABLED = 'false'
process.env.STRIPE_SECRET_KEY = ''
process.env.STRIPE_BASE_PLAN_PRICE_ID = ''
process.env.STRIPE_USAGE_PRICE_ID = ''
process.env.STRIPE_STORE_ADDON_PRICE_ID = ''
process.env.TWILIO_ACCOUNT_SID = ''
process.env.TWILIO_AUTH_TOKEN = ''
process.env.TWILIO_VERIFY_SERVICE_SID = ''
process.env.TWILIO_PHONE_NUMBER = ''
process.env.GOOGLE_GEOCODING_KEY = ''
process.env.USE_GOOGLE_FALLBACK = 'false'
process.env.LOCATIONIQ_KEY = ''

import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { promises as fs } from 'fs';
import Redis from 'ioredis';
import path from 'path';
import { Pool } from 'pg';

let container: StartedPostgreSqlContainer
let redisContainer: StartedRedisContainer
let pool: Pool

export async function startTestEnv() {
  try {
    // Start containers
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('app_test')
      .withUsername('postgres')
      .withPassword('postgres')
      .withStartupTimeout(120000)
      .start()

    redisContainer = await new RedisContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withStartupTimeout(120000)
      .start()

    const dbConnectionString = container.getConnectionUri()
    const redisConnectionString = redisContainer.getConnectionUrl()

    // Create pool
    pool = new Pool({ connectionString: dbConnectionString })

    // Update environment variables
    process.env.DATABASE_URL = dbConnectionString
    process.env.REDIS_URL = redisConnectionString

    // Test connection with retries
    let connected = false;
    for (let i = 0; i < 5; i++) {
      try {
        await pool.query('SELECT 1')
        connected = true;
        break;
      } catch (error) {
        if (i === 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Run migrations
    await runMigrations(pool)

    // Verify migrations completed
    await pool.query('SELECT 1 FROM users LIMIT 1');

    return { pool, dbConnectionString, redisConnectionString }
  } catch (error) {
    console.error('Failed to start test environment:', error)
    await stopTestEnv()
    throw error
  }
}

export async function stopTestEnv() {
  await pool?.end()
  await container?.stop()
}

export async function resetDb() {
  try {
    // Disable foreign key checks during deletion
    await pool.query('SET session_replication_role = replica;');

    // Delete all data but keep schema
    const dataTables = [
      'users', 'projects', 'api_keys', 'personal_access_tokens',
      'audit_logs', 'webhooks', 'rules', 'order_logs', 'jobs',
      'settings', 'country_bounding_boxes', 'usage_counts'
    ];

    for (const tableName of dataTables) {
      try {
        await pool.query(`DELETE FROM ${tableName};`);
      } catch (error) {
        // Table might not exist, continue
        console.warn(`Failed to delete from ${tableName}:`, error.message);
      }
    }

  } finally {
    // Re-enable foreign key checks
    await pool.query('SET session_replication_role = DEFAULT;');
  }
}


async function runMigrations(db: Pool) {
  const migrationsDir = path.join(process.cwd(), 'migrations');

  // Only log in non-test environments
  const isTest = process.env.NODE_ENV === 'test';
  const log = isTest ? () => { } : console.log;

  log(`[Migrations] Looking for migrations in: ${migrationsDir}`);

  try {
    const files = await fs.readdir(migrationsDir);
    const migrationFiles = files
      .filter(file => file.endsWith('.cjs'))
      .sort();

    if (migrationFiles.length === 0) {
      throw new Error('No migration files found in migrations directory.');
    }

    log(`[Migrations] Found ${migrationFiles.length} migration files:`, migrationFiles);

    for (const file of migrationFiles) {
      const migrationPath = path.join(migrationsDir, file);
      log(`[Migrations] Executing migration: ${file}`);

      const migration = require(migrationPath);

      if (migration.up) {
        await db.query('BEGIN');
        try {
          const pgm = {
            query: (sql: string, params?: any[]) => db.query(sql, params),
            sql: (sql: string) => db.query(sql)
          };

          await migration.up(pgm);
          await db.query('COMMIT');
          log(`[Migrations] Successfully committed ${file}`);
        } catch (error) {
          await db.query('ROLLBACK');
          if (!isTest) {
            console.error(`[Migrations] Failed to run migration ${file}:`, error);
          }
          throw error;
        }
      }
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[Migrations] A critical error occurred during the migration process:', error);
    }
    throw error;
  }
}
export function getPool() {
  return pool
}

export function getRedis() {
  return new Redis(redisContainer.getConnectionUrl())
}