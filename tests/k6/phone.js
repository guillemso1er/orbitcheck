import { check, sleep } from 'k6';
import http from 'k6/http';

export const options = {
  vus: 50,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(50)<50']
  }
};

const KEY = __ENV.KEY;
const BASE_URL = 'http://localhost:8081';
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${KEY}`
};

export default function () {
    // Test valid phone without country (MISS then HIT)
    const validPayload = JSON.stringify({ phone: '+16502530000' });
    let res = http.post(`${BASE_URL}/validate/phone`, validPayload, { headers: HEADERS });
    check(res, {
        'status 200 MISS': (r) => r.status === 200,
        'valid true MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === true;
        },
        'e164 present MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.e164 && body.e164.startsWith('+1');
        },
        'country US MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.country === 'US';
        },
        'cache MISS': (r) => r.headers['X-Cache-Status'] === 'MISS',
        'no errors MISS': (r) => !r.body.includes('error')
    });

    res = http.post(`${BASE_URL}/validate/phone`, validPayload, { headers: HEADERS });
    check(res, {
        'status 200 HIT': (r) => r.status === 200,
        'cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
        'valid true HIT': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === true;
        }
    });

    // Test valid phone with country hint (MISS then HIT)
    const validWithCountryPayload = JSON.stringify({ phone: '6502530000', country: 'US' });
    res = http.post(`${BASE_URL}/validate/phone`, validWithCountryPayload, { headers: HEADERS });
    check(res, {
        'status 200 MISS': (r) => r.status === 200,
        'valid true MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === true;
        },
        'e164 present MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.e164 === '+16502530000';
        },
        'cache MISS': (r) => r.headers['X-Cache-Status'] === 'MISS'
    });

    res = http.post(`${BASE_URL}/validate/phone`, validWithCountryPayload, { headers: HEADERS });
    check(res, {
        'status 200 HIT': (r) => r.status === 200,
        'cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
        'valid true HIT': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === true;
        }
    });

    // Test invalid phone format (MISS then HIT)
    const invalidPayload = JSON.stringify({ phone: 'invalid-phone' });
    res = http.post(`${BASE_URL}/validate/phone`, invalidPayload, { headers: HEADERS });
    check(res, {
        'status 200 MISS': (r) => r.status === 200,
        'valid false MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === false;
        },
        'reason unparseable MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('phone.unparseable');
        },
        'cache MISS': (r) => r.headers['X-Cache-Status'] === 'MISS'
    });

    res = http.post(`${BASE_URL}/validate/phone`, invalidPayload, { headers: HEADERS });
    check(res, {
        'status 200 HIT': (r) => r.status === 200,
        'cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
        'valid false HIT': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === false;
        }
    });

    // Test invalid with country hint (MISS then HIT)
    const invalidWithCountryPayload = JSON.stringify({ phone: '999999', country: 'US' });
    res = http.post(`${BASE_URL}/validate/phone`, invalidWithCountryPayload, { headers: HEADERS });
    check(res, {
        'status 200 MISS': (r) => r.status === 200,
        'valid false MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === false;
        },
        'reason invalid_format MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('phone.invalid_format');
        },
        'cache MISS': (r) => r.headers['X-Cache-Status'] === 'MISS'
    });

    res = http.post(`${BASE_URL}/validate/phone`, invalidWithCountryPayload, { headers: HEADERS });
    check(res, {
        'status 200 HIT': (r) => r.status === 200,
        'cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
        'valid false HIT': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === false;
        }
    });

    sleep(0.1);
}