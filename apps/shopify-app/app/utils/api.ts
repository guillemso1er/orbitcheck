import { createClient } from "@orbitcheck/contracts";
import { useMemo } from 'react';

import { API_BASE } from "../constants.js";
import { fetchWithRetry } from "./fetch-with-retry.js";

export const useApiClient = (): ReturnType<typeof createClient> => {
    const apiClient = useMemo(() => {
        const client = createClient({
            baseUrl: API_BASE,
            credentials: 'include',
            fetch: fetchWithRetry
        });
        return client;
    }, []);

    return apiClient;
};
