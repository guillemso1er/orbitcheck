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

const BASE_URL = 'http://localhost:8080';

export function testGetUsage(headers, check) {
    const res = http.get(`${BASE_URL}/v1/data/usage`, { headers });
    check(res, {
        '[Get Usage] status 200': (r) => r.status === 200,
        '[Get Usage] has data': (r) => r.status === 200 && (() => { const body = JSON.parse(r.body); return body && typeof body === 'object'; })()
    });
}

export default function (check) {
    // If check is not provided (when running this file directly),
    // use the original k6check as a fallback.
    check = check || k6check;

    testGetUsage(check);

    sleep(0.1);
}
