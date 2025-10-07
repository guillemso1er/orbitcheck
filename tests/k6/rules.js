import {  check as k6check, sleep } from 'k6';
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

export default function (check) {
    // 3. If check is not provided (when running this file directly),
    //    use the original k6check as a fallback.
    check = check || k6check;
    // Scenario 1: Test GET rules
    let res = http.get(`${BASE_URL}/rules`, { headers: HEADERS });
    check(res, {
        '[Rules] status 200 (first req)': (r) => r.status === 200,
        '[Rules] rules array (first req)': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.rules);
        },
        '[Rules] rules length > 0 (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.rules && body.rules.length > 0;
        },
        '[Rules] request_id present (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.request_id && typeof body.request_id === 'string';
        }
    });

    // Second request for cache HIT.
    res = http.get(`${BASE_URL}/rules`, { headers: HEADERS });
    console.log('Headers for second request:', JSON.stringify(res.headers));
    check(res, {
        '[Rules] status 200 HIT': (r) => r.status === 200,
        '[Rules] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit'),
    });

    // Scenario 2: Test GET rules/catalog
    res = http.get(`${BASE_URL}/rules/catalog`, { headers: HEADERS });
    check(res, {
        '[Rules Catalog] status 200': (r) => r.status === 200,
        '[Rules Catalog] reason_codes array': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.reason_codes);
        },
        '[Rules Catalog] request_id present': (r) => {
            const body = JSON.parse(r.body);
            return body.request_id && typeof body.request_id === 'string';
        }
    });

    // Scenario 3: Test POST rules/register
    const registerPayload = JSON.stringify({
        rules: [{
            id: 'test_rule',
            name: 'Test Rule',
            description: 'A test rule',
            reason_code: 'test.reason',
            severity: 'medium',
            enabled: true
        }]
    });
    res = http.post(`${BASE_URL}/rules/register`, registerPayload, { headers: HEADERS });
    if (res.status !== 200) {
        console.log(`Rules register failed: status ${res.status}, body: ${res.body}`);
    }
    check(res, {
        '[Register Rules] status 200': (r) => r.status === 200,
        '[Register Rules] has message': (r) => {
            const body = JSON.parse(r.body);
            return body.message && body.registered_rules;
        }
    });

    sleep(0.1);
}