import { check as k6check, sleep } from 'k6';
import http from 'k6/http';
import { getHeaders } from './auth-utils.js';

export const options = {
    vus: 50,
    duration: '1m',
    thresholds: {
        'checks': ['rate>0.99'],
        http_req_duration: ['p(95)<200', 'p(50)<50']
    }
};

const BASE_URL = 'http://localhost:8081/v1';


export default function (check) {
    // 3. If check is not provided (when running this file directly),
    //    use the original k6check as a fallback.
    check = check || k6check;
    sleep(5);
    // --- Test Case 1: Valid Email (first request - MISS) ---
    // Should be valid, not disposable, with MX records found.
    const validPayload = JSON.stringify({ email: 'test@gmail.com' });
    let res1 = http.post(`${BASE_URL}/validate/email`, validPayload, { headers: getHeaders('POST', '/v1/validate/email', validPayload) });
    const body1 = res1.status === 200 ? res1.json() : null;
    check(res1, {
        '[Valid Email] status 200 (first req)': (r) => r.status === 200,
        '[Valid Email] valid is true (first req)': (r) => body1 && body1.valid === true,
        '[Valid Email] disposable is false (first req)': (r) => body1 && body1.disposable === false,
    });

    // Second request for the same email. THIS MUST be a HIT.
    res1 = http.post(`${BASE_URL}/validate/email`, validPayload, { headers: getHeaders('POST', '/v1/validate/email', validPayload) });
    check(res1, {
        '[Valid Email] status 200 HIT': (r) => r.status === 200,
        // MODIFIED: Check the real Cache-Status header for "hit"
        '[Valid Email] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit'),
    });

    // Scenario 2: Test invalid email format
    const invalidPayload = JSON.stringify({ email: 'invalid-email' });
    let res2 = http.post(`${BASE_URL}/validate/email`, invalidPayload, { headers: getHeaders('POST', '/v1/validate/email', invalidPayload) });
    const body2 = res2.status === 200 ? res2.json() : null;
    check(res2, {
        '[Invalid Format] status 200 (first req)': (r) => r.status === 200,
        '[Invalid Format] valid is false (first req)': (r) => body2 && body2.valid === false,
        '[Invalid Format] reason email.invalid_format (first req)': (r) => body2 && body2.reason_codes && body2.reason_codes.includes('email.invalid_format'),
    });

    // Second request, check for HIT.
    res2 = http.post(`${BASE_URL}/validate/email`, invalidPayload, { headers: getHeaders('POST', '/v1/validate/email', invalidPayload) });
    check(res2, {
        // MODIFIED: Check the ral Cache-Status header for "hit"
        '[Invalid Format] status 200 HIT': (r) => r.status === 200,
        '[Invalid Format] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit'),
    });

    // Scenario 3: Test disposable email
    const disposablePayload = JSON.stringify({ email: 'user@10minutemail.com' });
    let res3 = http.post(`${BASE_URL}/validate/email`, disposablePayload, { headers: getHeaders('POST', '/v1/validate/email', disposablePayload) });
    const body3 = res3.status === 200 ? res3.json() : null;
    check(res3, {
        '[Disposable] status 200 (first req)': (r) => r.status === 200,
        '[Disposable] valid is false (first req)': (r) => body3 && body3.valid === false,
        '[Disposable] disposable is true (first req)': (r) => body3 && body3.disposable === true,
        '[Disposable] reason email.disposable_domain (first req)': (r) => body3 && body3.reason_codes && body3.reason_codes.includes('email.disposable_domain'),
    });

    // Second request, check for HIT.
    res3 = http.post(`${BASE_URL}/validate/email`, disposablePayload, { headers: getHeaders('POST', '/v1/validate/email', disposablePayload) });
    check(res3, {
        '[Disposable] status 200 HIT': (r) => r.status === 200,
        // MODIFIED: Check the real Cache-Status header for "hit"
        '[Disposable] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit'),
    });

    sleep(0.1);
}