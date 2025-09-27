import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = { vus: 10, duration: '30s' };

const KEY = __ENV.KEY;
const BASE_URL = 'http://localhost:8080';
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${KEY}`
};

export default function () {
    // Test valid address
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
        'status 200': (r) => r.status === 200,
        'valid true': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === true;
        },
        'po_box false': (r) => {
            const body = JSON.parse(r.body);
            return body.po_box === false;
        },
        'postal_city_match true': (r) => {
            const body = JSON.parse(r.body);
            return body.postal_city_match === true;
        }
    });

    // Test PO Box address
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
        'status 200': (r) => r.status === 200,
        'valid false': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === false;
        },
        'po_box true': (r) => {
            const body = JSON.parse(r.body);
            return body.po_box === true;
        },
        'reason po_box': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('address.po_box');
        }
    });

    // Test postal_city mismatch (using invalid city for postal code)
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
        'status 200': (r) => r.status === 200,
        'valid false': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === false;
        },
        'postal_city_match false': (r) => {
            const body = JSON.parse(r.body);
            return body.postal_city_match === false;
        },
        'reason postal_city_mismatch': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('address.postal_city_mismatch');
        }
    });

    sleep(0.1);
}