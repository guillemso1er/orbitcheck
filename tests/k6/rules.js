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

const KEY = (__ENV.KEY || '').trim();
const BASE_URL = 'http://localhost:8081/v1';

export default function (check) {
    // If check is not provided (when running this file directly),
    // use the original k6check as a fallback.
    check = check || k6check;

    // Scenario 1: Test GET rules
    const res = http.get(`${BASE_URL}/rules`, { headers: getHeaders() });
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
    const res2 = http.get(`${BASE_URL}/rules`, { headers: getHeaders() });
    check(res2, {
        '[Rules] status 200 HIT': (r) => r.status === 200,
        '[Rules] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });

    // Scenario 2: Test GET rules/catalog
    const res3 = http.get(`${BASE_URL}/rules/catalog`, { headers: getHeaders() });
    check(res3, {
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
    const res4 = http.post(`${BASE_URL}/rules/register`, registerPayload, { headers: getHeaders() });
    check(res4, {
        '[Register Rules] status 200': (r) => r.status === 200,
        '[Register Rules] has message': (r) => {
            const body = JSON.parse(r.body);
            return body.message;
        }
    });

    sleep(0.1);
}
