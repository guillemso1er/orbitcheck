import type { FastifyReply, FastifyRequest } from 'fastify';

import { InputSanitizer } from '../utils/sanitization.js';

/**
 * Fastify hook to sanitize all incoming request data
 */
export async function inputSanitizationHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    // Check content-type for POST requests to validation endpoints
    if (request.method === 'POST' && request.url.includes('/v1/validate/')) {
        const contentType = request.headers['content-type'];
        if (!contentType || !contentType.includes('application/json')) {
            const error = new Error('Unsupported Media Type') as any;
            error.statusCode = 415;
            error.code = 'FST_ERR_CTP_INVALID_MEDIA_TYPE';
            throw error;
        }
    }

    // Sanitize query parameters
    if (request.query) {
        request.query = InputSanitizer.sanitizeObject(request.query);
    }

    // Sanitize route parameters
    if (request.params) {
        request.params = InputSanitizer.sanitizeObject(request.params);
    }

    // Sanitize body
    if (request.body) {
        request.body = sanitizeRequestBody(request.body);
    }

    // Sanitize headers (selective - only user-controlled headers)
    const headersToSanitize = ['x-custom-header', 'x-request-id', 'correlation-id'];
    headersToSanitize.forEach(header => {
        if (request.headers[header]) {
            request.headers[header] = InputSanitizer.sanitizeText(request.headers[header] as string);
        }
    });
}

/**
 * Recursively sanitizes request body based on expected field types
 */
function sanitizeRequestBody(body: any): any {
    if (!body || typeof body !== 'object') {
        return body;
    }

    if (isAuthRequest(body)) {
        return sanitizeAuthRequest(body);
    }
    // Handle different validation endpoints that have known schemas
    if (isValidationRequest(body)) {
        return sanitizeValidationRequest(body);
    }

    if (isOrderRequest(body)) {
        return sanitizeOrderRequest(body);
    }

    if (isWebhookRequest(body)) {
        return sanitizeWebhookRequest(body);
    }

    // Default sanitization for unknown structures
    return InputSanitizer.sanitizeObject(body);
}

/**
 * Detects if this is a validation request
 */
function isValidationRequest(body: any): boolean {
    return body && (
        typeof body.email === 'string' ||
        typeof body.phone === 'string' ||
        typeof body.name === 'string' ||
        (body.address && typeof body.address === 'object') ||
        (typeof body.type === 'string' && typeof body.value === 'string')
    );
}

/**
 * Sanitizes validation request body
 */
function sanitizeValidationRequest(body: any): any {
    const sanitized: any = {};

    if (body.email) {
        sanitized.email = InputSanitizer.sanitizeEmail(body.email);
    }

    if (body.phone) {
        sanitized.phone = InputSanitizer.sanitizePhone(body.phone);
        sanitized.country = body.country ? InputSanitizer.sanitizeString(body.country) : undefined;
        sanitized.request_otp = typeof body.request_otp === 'boolean' ? body.request_otp : false;
    }

    if (body.name) {
        sanitized.name = InputSanitizer.sanitizeName(body.name);
    }

    if (body.address) {
        sanitized.address = {
            line1: body.address.line1 ? InputSanitizer.sanitizeAddress(body.address.line1) : '',
            line2: body.address.line2 ? InputSanitizer.sanitizeAddress(body.address.line2) : '',
            city: body.address.city ? InputSanitizer.sanitizeName(body.address.city) : '',
            state: body.address.state ? InputSanitizer.sanitizeName(body.address.state) : '',
            postal_code: body.address.postal_code ? InputSanitizer.sanitizePostalCode(body.address.postal_code) : '',
            country: body.address.country ? InputSanitizer.sanitizeString(body.address.country) : ''
        };
    }

    if (body.type) {
        sanitized.type = InputSanitizer.sanitizeString(body.type);
    }

    if (body.value) {
        // For tax IDs, use specific sanitization
        if (body.type && ['cpf', 'cnpj', 'rfc', 'cuit', 'rut', 'ruc', 'nit', 'es', 'ein', 'vat'].includes(body.type.toLowerCase())) {
            sanitized.value = InputSanitizer.sanitizeTaxId(body.value);
        } else {
            sanitized.value = InputSanitizer.sanitizeString(body.value);
        }
    }

    return sanitized;
}

