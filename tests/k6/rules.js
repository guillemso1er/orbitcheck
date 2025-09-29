import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = { vus: 5, duration: '30s' };

const KEY = __ENV.KEY;
const BASE_URL = 'http://localhost:8081';
const HEADERS = {
    'Authorization': `Bearer ${KEY}`
};

export default function () {
    const res = http.get(`${BASE_URL}/rules`, { headers: HEADERS });
    check(res, {
        'status 200': (r) => r.status === 200,
        'rules array': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.rules);
        },
        'rules length > 0': (r) => {
            const body = JSON.parse(r.body);
            return body.rules && body.rules.length > 0;
        },
        'request_id present': (r) => {
            const body = JSON.parse(r.body);
            return body.request_id && typeof body.request_id === 'string';
        }
    });

    sleep(0.1);
}