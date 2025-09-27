import { check, sleep } from 'k6';
import http from 'k6/http';

export const options = { vus: 10, duration: '30s' };

const KEY = __ENV.KEY;
const BASE_URL = 'http://localhost:8080';
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${KEY}`
};

export default function () {
    // Test valid phone without country
    const validPayload = JSON.stringify({ phone: '+16502530000' });
    let res = http.post(`${BASE_URL}/validate/phone`, validPayload, { headers: HEADERS });
    check(res, {
        'status 200': (r) => r.status === 200,
        'valid true': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === true;
        },
        'e164 present': (r) => {
            const body = JSON.parse(r.body);
            return body.e164 && body.e164.startsWith('+1');
        },
        'country US': (r) => {
            const body = JSON.parse(r.body);
            return body.country === 'US';
        }
    });

    // Test valid phone with country hint
    const validWithCountryPayload = JSON.stringify({ phone: '6502530000', country: 'US' });
    res = http.post(`${BASE_URL}/validate/phone`, validWithCountryPayload, { headers: HEADERS });
    check(res, {
        'status 200': (r) => r.status === 200,
        'valid true': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === true;
        },
        'e164 present': (r) => {
            const body = JSON.parse(r.body);
            return body.e164 === '+16502530000';
        }
    });

    // Test invalid phone format
    const invalidPayload = JSON.stringify({ phone: 'invalid-phone' });
    res = http.post(`${BASE_URL}/validate/phone`, invalidPayload, { headers: HEADERS });
    check(res, {
        'status 200': (r) => r.status === 200,
        'valid false': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === false;
        },
        // FIX IS HERE: Check for the correct reason code
        'reason unparseable': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('phone.unparseable');
        }
    });

    // Test invalid with country hint
    const invalidWithCountryPayload = JSON.stringify({ phone: '999999', country: 'US' });
    res = http.post(`${BASE_URL}/validate/phone`, invalidWithCountryPayload, { headers: HEADERS });
    check(res, {
        'status 200': (r) => r.status === 200,
        'valid false': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === false;
        },
        'reason invalid_format': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('phone.invalid_format');
        }
    });

    sleep(0.1);
}