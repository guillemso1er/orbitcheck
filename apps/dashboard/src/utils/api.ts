import { createClient } from "@orbitcheck/contracts";
import { useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { API_BASE, HTTP_HEADERS } from '../constants';

export const useApiClient = () => {
    const { csrfToken } = useAuth();

    const apiClient = useMemo(() => {
        const client = createClient({ baseUrl: API_BASE, credentials: 'include' });

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
