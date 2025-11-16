import { createClient } from "@orbitcheck/contracts";
import { useMemo } from 'react';
import { API_BASE } from "../constants.js";

export const useApiClient = () => {
    const apiClient = useMemo(() => {
        const client = createClient({ baseUrl: API_BASE, credentials: 'include' });
        return client;
    }, []);

    return apiClient;
};
