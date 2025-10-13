import { randomBytes } from 'crypto';

import { InfisicalSDK } from '@infisical/sdk';

import { CRYPTO_KEY_BYTES, ERROR_CODES, ERROR_MESSAGES } from "./constants.js";

const infisicalClient = new InfisicalSDK({
  siteUrl: process.env.INFISICAL_SITE_URL || "https://app.infisical.com",
});

const getSecret = async (key: string, fallback?: string): Promise<string> => {
  try {
    const secret = await infisicalClient.secrets().getSecret({
      environment: process.env.INFISICAL_ENVIRONMENT || "dev",
      projectId: process.env.INFISICAL_PROJECT_ID || "",
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
    JWT_SECRET: await getSecret("JWT_SECRET") || (() => { throw new Error(ERROR_MESSAGES[ERROR_CODES.MISSING_JWT_SECRET]); })(),
    ENCRYPTION_KEY: await getSecret("ENCRYPTION_KEY") || (() => { throw new Error(ERROR_MESSAGES[ERROR_CODES.MISSING_ENCRYPTION_KEY]); })(),
    SESSION_SECRET: await getSecret("SESSION_SECRET", randomBytes(CRYPTO_KEY_BYTES).toString('hex')),

    // OIDC configuration (optional)
    OIDC_ENABLED: await getBooleanSecret("OIDC_ENABLED", false),
    OIDC_CLIENT_ID: await getSecret("OIDC_CLIENT_ID"),
    OIDC_CLIENT_SECRET: await getSecret("OIDC_CLIENT_SECRET"),
    OIDC_PROVIDER_URL: await getSecret("OIDC_PROVIDER_URL"), // e.g., https://accounts.google.com
    OIDC_REDIRECT_URI: await getSecret("OIDC_REDIRECT_URI", `http://localhost:8080/auth/callback`),
};