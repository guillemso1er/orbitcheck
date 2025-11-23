import { createClient } from "@orbitcheck/contracts";
import jwt from "jsonwebtoken";

import { fetchWithRetry } from "./fetch-with-retry.js";

const DEFAULT_API_BASE = "http://localhost:8080";

const resolveApiBaseUrl = (): string => {
    const raw = process.env.ORBITCHECK_API_URL || process.env.API_BASE_URL || process.env.VITE_API_BASE;
    if (!raw) {
        return DEFAULT_API_BASE;
    }

    if (raw.startsWith("http://") || raw.startsWith("https://")) {
        return raw.replace(/\/$/, "");
    }

    // If a relative path is provided, fall back to the default base.
    return DEFAULT_API_BASE;
};

let cachedClient: ReturnType<typeof createClient> | null = null;

export const getOrbitcheckApiBaseUrl = (): string => resolveApiBaseUrl();

export const getOrbitcheckClient = (): ReturnType<typeof createClient> => {
    if (!cachedClient) {
        cachedClient = createClient({
            baseUrl: resolveApiBaseUrl(),
            fetch: fetchWithRetry,
        });
    }
    return cachedClient;
};

/**
 * Generate a Shopify session JWT for OrbitCheck API authentication.
 * This creates a JWT signed with the app secret containing the required claims.
 */
export const generateShopifySessionToken = (shopDomain: string): string => {
    const appKey = process.env.SHOPIFY_API_KEY;
    const appSecret = process.env.SHOPIFY_API_SECRET;

    if (!appKey || !appSecret) {
        throw new Error("Missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET environment variables");
    }

    const payload = {
        aud: appKey,
        dest: `https://${shopDomain}`,
    };

    return jwt.sign(payload, appSecret, { algorithm: 'HS256' });
};
