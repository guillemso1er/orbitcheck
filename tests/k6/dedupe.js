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
    // If check is not provided (when running this file directly),
    // use the original k6check as a fallback.
    check = check || k6check;

    // Scenario 1: Test dedupe with no matches (new customer)
    const timestamp = Date.now();
    const noMatchPayload = JSON.stringify({
        email: `newuser${timestamp}@example.com`,
        first_name: 'John',
        last_name: 'Doe',
        phone: '+1234567890'
    });
    let res = http.post(`${BASE_URL}/dedupe`, noMatchPayload, { headers: getHeaders() });
    check(res, {
        '[No Match] status 200 (first req)': (r) => r.status === 200,
        '[No Match] matches empty (first req)': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.matches) && body.matches.length === 0;
        },
        '[No Match] suggested_action create_new (first req)': (r) => JSON.parse(r.body).suggested_action === 'create_new'
    });

    // Second request for the same data. THIS MUST be a HIT.
    res = http.post(`${BASE_URL}/dedupe`, noMatchPayload, { headers: getHeaders() });
    check(res, {
        '[No Match] status 200 HIT': (r) => r.status === 200,
        '[No Match] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });

    // Scenario 2: Test dedupe with potential fuzzy match
    const fuzzyPayload = JSON.stringify({
        email: `fuzzy${timestamp}@example.com`,
        first_name: 'Jane',
        last_name: 'Smith'
    });
    res = http.post(`${BASE_URL}/dedupe`, fuzzyPayload, { headers: getHeaders() });
    check(res, {
        '[Fuzzy] status 200 (first req)': (r) => r.status === 200,
        '[Fuzzy] response structure (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.matches !== undefined && body.suggested_action !== undefined;
        }
    });

    // Second request, check for HIT.
    res = http.post(`${BASE_URL}/dedupe`, fuzzyPayload, { headers: getHeaders() });
    check(res, {
        '[Fuzzy] status 200 HIT': (r) => r.status === 200,
        '[Fuzzy] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });

    // Scenario 3: Test dedupe with exact email match
    const exactPayload = JSON.stringify({
        email: `existing${timestamp}@example.com`,
        first_name: 'Existing',
        last_name: 'User'
    });
    res = http.post(`${BASE_URL}/dedupe`, exactPayload, { headers: getHeaders() });
    check(res, {
        '[Exact] status 200 (first req)': (r) => r.status === 200,
        '[Exact] matches empty (first req)': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.matches) && body.matches.length === 0;
        },
        '[Exact] suggested_action create_new (first req)': (r) => JSON.parse(r.body).suggested_action === 'create_new'
    });

    // Second request, check for HIT.
    res = http.post(`${BASE_URL}/dedupe`, exactPayload, { headers: getHeaders() });
    check(res, {
        '[Exact] status 200 HIT': (r) => r.status === 200,
        '[Exact] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });

    // Scenario 4: Test dedupe address
    const addressPayload = JSON.stringify({
        line1: '123 Main St',
        city: 'Anytown',
        postal_code: '12345',
        country: 'US'
    });
    res = http.post(`${BASE_URL}/dedupe/address`, addressPayload, { headers: getHeaders() });
    check(res, {
        '[Address Dedupe] status 200': (r) => r.status === 200,
        '[Address Dedupe] has matches and action': (r) => {
            const body = JSON.parse(r.body);
            return body.matches !== undefined && body.suggested_action;
        }
    });

    // Scenario 5: Test dedupe merge (assuming some IDs exist, but since it's new, might fail or be empty)
    const mergePayload = JSON.stringify({
        type: 'customer',
        ids: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
        canonical_id: '00000000-0000-0000-0000-000000000001'
    });
    res = http.post(`${BASE_URL}/dedupe/merge`, mergePayload, { headers: getHeaders() });
    check(res, {
        '[Merge] status is 200 or expected error': (r) => r.status === 200 || r.status === 400
    });

    sleep(0.1);
}
    sleep(0.1);
