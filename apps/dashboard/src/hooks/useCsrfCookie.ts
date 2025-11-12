import { useEffect, useState } from 'react';

export const useCsrfCookie = (): string | null => {
    const [csrfToken, setCsrfToken] = useState<string | null>(() => {
        // Initialize with current cookie value
        const getCookie = (name: string): string | null => {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2) {
                return parts.pop()?.split(';').shift() || null;
            }
            return null;
        };
        return getCookie('csrf_token_client');
    });

    useEffect(() => {
        const getCookie = (name: string): string | null => {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2) {
                return parts.pop()?.split(';').shift() || null;
            }
            return null;
        };

        const checkCookie = () => {
            const newToken = getCookie('csrf_token_client');
            if (newToken !== csrfToken) {
                setCsrfToken(newToken);
            }
        };

        // Check cookie immediately
        checkCookie();

        // Listen for cookie changes (this is a simple implementation)
        // In a real app, you might want to use a more robust solution
        const interval = setInterval(checkCookie, 500);

        return () => clearInterval(interval);
    }, [csrfToken]);

    return csrfToken;
};;