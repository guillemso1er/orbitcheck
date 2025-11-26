/**
 * GraphQL error handling utilities for Shopify webhook handlers
 * 
 * Handles ACCESS_DENIED errors that occur when PII fields are requested
 * but the app doesn't have the required customer data access permissions.
 */

/**
 * Shopify GraphQL error structure
 */
export interface ShopifyGraphQLError {
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: {
        code?: string;
        typeName?: string;
        fieldName?: string;
        [key: string]: unknown;
    };
}

/**
 * GraphQL response structure with potential errors
 */
export interface ShopifyGraphQLResponse<T> {
    data?: T;
    errors?: ShopifyGraphQLError[];
    extensions?: {
        cost?: {
            requestedQueryCost: number;
            actualQueryCost: number;
            throttleStatus: {
                maximumAvailable: number;
                currentlyAvailable: number;
                restoreRate: number;
            };
        };
    };
}

/**
 * PII field access error codes from Shopify
 */
export const PII_ERROR_CODES = [
    'ACCESS_DENIED',
    'FORBIDDEN',
    'UNAUTHORIZED',
    'CUSTOMER_DATA_ACCESS_DENIED',
] as const;

/**
 * PII-related field names that may return null/errors when access is denied
 */
export const PII_FIELDS = [
    'email',
    'phone',
    'firstName',
    'lastName',
    'defaultAddress',
    'addresses',
    'billingAddress',
    'shippingAddress',
    'note',
    'taxExemptions',
    'customer',
] as const;

/**
 * Check if a GraphQL error is related to PII access being denied
 */
export function isPiiAccessDeniedError(error: ShopifyGraphQLError): boolean {
    // Check extension code
    if (error.extensions?.code && PII_ERROR_CODES.includes(error.extensions.code as typeof PII_ERROR_CODES[number])) {
        return true;
    }

    // Check message for common access denied patterns
    const accessDeniedPatterns = [
        /access denied/i,
        /permission denied/i,
        /not authorized/i,
        /customer data.*not accessible/i,
        /protected customer data/i,
    ];

    if (accessDeniedPatterns.some((pattern) => pattern.test(error.message))) {
        return true;
    }

    // Check if the error path includes a PII field
    if (error.path?.some((pathSegment) => PII_FIELDS.includes(pathSegment as typeof PII_FIELDS[number]))) {
        return true;
    }

    return false;
}

/**
 * Result of processing GraphQL errors
 */
export interface GraphQLErrorResult {
    /** Whether any errors were found */
    hasErrors: boolean;
    /** Whether any errors are PII access denied errors */
    hasPiiAccessDenied: boolean;
    /** List of PII fields that had access denied */
    deniedPiiFields: string[];
    /** Other non-PII errors that occurred */
    otherErrors: ShopifyGraphQLError[];
    /** All errors for logging */
    allErrors: ShopifyGraphQLError[];
}

/**
 * Process GraphQL errors and categorize them
 * 
 * @param errors - Array of GraphQL errors from the response
 * @returns Categorized error result
 */
export function processGraphQLErrors(errors: ShopifyGraphQLError[] | undefined): GraphQLErrorResult {
    if (!errors || errors.length === 0) {
        return {
            hasErrors: false,
            hasPiiAccessDenied: false,
            deniedPiiFields: [],
            otherErrors: [],
            allErrors: [],
        };
    }

    const deniedPiiFields: string[] = [];
    const otherErrors: ShopifyGraphQLError[] = [];

    for (const error of errors) {
        if (isPiiAccessDeniedError(error)) {
            // Extract field name from path or extensions
            const fieldName = error.extensions?.fieldName || error.path?.[error.path.length - 1];
            if (fieldName && !deniedPiiFields.includes(fieldName)) {
                deniedPiiFields.push(fieldName);
            }
        } else {
            otherErrors.push(error);
        }
    }

    return {
        hasErrors: true,
        hasPiiAccessDenied: deniedPiiFields.length > 0,
        deniedPiiFields,
        otherErrors,
        allErrors: errors,
    };
}

/**
 * Log GraphQL errors appropriately based on their type
 * 
 * @param shop - Shop domain for context
 * @param topic - Webhook topic
 * @param errorResult - Processed error result
 */
export function logGraphQLErrors(
    shop: string,
    topic: string,
    errorResult: GraphQLErrorResult
): void {
    if (!errorResult.hasErrors) {
        return;
    }

    // Log PII access denied as info (expected in some cases)
    if (errorResult.hasPiiAccessDenied) {
        // eslint-disable-next-line no-console
        console.info(`[PII Access] GraphQL PII access denied for ${shop} (${topic})`, {
            shop,
            topic,
            deniedFields: errorResult.deniedPiiFields,
            timestamp: new Date().toISOString(),
        });
    }

    // Log other errors as warnings/errors
    if (errorResult.otherErrors.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(`[GraphQL] Non-PII errors for ${shop} (${topic})`, {
            shop,
            topic,
            errors: errorResult.otherErrors.map((e) => ({
                message: e.message,
                code: e.extensions?.code,
                path: e.path,
            })),
            timestamp: new Date().toISOString(),
        });
    }
}

/**
 * Helper to safely extract data from GraphQL response with error handling
 * 
 * @param response - GraphQL response object
 * @param shop - Shop domain for logging
 * @param topic - Webhook topic for logging
 * @returns Object with data and error result
 */
export function handleGraphQLResponse<T>(
    response: ShopifyGraphQLResponse<T>,
    shop: string,
    topic: string
): { data: T | undefined; errorResult: GraphQLErrorResult } {
    const errorResult = processGraphQLErrors(response.errors);

    // Log any errors
    logGraphQLErrors(shop, topic, errorResult);

    return {
        data: response.data,
        errorResult,
    };
}
