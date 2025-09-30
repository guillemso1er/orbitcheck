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
    // Scenario 1: Test GET logs
    let res = http.get(`${BASE_URL}/logs`, { headers: HEADERS });
    check(res, {
        '[Logs] status 200 (first req)': (r) => r.status === 200,
        '[Logs] data array (first req)': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.data);
        },
        '[Logs] next_cursor present (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.next_cursor !== undefined;
        }
    });

    // Second request for cache HIT.
    res = http.get(`${BASE_URL}/logs`, { headers: HEADERS });
    check(res, {
        '[Logs] status 200 HIT': (r) => r.status === 200,
        '[Logs] cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
    });

    sleep(0.1);
}