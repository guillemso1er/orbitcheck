import http from 'k6/http';
import { check, sleep } from 'k6';

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
    // Test valid address (MISS then HIT)
    const validPayload = JSON.stringify({
        address: {
            line1: "1600 Amphitheatre Pkwy",
            city: "Mountain View",
            postal_code: "94043",
            state: "CA",
            country: "US"
        }
    });
    let res = http.post(`${BASE_URL}/validate/address`, validPayload, { headers: HEADERS });
    check(res, {
        'status 200 MISS': (r) => r.status === 200,
        'valid true MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === true;
        },
        'po_box false MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.po_box === false;
        },
        'postal_city_match true MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.postal_city_match === true;
        },
        'cache MISS': (r) => r.headers['X-Cache-Status'] === 'MISS',
        'no errors MISS': (r) => !r.body.includes('error')
    });

    // Cache hit
    res = http.post(`${BASE_URL}/validate/address`, validPayload, { headers: HEADERS });
    check(res, {
        'status 200 HIT': (r) => r.status === 200,
        'cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
        'valid true HIT': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === true;
        }
    });

    // Test PO Box address (MISS then HIT)
    const poBoxPayload = JSON.stringify({
        address: {
            line1: "P.O. Box 123",
            city: "Mountain View",
            postal_code: "94043",
            state: "CA",
            country: "US"
        }
    });
    res = http.post(`${BASE_URL}/validate/address`, poBoxPayload, { headers: HEADERS });
    check(res, {
        'status 200 MISS': (r) => r.status === 200,
        'valid false MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === false;
        },
        'po_box true MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.po_box === true;
        },
        'reason po_box MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('address.po_box');
        },
        'cache MISS': (r) => r.headers['X-Cache-Status'] === 'MISS'
    });

    res = http.post(`${BASE_URL}/validate/address`, poBoxPayload, { headers: HEADERS });
    check(res, {
        'status 200 HIT': (r) => r.status === 200,
        'cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
        'valid false HIT': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === false;
        }
    });

    // Test postal_city mismatch (MISS then HIT)
    const mismatchPayload = JSON.stringify({
        address: {
            line1: "1600 Amphitheatre Pkwy",
            city: "InvalidCity",
            postal_code: "94043",
            state: "CA",
            country: "US"
        }
    });
    res = http.post(`${BASE_URL}/validate/address`, mismatchPayload, { headers: HEADERS });
    check(res, {
        'status 200 MISS': (r) => r.status === 200,
        'valid false MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === false;
        },
        'postal_city_match false MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.postal_city_match === false;
        },
        'reason postal_city_mismatch MISS': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('address.postal_city_mismatch');
        },
        'cache MISS': (r) => r.headers['X-Cache-Status'] === 'MISS'
    });

    res = http.post(`${BASE_URL}/validate/address`, mismatchPayload, { headers: HEADERS });
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