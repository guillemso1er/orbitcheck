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
    'Authorization': `Bearer ${KEY}`
};

export default function () {
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
    check(res, {
        '[Rules] status 200 HIT': (r) => r.status === 200,
        '[Rules] cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
    });

    sleep(0.1);
}