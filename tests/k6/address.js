import { check, sleep } from 'k6';
import http from 'k6/http';

export const options = {
    // Restore your desired load testing parameters
    vus: 50,
    duration: '1m',
    thresholds: {
        'checks': ['rate>0.99'], // We expect a >99% pass rate for our checks
        http_req_duration: ['p(95)<200', 'p(50)<50']
    }
};

const KEY = (__ENV.KEY || '').trim();
const BASE_URL = 'http://localhost:8081/v1'; // This should point to your Nginx proxy
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${KEY}`
};

export default function () {
    // Scenario 1: Test an address with a known postal/city mismatch
    const addressWithMismatchPayload = JSON.stringify({
        address: {
            line1: "1600 Amphitheatre Pkwy",
            city: "Mountain View",
            postal_code: "94043",
            state: "CA",
            country: "US"
        }
    });

    // First request. We check its content. With the Nginx fix, this may be a MISS or HIT.
    let res = http.post(`${BASE_URL}/validate/address`, addressWithMismatchPayload, { headers: HEADERS });
    check(res, {
        '[Mismatch] status 200 (first req)': (r) => r.status === 200,
        '[Mismatch] valid is false (first req)': (r) => JSON.parse(r.body).valid === false,
    });

    // Second request for the same address. THIS MUST be a HIT.
    res = http.post(`${BASE_URL}/validate/address`, addressWithMismatchPayload, { headers: HEADERS });
    check(res, {
        '[Mismatch] status 200 HIT': (r) => r.status === 200,
        '[Mismatch] cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
    });


    // Scenario 2: Test a P.O. Box address
    const poBoxPayload = JSON.stringify({
        address: {
            line1: "P.O. Box 123",
            city: "Mountain View",
            postal_code: "94043",
            state: "CA",
            country: "US"
        }
    });

    // First request.
    res = http.post(`${BASE_URL}/validate/address`, poBoxPayload, { headers: HEADERS });
    check(res, {
        '[PO Box] status 200 (first req)': (r) => r.status === 200,
        // CORRECTION: The API should correctly identify this as a P.O. Box.
        '[PO Box] po_box is true (first req)': (r) => JSON.parse(r.body).po_box === true,
    });

    // Second request, check for HIT.
    res = http.post(`${BASE_URL}/validate/address`, poBoxPayload, { headers: HEADERS });
    check(res, {
        '[PO Box] status 200 HIT': (r) => r.status === 200,
        '[PO Box] cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
    });


    // Scenario 3: Test an address with a deliberately invalid city
    const invalidCityPayload = JSON.stringify({
        address: {
            line1: "1 Main St",
            city: "InvalidCity",
            postal_code: "90210",
            state: "CA",
            country: "US"
        }
    });

    // First request.
    res = http.post(`${BASE_URL}/validate/address`, invalidCityPayload, { headers: HEADERS });
    check(res, {
        '[Invalid City] status 200 (first req)': (r) => r.status === 200,
        '[Invalid City] valid is false (first req)': (r) => JSON.parse(r.body).valid === false,
    });

    // Second request, check for HIT.
    res = http.post(`${BASE_URL}/validate/address`, invalidCityPayload, { headers: HEADERS });
    check(res, {
        '[Invalid City] status 200 HIT': (r) => r.status === 200,
        '[Invalid City] cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
    });

    sleep(0.1);
}