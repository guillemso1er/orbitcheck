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
    // Test valid VAT ID
    const validVatPayload = JSON.stringify({
        type: 'vat',
        value: 'DE123456789',
        country: 'DE'
    });
    let res = http.post(`${BASE_URL}/validate/tax-id`, validVatPayload, { headers: HEADERS });
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