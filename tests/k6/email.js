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

export function testValidEmailFirst(check) {
    const payload = JSON.stringify({ email: 'test@gmail.com' });
    let res = http.post(`${BASE_URL}/validate/email`, payload, { headers: getHeaders('POST', '/v1/validate/email', payload) });
    const body = res.status === 200 ? res.json() : null;
    check(res, {
        '[Valid Email] status 200 (first req)': (r) => r.status === 200,
        '[Valid Email] valid is true (first req)': (r) => body && body.valid === true,
        '[Valid Email] disposable is false (first req)': (r) => body && body.disposable === false,
    });
}

export function testValidEmailSecond(check) {
    const payload = JSON.stringify({ email: 'test@gmail.com' });
    // Second request for the same email. THIS MUST be a HIT.
    const res = http.post(`${BASE_URL}/validate/email`, payload, { headers: getHeaders('POST', '/v1/validate/email', payload) });
    check(res, {
        '[Valid Email] status 200 HIT': (r) => r.status === 200,
        // MODIFIED: Check the real Cache-Status header for "hit"
        '[Valid Email] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit'),
    });
}

export function testInvalidFormatFirst(check) {
    const payload = JSON.stringify({ email: 'invalid-email' });
    let res = http.post(`${BASE_URL}/validate/email`, payload, { headers: getHeaders('POST', '/v1/validate/email', payload) });
    const body = res.status === 200 ? res.json() : null;
    check(res, {
        '[Invalid Format] status 200 (first req)': (r) => r.status === 200,
        '[Invalid Format] valid is false (first req)': (r) => body && body.valid === false,
        '[Invalid Format] reason email.invalid_format (first req)': (r) => body && body.reason_codes && body.reason_codes.includes('email.invalid_format'),
    });
}

export function testInvalidFormatSecond(check) {
    const payload = JSON.stringify({ email: 'invalid-email' });
    // Second request, check for HIT.
    const res = http.post(`${BASE_URL}/validate/email`, payload, { headers: getHeaders('POST', '/v1/validate/email', payload) });
    check(res, {
        // MODIFIED: Check the ral Cache-Status header for "hit"
        '[Invalid Format] status 200 HIT': (r) => r.status === 200,
        '[Invalid Format] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit'),
    });
}

export function testDisposableFirst(check) {
    const payload = JSON.stringify({ email: 'user@10minutemail.com' });
    let res = http.post(`${BASE_URL}/validate/email`, payload, { headers: getHeaders('POST', '/v1/validate/email', payload) });
    const body = res.status === 200 ? res.json() : null;
    check(res, {
        '[Disposable] status 200 (first req)': (r) => r.status === 200,
        '[Disposable] valid is false (first req)': (r) => body && body.valid === false,
        '[Disposable] disposable is true (first req)': (r) => body && body.disposable === true,
        '[Disposable] reason email.disposable_domain (first req)': (r) => body && body.reason_codes && body.reason_codes.includes('email.disposable_domain'),
    });
}

export function testDisposableSecond(check) {
    const payload = JSON.stringify({ email: 'user@10minutemail.com' });
    // Second request, check for HIT.
    const res = http.post(`${BASE_URL}/validate/email`, payload, { headers: getHeaders('POST', '/v1/validate/email', payload) });
    check(res, {
        '[Disposable] status 200 HIT': (r) => r.status === 200,
        // MODIFIED: Check the real Cache-Status header for "hit"
        '[Disposable] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit'),
    });
}

export default function (check) {
    // 3. If check is not provided (when running this file directly),
    //    use the original k6check as a fallback.
    check = check || k6check;
    sleep(5);
    // --- Test Case 1: Valid Email (first request - MISS) ---
    // Should be valid, not disposable, with MX records found.
    testValidEmailFirst(check);
    testValidEmailSecond(check);

    // Scenario 2: Test invalid email format
    testInvalidFormatFirst(check);
    testInvalidFormatSecond(check);

    // Scenario 3: Test disposable email
    testDisposableFirst(check);
    testDisposableSecond(check);

    sleep(0.1);
}