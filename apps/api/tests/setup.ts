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

import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis'
import { promises as fs } from 'fs'
import Redis from 'ioredis'
import path from 'path'
import { Pool } from 'pg'

let container: StartedPostgreSqlContainer
let redisContainer: StartedRedisContainer
let pool: Pool

export async function startTestEnv() {
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

  const redisConnectionString = redisContainer.getConnectionUrl()

  const dbConnectionString = container.getConnectionUri()

  pool = new Pool({ connectionString: dbConnectionString })
  process.env.DATABASE_URL = dbConnectionString
  process.env.REDIS_URL = redisConnectionString
  // Test connection
  try {
    await pool.query('SELECT 1')
  } catch (error) {
    console.error('Failed to connect to test database:', error)
    await stopTestEnv()
    throw error
  }

  await runMigrations(pool)
  return { pool, dbConnectionString: dbConnectionString, redisConnectionString: redisConnectionString }
}

export async function stopTestEnv() {
  await pool?.end()
  await container?.stop()
}

export async function resetDb() {
  // TRUNCATE all tables to reset database state between tests
  await pool.query(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `)
}

async function runMigrations(db: Pool) {
  const migrationsDir = path.join(process.cwd(), 'migrations');
  console.log(`[Migrations] Looking for migrations in: ${migrationsDir}`);

  try {
    const files = await fs.readdir(migrationsDir);
    const migrationFiles = files
      .filter(file => file.endsWith('.cjs'))
      .sort();

    if (migrationFiles.length === 0) {
      console.error('[Migrations] No migration files found!');
      throw new Error('No migration files found in migrations directory.');
    }

    console.log(`[Migrations] Found ${migrationFiles.length} migration files:`, migrationFiles);

    for (const file of migrationFiles) {
      const migrationPath = path.join(migrationsDir, file);
      console.log(`[Migrations] Running migration: ${file}`);
      const migration = require(migrationPath);

      if (migration.up) {
        await db.query('BEGIN');
        try {
          // You can simplify the pgm object creation as it seems to be the same for both cases
          const pgm = {
            query: (sql: string, params?: any[]) => db.query(sql, params),
            sql: (sql: string) => db.query(sql)
          };

          await migration.up(pgm);
          await db.query('COMMIT');
          console.log(`[Migrations] Successfully committed ${file}`);
        } catch (error) {
          await db.query('ROLLBACK');
          console.error(`[Migrations] Failed to run migration ${file}:`, error);
          throw error; // Re-throw the error to fail the test setup
        }
      }
    }
  } catch (error) {
    console.error('[Migrations] A critical error occurred during the migration process:', error);
    throw error;
  }
}
export function getPool() {
  return pool
}

export function getRedis() {
  return new Redis(redisContainer.getConnectionUrl())
}