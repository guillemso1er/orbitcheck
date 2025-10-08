import { check as k6check, sleep } from 'k6';
import http from 'k6/http';
import { getHeaders } from './auth-utils.js';

export const options = {
    vus: 50,
    duration: '1m',
    thresholds: {
        'checks': ['rate>0.99'],
        http_req_duration: ['p(95)<200', 'p(50)<50']
    }
};

const KEY = (__ENV.KEY || '').trim();
const BASE_URL = 'http://localhost:8081/v1';

export default function (check) {
    // If check is not provided (when running this file directly),
    // use the original k6check as a fallback.
    check = check || k6check;

    // Scenario 1: Test VAT ID (assuming outage or invalid)
    const vatPayload = JSON.stringify({
        type: 'vat',
        value: 'DE123456789',
        country: 'DE'
    });
    let res = http.post(`${BASE_URL}/validate/taxid`, vatPayload, { headers: getHeaders() });
    check(res, {
        '[VAT] status 200 (first req)': (r) => r.status === 200,
        '[VAT] valid is false (first req)': (r) => JSON.parse(r.body).valid === false,
        '[VAT] reason taxid.vies_invalid (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('taxid.vies_invalid');
        }
    });

    // Second request for the same VAT. THIS MUST be a HIT.
    res = http.post(`${BASE_URL}/validate/taxid`, vatPayload, { headers: getHeaders() });
    check(res, {
        '[VAT] status 200 HIT': (r) => r.status === 200,
        '[VAT] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });

    // Scenario 2: Test invalid VAT format
    const invalidVatPayload = JSON.stringify({
        type: 'vat',
        value: 'invalid-vat',
        country: 'DE'
    });
    res = http.post(`${BASE_URL}/validate/taxid`, invalidVatPayload, { headers: getHeaders() });
    check(res, {
        '[Invalid VAT] status 200 (first req)': (r) => r.status === 200,
        '[Invalid VAT] valid is false (first req)': (r) => JSON.parse(r.body).valid === false,
        // '[Invalid VAT] reason taxid.vies_invalid (first req)': (r) => {
        //     const body = JSON.parse(r.body);
        //     return body.reason_codes && body.reason_codes.includes('taxid.vies_invalid');
        // }
    });

    // Second request, check for HIT.
    res = http.post(`${BASE_URL}/validate/taxid`, invalidVatPayload, { headers: getHeaders() });
    check(res, {
        '[Invalid VAT] status 200 HIT': (r) => r.status === 200,
        '[Invalid VAT] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });

    // Scenario 3: Test valid Brazilian CNPJ
    const validCnpjPayload = JSON.stringify({
        type: 'CNPJ',
        value: '19131243000197'
    });
    res = http.post(`${BASE_URL}/validate/taxid`, validCnpjPayload, { headers: getHeaders() });
    check(res, {
        '[Valid CNPJ] status 200 (first req)': (r) => r.status === 200,
        '[Valid CNPJ] valid is true (first req)': (r) => JSON.parse(r.body).valid === true,
        '[Valid CNPJ] normalized present (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.normalized && body.normalized.length > 0;
        }
    });

    // Second request, check for HIT.
    res = http.post(`${BASE_URL}/validate/taxid`, validCnpjPayload, { headers: getHeaders() });
    check(res, {
        '[Valid CNPJ] status 200 HIT': (r) => r.status === 200,
        '[Valid CNPJ] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });

    // Scenario 4: Test invalid CNPJ
    const invalidCnpjPayload = JSON.stringify({
        type: 'CNPJ',
        value: 'invalid-cnpj'
    });
    res = http.post(`${BASE_URL}/validate/taxid`, invalidCnpjPayload, { headers: getHeaders() });
    check(res, {
        '[Invalid CNPJ] status 200 (first req)': (r) => r.status === 200,
        '[Invalid CNPJ] valid is false (first req)': (r) => JSON.parse(r.body).valid === false,
        '[Invalid CNPJ] reason taxid.invalid_format (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('taxid.invalid_format');
        }
    });

    // Second request, check for HIT.
    res = http.post(`${BASE_URL}/validate/taxid`, invalidCnpjPayload, { headers: getHeaders() });
    check(res, {
        '[Invalid CNPJ] status 200 HIT': (r) => r.status === 200,
        '[Invalid CNPJ] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });

    sleep(0.1);
}
