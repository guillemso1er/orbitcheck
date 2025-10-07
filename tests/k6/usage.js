import { sleep, check as k6check  } from 'k6';
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
const DATA_BASE_URL = 'http://localhost:8081/data';
const HEADERS = {
    'Authorization': `Bearer ${KEY}`
};

export default function (check) {
    // 3. If check is not provided (when running this file directly),
    //    use the original k6check as a fallback.
    check = check || k6check;
    // Scenario 1: Test GET usage
    let res = http.get(`${DATA_BASE_URL}/usage`, { headers: HEADERS });
    check(res, {
        '[Usage] status 200 (first req)': (r) => r.status === 200,
        '[Usage] totals object (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.totals && typeof body.totals === 'object';
        },
        '[Usage] by_day array (first req)': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.by_day);
        },
        '[Usage] period month (first req)': (r) => JSON.parse(r.body).period === 'month',
    });

    // Second request for cache HIT.
    res = http.get(`${DATA_BASE_URL}/usage`, { headers: HEADERS });
    check(res, {
        '[Usage] status 200 HIT': (r) => r.status === 200,
        '[Usage] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit'),
    });

    sleep(0.1);
}