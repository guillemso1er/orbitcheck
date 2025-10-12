import { check as k6check, sleep } from 'k6';
import http from 'k6/http';
import { getHeaders } from './auth-utils.js';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        'checks': ['rate>0.90'],
        'http_req_duration': ['p(95)<2000', 'p(50)<1000']
    }
};

const BASE_URL = 'http://localhost:8080';

export function testGetSettings(headers, check) {
    const res = http.get(`${BASE_URL}/v1/settings`, { headers });
    check(res, {
        '[Get Settings] status 200': (r) => r.status === 200,
        '[Get Settings] has settings': (r) => {
            const body = JSON.parse(r.body);
            return body.country_defaults !== undefined && body.formatting !== undefined && body.risk_thresholds !== undefined;
        }
    });
}

export function testUpdateSettings(headers, check) {
    const updateSettingsPayload = JSON.stringify({
        country_defaults: { default_country: 'US' },
        formatting: { date_format: 'MM/DD/YYYY' },
        risk_thresholds: { max_score: 0.8 }
    });
    const res = http.put(`${BASE_URL}/v1/settings`, updateSettingsPayload, { headers });
    check(res, {
        '[Update Settings] status 200': (r) => r.status === 200,
        '[Update Settings] success message': (r) => {
            const body = JSON.parse(r.body);
            return body.message && body.message.includes('updated');
        }
    });
}

export default function (check) {
    check = check || k6check;

    testGetSettings(check);
    testUpdateSettings(check);

    sleep(0.1);
}