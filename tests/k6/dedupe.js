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
    // Scenario 1: Test dedupe with no matches (new customer)
    const noMatchPayload = JSON.stringify({
        email: 'newuser@example.com',
        first_name: 'John',
        last_name: 'Doe',
        phone: '+1234567890'
    });
    let res = http.post(`${BASE_URL}/dedupe/customer`, noMatchPayload, { headers: HEADERS });
    check(res, {
        '[No Match] status 200 (first req)': (r) => r.status === 200,
        '[No Match] matches empty (first req)': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.matches) && body.matches.length === 0;
        },
        '[No Match] suggested_action create_new (first req)': (r) => JSON.parse(r.body).suggested_action === 'create_new',
    });

    // Second request for the same data. THIS MUST be a HIT.
    res = http.post(`${BASE_URL}/dedupe/customer`, noMatchPayload, { headers: HEADERS });
    check(res, {
        '[No Match] status 200 HIT': (r) => r.status === 200,
        '[No Match] cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
    });

    // Scenario 2: Test dedupe with potential fuzzy match
    const fuzzyPayload = JSON.stringify({
        email: 'fuzzy@example.com',
        first_name: 'Jane',
        last_name: 'Smith'
    });
    res = http.post(`${BASE_URL}/dedupe/customer`, fuzzyPayload, { headers: HEADERS });
    check(res, {
        '[Fuzzy] status 200 (first req)': (r) => r.status === 200,
        '[Fuzzy] response structure (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.matches !== undefined && body.suggested_action !== undefined;
        }
    });

    // Second request, check for HIT.
    res = http.post(`${BASE_URL}/dedupe/customer`, fuzzyPayload, { headers: HEADERS });
    check(res, {
        '[Fuzzy] status 200 HIT': (r) => r.status === 200,
        '[Fuzzy] cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
    });

    // Scenario 3: Test dedupe with exact email match
    const exactPayload = JSON.stringify({
        email: 'existing@example.com',
        first_name: 'Existing',
        last_name: 'User'
    });
    res = http.post(`${BASE_URL}/dedupe/customer`, exactPayload, { headers: HEADERS });
    check(res, {
        '[Exact] status 200 (first req)': (r) => r.status === 200,
        '[Exact] matches empty (first req)': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.matches) && body.matches.length === 0;
        },
        '[Exact] suggested_action create_new (first req)': (r) => JSON.parse(r.body).suggested_action === 'create_new',
    });

    // Second request, check for HIT.
    res = http.post(`${BASE_URL}/dedupe/customer`, exactPayload, { headers: HEADERS });
    check(res, {
        '[Exact] status 200 HIT': (r) => r.status === 200,
        '[Exact] cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
    });

    sleep(0.1);
}