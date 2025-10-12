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
const DATA_BASE_URL = 'http://localhost:8081/v1/data';

export function testGetLogsFirst(check) {
    const res = http.get(`${DATA_BASE_URL}/logs?limit=10`, { headers: getHeaders() });
    check(res, {
        '[Logs] status 200 (first req)': (r) => r.status === 200,
        '[Logs] data array (first req)': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.data);
        },
        '[Logs] next_cursor defined (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.next_cursor !== undefined; // can be null or string
        }
    });
}

export function testGetLogsSecond(check) {
    const res = http.get(`${DATA_BASE_URL}/logs?limit=10`, { headers: getHeaders() });
    check(res, {
        '[Logs] status 200 (second req)': (r) => r.status === 200
    });
}

export default function (check) {
    // If check is not provided (when running this file directly),
    // use the original k6check as a fallback.
    check = check || k6check;

    testGetLogsFirst(check);
    testGetLogsSecond(check);

    sleep(0.1);
}
