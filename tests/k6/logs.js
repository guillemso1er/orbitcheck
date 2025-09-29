import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = { vus: 5, duration: '30s' };

const KEY = __ENV.KEY;
const BASE_URL = 'http://localhost:8081';
const HEADERS = {
    'Authorization': `Bearer ${KEY}`
};

export default function () {
    // Test GET logs
    const res = http.get(`${BASE_URL}/logs`, { headers: HEADERS });
    check(res, {
        'status 200': (r) => r.status === 200,
        'data array': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.data);
        },
        'next_cursor present': (r) => {
            const body = JSON.parse(r.body);
            return body.next_cursor !== undefined;
        }
    });

    sleep(0.1);
}