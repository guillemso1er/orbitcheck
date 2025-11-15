export const SHOPIFY_REQUIRED_SCOPES = [
    'read_orders',
    'write_orders',
    'read_customers',
    'write_customers',
];

export const SHOPIFY_SCOPE_STRING = SHOPIFY_REQUIRED_SCOPES.join(',');

export function parseScopes(value: string | string[] | undefined): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value
            .map((scope) => scope.trim().toLowerCase())
            .filter(Boolean);
    }
    return value
        .split(',')
        .map((scope) => scope.trim().toLowerCase())
        .filter(Boolean);
}

export function missingScopes(grantedScopes: string[]): string[] {
    const normalized = grantedScopes.map((scope) => scope.toLowerCase());
    return SHOPIFY_REQUIRED_SCOPES.filter((scope) => !normalized.includes(scope));
}