/**
 * Detects if this is an order evaluation request
 */
function isOrderRequest(body: any): boolean {
    return body && typeof body.order_id === 'string' && body.customer && body.shipping_address;
}

/**
 * Sanitizes order request body
 */
function sanitizeOrderRequest(body: any): any {
    return {
        order_id: InputSanitizer.sanitizeString(body.order_id),
        customer: {
            email: body.customer.email ? InputSanitizer.sanitizeEmail(body.customer.email) : '',
            phone: body.customer.phone ? InputSanitizer.sanitizePhone(body.customer.phone) : '',
            first_name: body.customer.first_name ? InputSanitizer.sanitizeName(body.customer.first_name) : '',
            last_name: body.customer.last_name ? InputSanitizer.sanitizeName(body.customer.last_name) : ''
        },
        shipping_address: {
            line1: InputSanitizer.sanitizeAddress(body.shipping_address.line1 || ''),
            line2: InputSanitizer.sanitizeAddress(body.shipping_address.line2 || ''),
            city: InputSanitizer.sanitizeName(body.shipping_address.city || ''),
            state: InputSanitizer.sanitizeName(body.shipping_address.state || ''),
            postal_code: InputSanitizer.sanitizePostalCode(body.shipping_address.postal_code || ''),
            country: InputSanitizer.sanitizeString(body.shipping_address.country || '')
        },
        total_amount: typeof body.total_amount === 'number' ? body.total_amount : 0,
        currency: body.currency ? InputSanitizer.sanitizeString(body.currency) : 'USD',
        payment_method: body.payment_method ? InputSanitizer.sanitizeString(body.payment_method) : 'card'
    };
}

/**
 * Detects if this is a webhook request
 */
function isWebhookRequest(body: any): boolean {
    return body && (
        (body.url && body.events) || // create webhook
        (body.url && body.payload_type) || // test webhook
        body.custom_payload // custom payload
    );
}

/**
 * Sanitizes webhook request body
 */
function sanitizeWebhookRequest(body: any): any {
    const sanitized: any = {};

    if (body.url) {
        sanitized.url = InputSanitizer.sanitizeUrl(body.url);
    }

    if (body.events && Array.isArray(body.events)) {
        sanitized.events = body.events.map((event: string) => InputSanitizer.sanitizeString(event));
    }

    if (body.payload_type) {
        sanitized.payload_type = InputSanitizer.sanitizeString(body.payload_type);
    }

    if (body.custom_payload) {
        sanitized.custom_payload = body.custom_payload; // Don't sanitize custom payload
    }

    if (body.name) {
        sanitized.name = InputSanitizer.sanitizeString(body.name);
    }

    if (body.verification_sid) {
        sanitized.verification_sid = InputSanitizer.sanitizeString(body.verification_sid);
    }

    if (body.code) {
        sanitized.code = InputSanitizer.sanitizeString(body.code);
    }

    return sanitized;
}

/**
 * Detects if this is an authentication request
 */
function isAuthRequest(body: any): boolean {
    return body && (
        (body.email !== undefined && body.password !== undefined) || // login/register
        body.name // API key name
    );
}

/**
 * Sanitizes authentication request body
 */
function sanitizeAuthRequest(body: any): any {
    const sanitized: any = {};

    if (body.email) {
        sanitized.email = InputSanitizer.sanitizeEmail(body.email);
    }

    if (body.password !== undefined) {
        // Passwords should NOT be sanitized as they may contain special characters
        // Just ensure it's a string and trim whitespace
        sanitized.password = InputSanitizer.sanitizePassword(body.password);
    }

    if (body.confirm_password !== undefined) {
        // Confirm password should be treated like password
        sanitized.confirm_password = InputSanitizer.sanitizePassword(body.confirm_password);
    }

    if (body.name) {
        sanitized.name = InputSanitizer.sanitizeString(body.name);
    }

    return sanitized;
}