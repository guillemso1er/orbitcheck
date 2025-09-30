import { check, sleep } from 'k6';
import http from 'k6/http';

export const options = {
    vus: 50,
    duration: '1m',
    thresholds: {
        'checks': ['rate>0.99'],
        http_req_duration: ['p(95)<200', 'p(50)<50']
    }
};

const KEY = (__ENV.KEY || '').trim();
const BASE_URL = 'http://localhost:8081/v1';
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${KEY}`
};


export default function () {
    // --- Test Case 1: Valid Email (first request - MISS) ---
    // Should be valid, not disposable, with MX records found.
    const validPayload = JSON.stringify({ email: 'test@example.com' });
    let res1 = http.post(`${BASE_URL}/validate/email`, validPayload, { headers: HEADERS });
    check(res1, {
        '[Valid Email] status 200 (first req)': (r) => r.status === 200,
        '[Valid Email] valid is true (first req)': (r) => JSON.parse(r.body).valid === true,
        '[Valid Email] disposable is false (first req)': (r) => JSON.parse(r.body).disposable === false,
        '[Valid Email] mx_found is true (first req)': (r) => JSON.parse(r.body).mx_found === true,
    });

    // Second request for the same email. THIS MUST be a HIT.
    res1 = http.post(`${BASE_URL}/validate/email`, validPayload, { headers: HEADERS });
    check(res1, {
        '[Valid Email] status 200 HIT': (r) => r.status === 200,
        '[Valid Email] cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
    });

    // Scenario 2: Test invalid email format
    const invalidPayload = JSON.stringify({ email: 'invalid-email' });
    let res2 = http.post(`${BASE_URL}/validate/email`, invalidPayload, { headers: HEADERS });
    check(res2, {
        '[Invalid Format] status 200 (first req)': (r) => r.status === 200,
        '[Invalid Format] valid is false (first req)': (r) => JSON.parse(r.body).valid === false,
        '[Invalid Format] reason email.invalid_format (first req)': (r) => JSON.parse(r.body).reason_codes.includes('email.invalid_format'),
    });

    // Second request, check for HIT.
    res2 = http.post(`${BASE_URL}/validate/email`, invalidPayload, { headers: HEADERS });
    check(res2, {
        '[Invalid Format] status 200 HIT': (r) => r.status === 200,
        '[Invalid Format] cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
    });

    // Scenario 3: Test disposable email
    const disposablePayload = JSON.stringify({ email: 'user@10minutemail.com' });
    let res3 = http.post(`${BASE_URL}/validate/email`, disposablePayload, { headers: HEADERS });
    check(res3, {
        '[Disposable] status 200 (first req)': (r) => r.status === 200,
        '[Disposable] valid is false (first req)': (r) => JSON.parse(r.body).valid === false,
        '[Disposable] disposable is true (first req)': (r) => JSON.parse(r.body).disposable === true,
        '[Disposable] reason email.disposable_domain (first req)': (r) => JSON.parse(r.body).reason_codes.includes('email.disposable_domain'),
    });

    // Second request, check for HIT.
    res3 = http.post(`${BASE_URL}/validate/email`, disposablePayload, { headers: HEADERS });
    check(res3, {
        '[Disposable] status 200 HIT': (r) => r.status === 200,
        '[Disposable] cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
    });

    sleep(0.1);
}