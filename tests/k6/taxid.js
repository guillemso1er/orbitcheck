import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.1']
  }
};

const KEY = __ENV.KEY;
const BASE_URL = 'http://localhost:8081';
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${KEY}`
};

export default function () {
    // Test VAT ID with VIES outage simulation
    const vatPayload = JSON.stringify({
        type: 'vat',
        value: 'DE123456789',
        country: 'DE'
    });
    let res = http.post(`${BASE_URL}/validate/tax-id`, vatPayload, { headers: HEADERS });
    check(res, {
        'status 200': (r) => r.status === 200,
        'valid false (outage)': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === false;
        },
        'reason vies_unavailable': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('taxid.vies_unavailable');
        },
        'source vies': (r) => {
            const body = JSON.parse(r.body);
            return body.source === 'vies';
        },
        'cache status present': (r) => r.headers['X-Cache-Status'],
        'no errors': (r) => !r.body.includes('error')
    });

    // Test cache hit on second request (should be faster, HIT)
    res = http.post(`${BASE_URL}/validate/tax-id`, vatPayload, { headers: HEADERS });
    check(res, {
        'status 200 (hit)': (r) => r.status === 200,
        'cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
        'valid false (cached)': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === false;
        },
        'reason preserved': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('taxid.vies_unavailable');
        }
    });

    // Test invalid VAT format
    const invalidVatPayload = JSON.stringify({
        type: 'vat',
        value: 'invalid-vat',
        country: 'DE'
    });
    res = http.post(`${BASE_URL}/validate/tax-id`, invalidVatPayload, { headers: HEADERS });
    check(res, {
        'status 200': (r) => r.status === 200,
        'valid false': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === false;
        },
        'reason invalid_format': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('taxid.invalid_format');
        }
    });

    // Test valid Brazilian CNPJ
    const validCnpjPayload = JSON.stringify({
        type: 'br_cnpj',
        value: '00.000.000/0001-91'
    });
    res = http.post(`${BASE_URL}/validate/tax-id`, validCnpjPayload, { headers: HEADERS });
    check(res, {
        'status 200': (r) => r.status === 200,
        'valid true': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === true;
        },
        'normalized present': (r) => {
            const body = JSON.parse(r.body);
            return body.normalized && body.normalized.length > 0;
        }
    });

    // Test invalid CNPJ
    const invalidCnpjPayload = JSON.stringify({
        type: 'br_cnpj',
        value: 'invalid-cnpj'
    });
    res = http.post(`${BASE_URL}/validate/tax-id`, invalidCnpjPayload, { headers: HEADERS });
    check(res, {
        'status 200': (r) => r.status === 200,
        'valid false': (r) => {
            const body = JSON.parse(r.body);
            return body.valid === false;
        },
        'reason invalid_format': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('taxid.invalid_format');
        }
    });

    sleep(0.1);
}