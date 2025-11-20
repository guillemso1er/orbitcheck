// src/config/environment.ts
import { randomBytes } from 'crypto';
import 'dotenv/config'; // harmless in prod; useful for local dev
import { bool, cleanEnv, makeValidator, num, port, str, url } from 'envalid';
import { CRYPTO_KEY_BYTES } from './config.js'; // must match your crypto key size (bytes)

const NODE_ENV = process.env.NODE_ENV || 'production';
const isProd = NODE_ENV === 'production';

// Helpers
const randomHex = (bytes: number) => randomBytes(bytes).toString('hex');

const csv = makeValidator<string[]>((s) => {
  if (typeof s !== 'string') throw new Error('must be a string');
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
});

const urlOrEmpty = makeValidator<string>((s) => {
  if (s === '' || s == null) return '';
  try {
    const u = new URL(String(s));
    return u.toString();
  } catch {
    throw new Error('must be empty or a valid URL');
  }
});

// Enforce hex key of exact byte length
const hexOfBytes = (bytes: number) =>
  makeValidator<string>((s) => {
    if (typeof s !== 'string') throw new Error('must be a hex string');
    if (!/^[0-9a-f]+$/i.test(s)) throw new Error('must be hex');
    if (s.length % 2 !== 0) throw new Error('hex length must be even');
    const buf = Buffer.from(s, 'hex');
    if (buf.length !== bytes) throw new Error(`must be ${bytes} bytes (${bytes * 2} hex chars)`);
    return s.toLowerCase();
  });

export const env = cleanEnv(process.env, {
  // Runtime mode
  NODE_ENV: str({ choices: ['development', 'test', 'production', 'local'], default: 'production' }),

  // Core
  PORT: port({ default: 8080 }),
  DATABASE_URL: url({ default: '' }),
  APP_DATABASE_URL: url({ default: '' }),
  REDIS_URL: isProd ? url() : url({ default: 'redis://localhost:6379' }),
  BASE_URL: url({ default: isProd ? '' : 'http://localhost:8080' }),
  ADDRESS_SERVICE_URL: url({ default: 'http://localhost:8081' }),

  // Logging/observability
  LOG_LEVEL: str({ choices: ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'], default: 'info' }),
  SENTRY_DSN: str({ default: '' }),

  // External services and supporting URLs
  NOMINATIM_URL: url({ default: 'https://nominatim.openstreetmap.org' }),
  LOCATIONIQ_KEY: str({ default: '' }),
  DISPOSABLE_LIST_URL: url({ default: 'https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.json' }),
  VIES_WSDL_URL: url({ default: 'https://ec.europa.eu/taxation_customs/vies/checkVatService.wsdl' }),
  GEOAPIFY_KEY: str({ default: '' }),

  POSTHOG_KEY: str({ default: '' }),
  POSTHOG_HOST: url({ default: 'https://us.i.posthog.com' }),

  // Retention / rate limits
  RETENTION_DAYS: num({ default: 90 }),
  RATE_LIMIT_COUNT: num({ default: 300 }),
  RATE_LIMIT_BURST: num({ default: 500 }),

  // Twilio (optional, all-or-nothing)
  TWILIO_ACCOUNT_SID: str({ default: '' }),
  TWILIO_AUTH_TOKEN: str({ default: '' }),
  TWILIO_VERIFY_SERVICE_SID: str({ default: '' }),
  TWILIO_PHONE_NUMBER: str({ default: '' }),

  // Object storage (S3-compatible)
  // Endpoint can be blank (e.g., using AWS SDK defaults); in dev we default to local MinIO
  S3_ENDPOINT: isProd ? urlOrEmpty({ default: '' }) : urlOrEmpty({ default: 'http://localhost:9000' }),
  S3_ACCESS_KEY: isProd ? str() : str({ default: 'minioadmin' }),
  S3_SECRET_KEY: isProd ? str() : str({ default: 'minioadmin' }),
  S3_BUCKET: isProd ? str() : str({ default: 'orbitcheck' }),

  // Geocoding
  GOOGLE_GEOCODING_KEY: str({ default: '' }),
  USE_GOOGLE_FALLBACK: bool({ default: false }),
  RADAR_KEY: str({ default: '' }),
  RADAR_API_URL: url({ default: 'https://api.radar.io/v1' }),

  // Auth/secrets
  JWT_SECRET: isProd ? str() : str({ default: `dev_jwt_${randomHex(16)}` }),
  ENCRYPTION_KEY: isProd
    ? hexOfBytes(CRYPTO_KEY_BYTES)()
    : hexOfBytes(CRYPTO_KEY_BYTES)({ default: randomHex(CRYPTO_KEY_BYTES) }),
  SESSION_SECRET: isProd ? str() : str({ default: randomHex(CRYPTO_KEY_BYTES) }),

  // OIDC (optional)
  // OIDC_ENABLED: bool({ default: false }),
  // OIDC_CLIENT_ID: str({ default: '' }),
  // OIDC_CLIENT_SECRET: str({ default: '' }),
  // OIDC_PROVIDER_URL: url({ default: 'https://accounts.google.com' }), // e.g., https://accounts.google.com
  // OIDC_REDIRECT_URI: isProd ? url() : url({ default: 'http://localhost:8080/auth/callback' }),

  // Stripe (optional)
  STRIPE_ENABLED: bool({ default: false }),
  STRIPE_SECRET_KEY: str({ default: '' }),
  STRIPE_BASE_PLAN_PRICE_ID: str({ default: '' }),
  STRIPE_USAGE_PRICE_ID: str({ default: '' }),
  STRIPE_STORE_ADDON_PRICE_ID: str({ default: '' }),

  // CORS / frontend
  FRONTEND_URL: isProd ? url() : url({ default: 'http://localhost:5173' }),
  CORS_ORIGINS: csv({ default: isProd ? [] : ['http://localhost:5173'] }), // comma-separated list in env
});

// Cross-field checks (fail fast with clear errors)
// if (env.OIDC_ENABLED) {
//   if (!env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET || !env.OIDC_PROVIDER_URL || !env.OIDC_REDIRECT_URI) {
//     throw new Error('When OIDC_ENABLED=true you must set OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_PROVIDER_URL, and OIDC_REDIRECT_URI');
//   }
// }

if (env.STRIPE_ENABLED) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_BASE_PLAN_PRICE_ID || !env.STRIPE_USAGE_PRICE_ID || !env.STRIPE_STORE_ADDON_PRICE_ID) {
    throw new Error('When STRIPE_ENABLED=true you must set STRIPE_SECRET_KEY and all STRIPE_*_PRICE_ID values');
  }
}

const twilioFields = [env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_VERIFY_SERVICE_SID, env.TWILIO_PHONE_NUMBER];
const someTwilio = twilioFields.some(Boolean);
const allTwilio = twilioFields.every(Boolean);
if (someTwilio && !allTwilio) {
  throw new Error('Either set all TWILIO_* vars or none');
}

// Derived/normalized values
export const environment = {
  ...env,
  DATABASE_URL: env.DATABASE_URL || env.APP_DATABASE_URL || (isProd ? '' : 'postgres://postgres:postgres@localhost:5432/orbitcheck'),
  // If CORS_ORIGINS is empty in prod, fallback to FRONTEND_URL
  CORS_ORIGINS: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : [env.FRONTEND_URL],
  HTTP2_ENABLED: isProd
} as const;