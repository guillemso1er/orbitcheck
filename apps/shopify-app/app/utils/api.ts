import { createClient } from "@orbitcheck/contracts";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useCallback, useMemo } from 'react';

import { API_BASE } from "../constants.js";
import { fetchWithRetry } from "./fetch-with-retry.js";

export const useApiClient = (): ReturnType<typeof createClient> => {
    const shopify = useAppBridge();

    // Create a stable authenticated fetch function
    const authenticatedFetch = useCallback<typeof fetch>(async (input, init) => {
        // Get the Shopify session token for authentication
        const token = await shopify.idToken();

        // Handle headers from both Request objects and init options
        // When input is a Request, headers may be in the Request, not in init
        const existingHeaders = input instanceof Request ? input.headers : init?.headers;
        const headers = new Headers(existingHeaders);
        headers.set('Authorization', `Bearer ${token}`);

        return fetchWithRetry(input, {
            ...init,
            headers,
        });
    }, [shopify]);

    const apiClient = useMemo(() => {
        const client = createClient({
            baseUrl: API_BASE,
            credentials: 'include',
            fetch: authenticatedFetch
        });
        return client;
    }, [authenticatedFetch]);

    return apiClient;
};
