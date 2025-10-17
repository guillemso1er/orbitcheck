import 'dotenv/config';

import { InfisicalSDK } from '@infisical/sdk';
import { randomBytes } from 'crypto';
import fs from 'fs';

import { CRYPTO_KEY_BYTES } from "./config.js";

const enableInfisical = process.env.INFISICAL_RUNTIME_FETCH_SECRETS === 'true';

let infisicalCreds: { CLIENT_ID?: string; CLIENT_SECRET?: string; PROJECT_ID?: string; BASE_URL?: string } = {};
let infisicalAuthenticated = false;

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
  siteUrl: infisicalCreds.BASE_URL || process.env.API_INFISICAL_SITE_URL || "https://app.infisical.com",
});

// Authenticate with Infisical only if enabled
if (enableInfisical) {
  try {
    if (infisicalCreds.CLIENT_ID && infisicalCreds.CLIENT_SECRET) {
      await infisicalClient.auth().universalAuth.login({
        clientId: infisicalCreds.CLIENT_ID,
        clientSecret: infisicalCreds.CLIENT_SECRET,
      });
      infisicalAuthenticated = true;
    } else if (process.env.API_INFISICAL_SERVICE_TOKEN) {
      // Use service token by accessing the auth client directly
      (infisicalClient as any).authenticate(process.env.API_INFISICAL_SERVICE_TOKEN);
      infisicalAuthenticated = true;
    }
  } catch (error) {
    console.warn('Failed to authenticate with Infisical:', error);
  }
}

const getSecret = async (key: string, fallback?: string): Promise<string> => {
  // Always check environment variables first
  const envValue = process.env[`API_${key}`] || process.env[key];
  if (envValue !== undefined) {
    return envValue;
  }

  // If Infisical is enabled and authenticated, try to fetch from Infisical
  if (enableInfisical && infisicalAuthenticated) {
    try {
      const secret = await infisicalClient.secrets().getSecret({
        environment: process.env.API_INFISICAL_ENVIRONMENT || "dev",
        projectId: infisicalCreds.PROJECT_ID || process.env.API_INFISICAL_PROJECT_ID || "",
        secretName: key,
      });
      return secret.secretValue;
    } catch (error) {
      console.warn(`Failed to fetch secret ${key} from Infisical, using fallback:`, error);
    }
  }

  // Use fallback if environment variable not found and Infisical not available/enabled
  return fallback || "";
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
  PORT: await getNumberSecret("API_PORT", 8080),
  DATABASE_URL: await getSecret("API_DATABASE_URL", "postgres://postgres:postgres@localhost:5432/orbicheck"),
  REDIS_URL: await getSecret("API_REDIS_URL", "redis://localhost:6379"),
  LOG_LEVEL: await getSecret("API_LOG_LEVEL", "info"),
  NOMINATIM_URL: await getSecret("API_NOMINATIM_URL", "https://nominatim.openstreetmap.org"),
  LOCATIONIQ_KEY: await getSecret("API_LOCATIONIQ_KEY", ""),
  DISPOSABLE_LIST_URL: await getSecret("API_DISPOSABLE_LIST_URL", "https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.json"),
  SENTRY_DSN: await getSecret("API_SENTRY_DSN", ""),
  VIES_WSDL_URL: await getSecret("API_VIES_WSDL_URL", "https://ec.europa.eu/taxation_customs/vies/checkVatService.wsdl"),
  RETENTION_DAYS: await getNumberSecret("API_RETENTION_DAYS", 90),
  RATE_LIMIT_COUNT: await getNumberSecret("API_RATE_LIMIT_COUNT", 300),
  RATE_LIMIT_BURST: await getNumberSecret("API_RATE_LIMIT_BURST", 500),
  TWILIO_ACCOUNT_SID: await getSecret("API_TWILIO_ACCOUNT_SID", ""),
  TWILIO_AUTH_TOKEN: await getSecret("API_TWILIO_AUTH_TOKEN", ""),
  TWILIO_VERIFY_SERVICE_SID: await getSecret("API_TWILIO_VERIFY_SERVICE_SID", ""),
  TWILIO_PHONE_NUMBER: await getSecret("API_TWILIO_PHONE_NUMBER", ""),
  S3_ENDPOINT: await getSecret("API_S3_ENDPOINT", "http://localhost:9000"),
  S3_ACCESS_KEY: await getSecret("API_S3_ACCESS_KEY", "minioadmin"),
  S3_SECRET_KEY: await getSecret("API_S3_SECRET_KEY", "minioadmin"),
  S3_BUCKET: await getSecret("API_S3_BUCKET", "orbicheck"),
  GOOGLE_GEOCODING_KEY: await getSecret("API_GOOGLE_GEOCODING_KEY", ""),
  USE_GOOGLE_FALLBACK: await getBooleanSecret("API_USE_GOOGLE_FALLBACK", false),
  JWT_SECRET: await getSecret("API_JWT_SECRET", "dummy_jwt_secret_for_local_dev"),
  ENCRYPTION_KEY: await getSecret("API_ENCRYPTION_KEY", "dummy_encryption_key_32_chars_long"),
  SESSION_SECRET: await getSecret("API_SESSION_SECRET", randomBytes(CRYPTO_KEY_BYTES).toString('hex')),

  // OIDC configuration (optional)
  OIDC_ENABLED: await getBooleanSecret("API_OIDC_ENABLED", false),
  OIDC_CLIENT_ID: await getSecret("API_OIDC_CLIENT_ID"),
  OIDC_CLIENT_SECRET: await getSecret("API_OIDC_CLIENT_SECRET"),
  OIDC_PROVIDER_URL: await getSecret("API_OIDC_PROVIDER_URL"), // e.g., https://accounts.google.com
  OIDC_REDIRECT_URI: await getSecret("API_OIDC_REDIRECT_URI", `http://localhost:8080/auth/callback`),

  // Stripe (for billing - optional, provide dummy for local dev)
  STRIPE_SECRET_KEY: await getSecret("API_STRIPE_SECRET_KEY", "sk_test_dummy"),
  STRIPE_BASE_PLAN_PRICE_ID: await getSecret("API_STRIPE_BASE_PLAN_PRICE_ID", "price_dummy"),
  STRIPE_USAGE_PRICE_ID: await getSecret("API_STRIPE_USAGE_PRICE_ID", "price_dummy"),
  STRIPE_STORE_ADDON_PRICE_ID: await getSecret("API_STRIPE_STORE_ADDON_PRICE_ID", "price_dummy"),
  FRONTEND_URL: await getSecret("API_FRONTEND_URL", "http://localhost:5173"),
  CORS_ORIGINS: await getSecret("API_CORS_ORIGINS"),

  // Infisical (for secret management) - don't fetch these from Infisical itself
  INFISICAL_PROJECT_ID: infisicalCreds.PROJECT_ID || process.env.API_INFISICAL_PROJECT_ID || "",
  INFISICAL_ENVIRONMENT: process.env.API_INFISICAL_ENVIRONMENT || "dev",
  INFISICAL_SITE_URL: infisicalCreds.BASE_URL || process.env.API_INFISICAL_SITE_URL || "https://app.infisical.com",
};