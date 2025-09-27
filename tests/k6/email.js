import { check, sleep } from 'k6';
import http from 'k6/http';

export const options = { vus: 10, duration: '30s' };

const KEY = __ENV.KEY;
const BASE_URL = 'http://localhost:8080';
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
    // --- Test Case 1: Valid Email ---
    // Should be valid, not disposable, with MX records found.
    const validPayload = JSON.stringify({ email: 'test@example.com' });
    let res1 = http.post(`${BASE_URL}/validate/email`, validPayload, { headers: HEADERS });
    check(res1, {
        '[Valid Email]   - Status is 200': (r) => r.status === 200,
        '[Valid Email]   - Body is valid JSON': (r) => safeParse(r.body) !== null,
        '[Valid Email]   - "valid" is true': (r) => {
            const body = safeParse(r.body);
            return body && body.valid === true;
        },
        '[Valid Email]   - "disposable" is false': (r) => {
            const body = safeParse(r.body);
            return body && body.disposable === false;
        },
        '[Valid Email]   - "mx_found" is true': (r) => {
            const body = safeParse(r.body);
            return body && body.mx_found === true;
        }
    });

    // --- Test Case 2: Invalid Email Format ---
    // CHANGED: We now expect a 200 OK because our handler processes the request.
    // The server should report the email as invalid due to its format.
    const invalidPayload = JSON.stringify({ email: 'invalid-email' });
    let res2 = http.post(`${BASE_URL}/validate/email`, invalidPayload, { headers: HEADERS });
    check(res2, {
        '[Invalid Format] - Status is 200': (r) => r.status === 200,
        '[Invalid Format] - Body is valid JSON': (r) => safeParse(r.body) !== null,
        '[Invalid Format] - "valid" is false': (r) => {
            const body = safeParse(r.body);
            return body && body.valid === false;
        },
        '[Invalid Format] - Reason is "email.invalid_format"': (r) => {
            const body = safeParse(r.body);
            return body && body.reason_codes && body.reason_codes.includes('email.invalid_format');
        }
    });

    // --- Test Case 3: Disposable Domain ---
    // The server should correctly identify this as a disposable domain.
    const disposablePayload = JSON.stringify({ email: 'user@10minutemail.com' });
    let res3 = http.post(`${BASE_URL}/validate/email`, disposablePayload, { headers: HEADERS });
    check(res3, {
        '[Disposable]     - Status is 200': (r) => r.status === 200,
        '[Disposable]     - Body is valid JSON': (r) => safeParse(r.body) !== null,
        '[Disposable]     - "valid" is false': (r) => {
            const body = safeParse(r.body);
            return body && body.valid === false;
        },
        '[Disposable]     - "disposable" is true': (r) => {
            const body = safeParse(r.body);
            return body && body.disposable === true;
        },
        '[Disposable]     - Reason is "email.disposable_domain"': (r) => {
            const body = safeParse(r.body);
            return body && body.reason_codes && body.reason_codes.includes('email.disposable_domain');
        }
    });

    sleep(0.1);
}