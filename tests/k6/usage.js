import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = { vus: 5, duration: '30s' };

const KEY = __ENV.KEY;
const BASE_URL = 'http://localhost:8080';
const HEADERS = {
    'Authorization': `Bearer ${KEY}`
};

export default function () {
    const res = http.get(`${BASE_URL}/usage`, { headers: HEADERS });
    check(res, {
        'status 200': (r) => r.status === 200,
        'totals object': (r) => {
            const body = JSON.parse(r.body);
            return body.totals && typeof body.totals === 'object';
        },
        'by_day array': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.by_day);
        },
        'period month': (r) => {
            const body = JSON.parse(r.body);
            return body.period === 'month';
        }
    });

    sleep(0.1);
}