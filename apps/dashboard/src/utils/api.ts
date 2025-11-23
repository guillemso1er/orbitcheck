import { createClient } from "@orbitcheck/contracts";
import { useMemo } from 'react';
import { API_BASE, HTTP_HEADERS } from '../constants';
import { useCsrfCookie } from '../hooks/useCsrfCookie';
import { fetchWithRetry } from "./fetch-with-retry.ts";

export const useApiClient = () => {
    const csrfToken = useCsrfCookie();

    const apiClient = useMemo(() => {


        const client = createClient({
            baseUrl: API_BASE,
            credentials: 'include',
            fetch: fetchWithRetry
        });

        // Add CSRF token to requests that need it
        client.interceptors.request.use((request) => {
            // Add CSRF token for state-changing methods (POST, PUT, DELETE, PATCH)
            const method = request.method?.toUpperCase();
            if (method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
                if (csrfToken) {
                    request.headers.set(HTTP_HEADERS.CSRF_TOKEN, csrfToken);
                }
            }
            return request;
        });

        return client;
    }, [csrfToken]);

    return apiClient;
};
