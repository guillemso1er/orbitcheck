import { check as k6check, sleep } from 'k6';
import http from 'k6/http';
import { getHeaders } from './auth-utils.js';

export const options = {
    // Restore your desired load testing parameters
    vus: 50,
    duration: '1m',
    thresholds: {
        'checks': ['rate>0.99'], // We expect a >99% pass rate for our checks
        http_req_duration: ['p(95)<200', 'p(50)<50']
    }
};

const BASE_URL = 'http://localhost:8081/v1'; // This should point to your Nginx proxy

export function testAddressMismatchFirst(check) {
    const payload = JSON.stringify({
        address: {
            line1: "1600 Amphitheatre Pkwy",
            city: "Mountain View",
            postal_code: "90210",
            state: "CA",
            country: "US"
        }
    });

    // First request. We check its content. With the Nginx fix, this may be a MISS or HIT.
    let res = http.post(`${BASE_URL}/validate/address`, payload, { headers: getHeaders('POST', '/v1/validate/address', payload) });
    check(res, {
        '[Mismatch] status 200 (first req)': (r) => r.status === 200,
        '[Mismatch] valid is false (first req)': (r) => JSON.parse(r.body).valid === false,
    });
}

export function testAddressMismatchSecond(check) {
    const payload = JSON.stringify({
        address: {
            line1: "1600 Amphitheatre Pkwy",
            city: "Mountain View",
            postal_code: "90210",
            state: "CA",
            country: "US"
        }
    });

    // Second request for the same address. THIS MUST be a HIT.
    const res = http.post(`${BASE_URL}/validate/address`, payload, { headers: getHeaders('POST', '/v1/validate/address', payload) });
    check(res, {
        '[Mismatch] status 200 HIT': (r) => r.status === 200,
        '[Mismatch] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit'),
    });
}

export function testPoBoxFirst(check) {
    const payload = JSON.stringify({
        address: {
            line1: "P.O. Box 123",
            city: "Mountain View",
            postal_code: "94043",
            state: "CA",
            country: "US"
        }
    });

    // First request.
    let res = http.post(`${BASE_URL}/validate/address`, payload, { headers: getHeaders() });
    check(res, {
        '[PO Box] status 200 (first req)': (r) => r.status === 200,
        '[PO Box] po_box is false (first req)': (r) => JSON.parse(r.body).po_box === false,
    });
}

export function testPoBoxSecond(check) {
    const payload = JSON.stringify({
        address: {
            line1: "P.O. Box 123",
            city: "Mountain View",
            postal_code: "94043",
            state: "CA",
            country: "US"
        }
    });

    // Second request, check for HIT.
    const res = http.post(`${BASE_URL}/validate/address`, payload, { headers: getHeaders('POST', '/v1/validate/address', payload) });
    check(res, {
        '[PO Box] status 200 HIT': (r) => r.status === 200,
        '[PO Box] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit'),
    });
}

export function testInvalidCityFirst(check) {
    const payload = JSON.stringify({
        address: {
            line1: "1 Main St",
            city: "InvalidCity",
            postal_code: "90210",
            state: "CA",
            country: "US"
        }
    });

    // First request.
    let res = http.post(`${BASE_URL}/validate/address`, payload, { headers: getHeaders('POST', '/v1/validate/address', payload) });
    check(res, {
        '[Invalid City] status 200 (first req)': (r) => r.status === 200,
        '[Invalid City] valid is false (first req)': (r) => JSON.parse(r.body).valid === false,
    });
}

export function testInvalidCitySecond(check) {
    const payload = JSON.stringify({
        address: {
            line1: "1 Main St",
            city: "InvalidCity",
            postal_code: "90210",
            state: "CA",
            country: "US"
        }
    });

    // Second request, check for HIT.
    const res = http.post(`${BASE_URL}/validate/address`, payload, { headers: getHeaders('POST', '/v1/validate/address', payload) });
    check(res, {
        '[Invalid City] status 200 HIT': (r) => r.status === 200,
        '[Invalid City] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit'),
    });
}

export default function (check) {
    // 3. If check is not provided (when running this file directly),
    //    use the original k6check as a fallback.
    check = check || k6check;
    // Scenario 1: Test an address with a known postal/city mismatch
    testAddressMismatchFirst(check);
    testAddressMismatchSecond(check);

    // Scenario 2: Test a P.O. Box address
    testPoBoxFirst(check);
    testPoBoxSecond(check);

    // Scenario 3: Test an address with a deliberately invalid city
    testInvalidCityFirst(check);
    testInvalidCitySecond(check);

    sleep(0.1);
}