import { createClient } from "@orbitcheck/contracts";
import { API_BASE } from '../constants';

export const apiClient = createClient({ baseUrl: API_BASE, credentials: 'include' });

// Add CSRF token to requests that need it
apiClient.interceptors.request.use((request) => {
    // Add CSRF token for state-changing methods (POST, PUT, DELETE, PATCH)
    const method = request.method?.toUpperCase();
    if (method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        const csrfToken = localStorage.getItem('csrf_token');
        if (csrfToken) {
            request.headers.set('x-csrf-token', csrfToken);
        }
    }
    return request;
});
