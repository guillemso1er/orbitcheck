import { createClient } from "@orbitcheck/contracts";

const DEFAULT_API_BASE = "http://localhost:8080";

const resolveApiBaseUrl = () => {
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

export const getOrbitcheckApiBaseUrl = () => resolveApiBaseUrl();

export const getOrbitcheckClient = () => {
    if (!cachedClient) {
        cachedClient = createClient({
            baseUrl: resolveApiBaseUrl(),
        });
    }
    return cachedClient;
};
