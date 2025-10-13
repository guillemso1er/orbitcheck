import { randomBytes } from 'crypto';
import 'dotenv/config';
import fs from 'fs';

import { InfisicalSDK } from '@infisical/sdk';

import { CRYPTO_KEY_BYTES } from "./constants.js";

let infisicalCreds: { CLIENT_ID?: string; CLIENT_SECRET?: string; PROJECT_ID?: string; BASE_URL?: string } = {};
let infisicalAuthenticated = true;

try {
  const credsPath = '/tmp/infisical-credentials.json';
  if (fs.existsSync(credsPath)) {
    const credsData = fs.readFileSync(credsPath, 'utf-8');
    infisicalCreds = JSON.parse(credsData);
  }
} catch (error) {
  console.warn('Failed to read Infisical credentials file:', error);
}

const infisicalClient = new InfisicalSDK({
  siteUrl: infisicalCreds.BASE_URL || process.env.INFISICAL_SITE_URL || "https://app.infisical.com",
});

// Authenticate with Infisical
try {
  if (infisicalCreds.CLIENT_ID && infisicalCreds.CLIENT_SECRET) {
    await infisicalClient.auth().universalAuth.login({
      clientId: infisicalCreds.CLIENT_ID,
      clientSecret: infisicalCreds.CLIENT_SECRET,
    });
    infisicalAuthenticated = true;
  } else if (process.env.INFISICAL_SERVICE_TOKEN) {
    // Use service token by accessing the auth client directly
    (infisicalClient as any).authenticate(process.env.INFISICAL_SERVICE_TOKEN);
    infisicalAuthenticated = true;
  }
} catch (error) {
  console.warn('Failed to authenticate with Infisical:', error);
}

const getSecret = async (key: string, fallback?: string): Promise<string> => {
  // For local development, use environment variables directly first
  if (process.env.NODE_ENV === 'development') {
    const directValue = process.env[key];
    if (directValue !== undefined) {
      return directValue;
    }
    // Then check INFISICAL_ prefixed
    const envKey = `INFISICAL_${key}`;
    const envValue = process.env[envKey];
    if (envValue !== undefined) {
      return envValue;
    }
    // If no Infisical credentials available (no JSON file or env config), use fallback
    if (!infisicalAuthenticated) {
      return fallback || "";
    }
  }

  // Skip Infisical calls if not authenticated
  if (!infisicalAuthenticated) {
    return fallback || "";
  }

  try {
    const secret = await infisicalClient.secrets().getSecret({
      environment: process.env.INFISICAL_ENVIRONMENT || "dev",
      projectId: infisicalCreds.PROJECT_ID || process.env.INFISICAL_PROJECT_ID || "",
      secretName: key,
    });
    return secret.secretValue;
  } catch (error) {
    console.warn(`Failed to fetch secret ${key} from Infisical, using fallback:`, error);
    return fallback || "";
  }
};

const getNumberSecret = async (key: string, fallback: number): Promise<number> => {
  const value = await getSecret(key, fallback.toString());
  return Number.parseInt(value, 10);
};

const getBooleanSecret = async (key: string, fallback: boolean): Promise<boolean> => {
  const value = await getSecret(key, fallback ? "true" : "false");
  return value === "true";
};

export const environment = {
  PORT: await getNumberSecret("PORT", 8080),
  DATABASE_URL: await getSecret("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/orbicheck"),
  REDIS_URL: await getSecret("REDIS_URL", "redis://localhost:6379"),
  LOG_LEVEL: await getSecret("LOG_LEVEL", "info"),
  NOMINATIM_URL: await getSecret("NOMINATIM_URL", "https://nominatim.openstreetmap.org"),
  LOCATIONIQ_KEY: await getSecret("LOCATIONIQ_KEY", ""),
  DISPOSABLE_LIST_URL: await getSecret("DISPOSABLE_LIST_URL", "https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.json"),
  SENTRY_DSN: await getSecret("SENTRY_DSN", ""),
  VIES_WSDL_URL: await getSecret("VIES_WSDL_URL", "https://ec.europa.eu/taxation_customs/vies/checkVatService.wsdl"),
  RETENTION_DAYS: await getNumberSecret("RETENTION_DAYS", 90),
  RATE_LIMIT_COUNT: await getNumberSecret("RATE_LIMIT_COUNT", 300),
  TWILIO_ACCOUNT_SID: await getSecret("TWILIO_ACCOUNT_SID", ""),
  TWILIO_AUTH_TOKEN: await getSecret("TWILIO_AUTH_TOKEN", ""),
  TWILIO_VERIFY_SERVICE_SID: await getSecret("TWILIO_VERIFY_SERVICE_SID", ""),
  TWILIO_PHONE_NUMBER: await getSecret("TWILIO_PHONE_NUMBER", ""),
  S3_ENDPOINT: await getSecret("S3_ENDPOINT", "http://localhost:9000"),
  S3_ACCESS_KEY: await getSecret("S3_ACCESS_KEY", "minioadmin"),
  S3_SECRET_KEY: await getSecret("S3_SECRET_KEY", "minioadmin"),
  S3_BUCKET: await getSecret("S3_BUCKET", "orbicheck"),
  GOOGLE_GEOCODING_KEY: await getSecret("GOOGLE_GEOCODING_KEY", ""),
  USE_GOOGLE_FALLBACK: await getBooleanSecret("USE_GOOGLE_FALLBACK", false),
  JWT_SECRET: await getSecret("JWT_SECRET", "dummy_jwt_secret_for_local_dev"),
  ENCRYPTION_KEY: await getSecret("ENCRYPTION_KEY", "dummy_encryption_key_32_chars_long"),
  SESSION_SECRET: await getSecret("SESSION_SECRET", randomBytes(CRYPTO_KEY_BYTES).toString('hex')),

  // OIDC configuration (optional)
  OIDC_ENABLED: await getBooleanSecret("OIDC_ENABLED", false),
  OIDC_CLIENT_ID: await getSecret("OIDC_CLIENT_ID"),
  OIDC_CLIENT_SECRET: await getSecret("OIDC_CLIENT_SECRET"),
  OIDC_PROVIDER_URL: await getSecret("OIDC_PROVIDER_URL"), // e.g., https://accounts.google.com
  OIDC_REDIRECT_URI: await getSecret("OIDC_REDIRECT_URI", `http://localhost:8080/auth/callback`),

  // Stripe (for billing - optional, provide dummy for local dev)
  STRIPE_SECRET_KEY: await getSecret("STRIPE_SECRET_KEY", "sk_test_dummy"),
  STRIPE_BASE_PLAN_PRICE_ID: await getSecret("STRIPE_BASE_PLAN_PRICE_ID", "price_dummy"),
  STRIPE_USAGE_PRICE_ID: await getSecret("STRIPE_USAGE_PRICE_ID", "price_dummy"),
  STRIPE_STORE_ADDON_PRICE_ID: await getSecret("STRIPE_STORE_ADDON_PRICE_ID", "price_dummy"),
  FRONTEND_URL: await getSecret("FRONTEND_URL", "http://localhost:5173"),

  // Infisical (for secret management) - don't fetch these from Infisical itself
  INFISICAL_PROJECT_ID: infisicalCreds.PROJECT_ID || process.env.INFISICAL_PROJECT_ID || "",
  INFISICAL_ENVIRONMENT: process.env.INFISICAL_ENVIRONMENT || "dev",
  INFISICAL_SITE_URL: infisicalCreds.BASE_URL || process.env.INFISICAL_SITE_URL || "https://app.infisical.com",
};