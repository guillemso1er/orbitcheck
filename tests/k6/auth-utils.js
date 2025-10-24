import crypto from 'k6/crypto';

const KEY = (__ENV.KEY || '').trim();
const PAT = (__ENV.PAT || '').trim();

// Function to generate Bearer authorization header for PAT (management API)
export function generateBearerPATHeader() {
    return PAT ? `Bearer ${PAT}` : `Bearer ${KEY}`;
}

// Function to generate Bearer authorization header for API key (runtime API)
export function generateBearerAPIKeyHeader() {
    return `Bearer ${KEY}`;
}

// Function to generate HMAC authorization header
export function generateHMACHeader(method, path, body = '') {
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(8).toString('hex');
    const keyId = KEY.slice(0, 8); // Use first 8 chars as keyId
    const message = method + path + body + timestamp + nonce;
    const signature = crypto.hmac('sha256', KEY, message, 'hex');
    return `HMAC keyId=${keyId} signature=${signature} ts=${timestamp} nonce=${nonce}`;
}

// Default headers function for PAT (management API)
export function getPATHeaders(method, path, body = '') {
    return {
        'Content-Type': 'application/json',
        'Authorization': generateBearerPATHeader(),
        'Idempotency-Key': crypto.randomBytes(16).toString('hex')
    };
}

// Default headers function for API key (runtime API)
export function getHeaders(method, path, body = '') {
    return {
        'Content-Type': 'application/json',
        'Authorization': generateBearerAPIKeyHeader(),
        'Idempotency-Key': crypto.randomBytes(16).toString('hex')
    };
}

// Default headers function for HMAC (runtime API)
export function getHMACHeaders(method, path, body = '') {
    return {
        'Content-Type': 'application/json',
        'Authorization': generateHMACHeader(method, path, body),
        'Idempotency-Key': crypto.randomBytes(16).toString('hex')
    };
}