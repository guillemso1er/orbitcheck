import { check, sleep } from 'k6';
import http from 'k6/http';

export const options = {
  vus: 50,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(50)<50']
  }
};

const KEY = __ENV.KEY;
const BASE_URL = 'http://localhost:8081';
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${KEY}`
};

// Helper function to safely parse JSON and avoid test crashes
function safeParse(body) {
    try {
        return JSON.parse(body);
    } catch (e) {
        return null;
    }
}

export default function () {
    // --- Test Case 1: Valid Email (first request - MISS) ---
    // Should be valid, not disposable, with MX records found.
    const validPayload = JSON.stringify({ email: 'test@example.com' });
    let res1 = http.post(`${BASE_URL}/v1/validate/email`, validPayload, { headers: HEADERS });
    check(res1, {
        '[Valid Email MISS] - Status is 200': (r) => r.status === 200,
        '[Valid Email MISS] - Body is valid JSON': (r) => safeParse(r.body) !== null,
        '[Valid Email MISS] - "valid" is true': (r) => {
            const body = safeParse(r.body);
            return body && body.valid === true;
        },
        '[Valid Email MISS] - "disposable" is false': (r) => {
            const body = safeParse(r.body);
            return body && body.disposable === false;
        },
        '[Valid Email MISS] - "mx_found" is true': (r) => {
            const body = safeParse(r.body);
            return body && body.mx_found === true;
        },
        '[Valid Email MISS] - Cache MISS': (r) => r.headers['X-Cache-Status'] === 'MISS',
        '[Valid Email MISS] - No errors': (r) => !r.body.includes('error')
    });

    // Cache hit on second request
    res1 = http.post(`${BASE_URL}/v1/validate/email`, validPayload, { headers: HEADERS });
    check(res1, {
        '[Valid Email HIT] - Status is 200': (r) => r.status === 200,
        '[Valid Email HIT] - Cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
        '[Valid Email HIT] - "valid" is true (cached)': (r) => {
            const body = safeParse(r.body);
            return body && body.valid === true;
        }
    });

    // --- Test Case 2: Invalid Email Format (MISS then HIT) ---
    const invalidPayload = JSON.stringify({ email: 'invalid-email' });
    let res2 = http.post(`${BASE_URL}/v1/validate/email`, invalidPayload, { headers: HEADERS });
    check(res2, {
        '[Invalid Format MISS] - Status is 200': (r) => r.status === 200,
        '[Invalid Format MISS] - "valid" is false': (r) => {
            const body = safeParse(r.body);
            return body && body.valid === false;
        },
        '[Invalid Format MISS] - Reason "email.invalid_format"': (r) => {
            const body = safeParse(r.body);
            return body && body.reason_codes && body.reason_codes.includes('email.invalid_format');
        },
        '[Invalid Format MISS] - Cache MISS': (r) => r.headers['X-Cache-Status'] === 'MISS'
    });

    res2 = http.post(`${BASE_URL}/v1/validate/email`, invalidPayload, { headers: HEADERS });
    check(res2, {
        '[Invalid Format HIT] - Cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
        '[Invalid Format HIT] - "valid" is false (cached)': (r) => {
            const body = safeParse(r.body);
            return body && body.valid === false;
        }
    });

    // --- Test Case 3: Disposable Domain (MISS then HIT) ---
    const disposablePayload = JSON.stringify({ email: 'user@10minutemail.com' });
    let res3 = http.post(`${BASE_URL}/v1/validate/email`, disposablePayload, { headers: HEADERS });
    check(res3, {
        '[Disposable MISS] - Status is 200': (r) => r.status === 200,
        '[Disposable MISS] - "valid" is false': (r) => {
            const body = safeParse(r.body);
            return body && body.valid === false;
        },
        '[Disposable MISS] - "disposable" is true': (r) => {
            const body = safeParse(r.body);
            return body && body.disposable === true;
        },
        '[Disposable MISS] - Reason "email.disposable_domain"': (r) => {
            const body = safeParse(r.body);
            return body && body.reason_codes && body.reason_codes.includes('email.disposable_domain');
        },
        '[Disposable MISS] - Cache MISS': (r) => r.headers['X-Cache-Status'] === 'MISS'
    });

    res3 = http.post(`${BASE_URL}/v1/validate/email`, disposablePayload, { headers: HEADERS });
    check(res3, {
        '[Disposable HIT] - Cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
        '[Disposable HIT] - "valid" is false (cached)': (r) => {
            const body = safeParse(r.body);
            return body && body.valid === false;
        }
    });

    sleep(0.1);
}