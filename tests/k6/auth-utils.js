import crypto from 'k6/crypto';

const KEY = (__ENV.KEY || '').trim();

// Function to generate Bearer authorization header
export function generateBearerHeader() {
    return `Bearer ${KEY}`;
}

// Default headers function
export function getHeaders(method, path, body = '') {
    return {
        'Content-Type': 'application/json',
        'Authorization': generateBearerHeader(),
        'Idempotency-Key': crypto.randomBytes(16).toString('hex') // Optional but good practice
    };
}