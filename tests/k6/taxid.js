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

export function testVatValidationFirst(check) {
    const payload = JSON.stringify({
        type: 'vat',
        value: 'DE123456789',
        country: 'DE'
    });
    let res = http.post(`${BASE_URL}/validate/taxid`, payload, { headers: getHeaders() });
    check(res, {
        '[VAT] status 200 (first req)': (r) => r.status === 200,
        '[VAT] valid is false (first req)': (r) => JSON.parse(r.body).valid === false,
        '[VAT] reason taxid.vies_invalid (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('taxid.vies_invalid');
        }
    });
}

export function testVatValidationSecond(check) {
    const payload = JSON.stringify({
        type: 'vat',
        value: 'DE123456789',
        country: 'DE'
    });
    // Second request for the same VAT. THIS MUST be a HIT.
    const res = http.post(`${BASE_URL}/validate/taxid`, payload, { headers: getHeaders() });
    check(res, {
        '[VAT] status 200 HIT': (r) => r.status === 200,
        '[VAT] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });
}

export function testInvalidVatFormatFirst(check) {
    const payload = JSON.stringify({
        type: 'vat',
        value: 'invalid-vat',
        country: 'DE'
    });
    let res = http.post(`${BASE_URL}/validate/taxid`, payload, { headers: getHeaders() });
    check(res, {
        '[Invalid VAT] status 200 (first req)': (r) => r.status === 200,
        '[Invalid VAT] valid is false (first req)': (r) => JSON.parse(r.body).valid === false,
        // '[Invalid VAT] reason taxid.vies_invalid (first req)': (r) => {
        //     const body = JSON.parse(r.body);
        //     return body.reason_codes && body.reason_codes.includes('taxid.vies_invalid');
        // }
    });
}

export function testInvalidVatFormatSecond(check) {
    const payload = JSON.stringify({
        type: 'vat',
        value: 'invalid-vat',
        country: 'DE'
    });
    // Second request, check for HIT.
    const res = http.post(`${BASE_URL}/validate/taxid`, payload, { headers: getHeaders() });
    check(res, {
        '[Invalid VAT] status 200 HIT': (r) => r.status === 200,
        '[Invalid VAT] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });
}

export function testValidCnpjFirst(check) {
    const payload = JSON.stringify({
        type: 'CNPJ',
        value: '19131243000197'
    });
    let res = http.post(`${BASE_URL}/validate/taxid`, payload, { headers: getHeaders() });
    check(res, {
        '[Valid CNPJ] status 200 (first req)': (r) => r.status === 200,
        '[Valid CNPJ] valid is true (first req)': (r) => JSON.parse(r.body).valid === true,
        '[Valid CNPJ] normalized present (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.normalized && body.normalized.length > 0;
        }
    });
}

export function testValidCnpjSecond(check) {
    const payload = JSON.stringify({
        type: 'CNPJ',
        value: '19131243000197'
    });
    // Second request, check for HIT.
    const res = http.post(`${BASE_URL}/validate/taxid`, payload, { headers: getHeaders() });
    check(res, {
        '[Valid CNPJ] status 200 HIT': (r) => r.status === 200,
        '[Valid CNPJ] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });
}

export function testInvalidCnpjFirst(check) {
    const payload = JSON.stringify({
        type: 'CNPJ',
        value: 'invalid-cnpj'
    });
    let res = http.post(`${BASE_URL}/validate/taxid`, payload, { headers: getHeaders() });
    check(res, {
        '[Invalid CNPJ] status 200 (first req)': (r) => r.status === 200,
        '[Invalid CNPJ] valid is false (first req)': (r) => JSON.parse(r.body).valid === false,
        '[Invalid CNPJ] reason taxid.invalid_format (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('taxid.invalid_format');
        }
    });
}

export function testInvalidCnpjSecond(check) {
    const payload = JSON.stringify({
        type: 'CNPJ',
        value: 'invalid-cnpj'
    });
    // Second request, check for HIT.
    const res = http.post(`${BASE_URL}/validate/taxid`, payload, { headers: getHeaders() });
    check(res, {
        '[Invalid CNPJ] status 200 HIT': (r) => r.status === 200,
        '[Invalid CNPJ] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });
}

export default function (check) {
    // If check is not provided (when running this file directly),
    // use the original k6check as a fallback.
    check = check || k6check;

    testVatValidationFirst(check);
    testVatValidationSecond(check);
    testInvalidVatFormatFirst(check);
    testInvalidVatFormatSecond(check);
    testValidCnpjFirst(check);
    testValidCnpjSecond(check);
    testInvalidCnpjFirst(check);
    testInvalidCnpjSecond(check);

    sleep(0.1);
}
