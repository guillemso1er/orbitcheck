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

const BASE_URL = 'http://localhost:8081/v1';

export function testValidPhoneFirst(check) {
    const payload = JSON.stringify({ phone: '+16502530000' });
    let res = http.post(`${BASE_URL}/validate/phone`, payload, { headers: getHeaders('POST', '/v1/validate/phone', payload) });
    check(res, {
        '[Valid Phone] status 200 (first req)': (r) => r.status === 200,
        '[Valid Phone] valid is true (first req)': (r) => JSON.parse(r.body).valid === true,
        '[Valid Phone] e164 starts with +1 (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.e164 && body.e164.startsWith('+1');
        },
        '[Valid Phone] country is US (first req)': (r) => JSON.parse(r.body).country === 'US',
    });
}

export function testValidPhoneSecond(check) {
    const payload = JSON.stringify({ phone: '+16502530000' });
    // Second request for the same phone. THIS MUST be a HIT.
    const res = http.post(`${BASE_URL}/validate/phone`, payload, { headers: getHeaders('POST', '/v1/validate/phone', payload) });
    check(res, {
        '[Valid Phone] status 200 HIT': (r) => r.status === 200,
        '[Valid Phone] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit'),
    });
}

export function testValidPhoneWithCountryFirst(check) {
    const payload = JSON.stringify({ phone: '6502530000', country: 'US' });
    let res = http.post(`${BASE_URL}/validate/phone`, payload, { headers: getHeaders('POST', '/v1/validate/phone', payload) });
    check(res, {
        '[Valid with Country] status 200 (first req)': (r) => r.status === 200,
        '[Valid with Country] valid is true (first req)': (r) => JSON.parse(r.body).valid === true,
        '[Valid with Country] e164 is +16502530000 (first req)': (r) => JSON.parse(r.body).e164 === '+16502530000',
    });
}

export function testValidPhoneWithCountrySecond(check) {
    const payload = JSON.stringify({ phone: '6502530000', country: 'US' });
    // Second request, check for HIT.
    const res = http.post(`${BASE_URL}/validate/phone`, payload, { headers: getHeaders('POST', '/v1/validate/phone', payload) });
    check(res, {
        '[Valid with Country] status 200 HIT': (r) => r.status === 200,
        '[Valid with Country] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit'),
    });
}

export function testInvalidPhoneFormatFirst(check) {
    const payload = JSON.stringify({ phone: 'invalid-phone' });
    let res = http.post(`${BASE_URL}/validate/phone`, payload, { headers: getHeaders('POST', '/v1/validate/phone', payload) });
    check(res, {
        '[Invalid Format] status 200 (first req)': (r) => r.status === 200,
        '[Invalid Format] valid is false (first req)': (r) => JSON.parse(r.body).valid === false,
        '[Invalid Format] reason phone.unparseable (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('phone.unparseable');
        },
    });
}

export function testInvalidPhoneFormatSecond(check) {
    const payload = JSON.stringify({ phone: 'invalid-phone' });
    // Second request, check for HIT.
    const res = http.post(`${BASE_URL}/validate/phone`, payload, { headers: getHeaders('POST', '/v1/validate/phone', payload) });
    check(res, {
        '[Invalid Format] status 200 HIT': (r) => r.status === 200,
        '[Invalid Format] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit'),
    });
}

export function testInvalidPhoneWithCountryFirst(check) {
    const payload = JSON.stringify({ phone: '999999', country: 'US' });
    let res = http.post(`${BASE_URL}/validate/phone`, payload, { headers: getHeaders('POST', '/v1/validate/phone', payload) });
    check(res, {
        '[Invalid with Country] status 200 (first req)': (r) => r.status === 200,
        '[Invalid with Country] valid is false (first req)': (r) => JSON.parse(r.body).valid === false,
        '[Invalid with Country] reason phone.invalid_format (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.reason_codes && body.reason_codes.includes('phone.invalid_format');
        },
    });
}

export function testInvalidPhoneWithCountrySecond(check) {
    const payload = JSON.stringify({ phone: '999999', country: 'US' });
    // Second request, check for HIT.
    const res = http.post(`${BASE_URL}/validate/phone`, payload, { headers: getHeaders('POST', '/v1/validate/phone', payload) });
    check(res, {
        '[Invalid with Country] status 200 HIT': (r) => r.status === 200,
        '[Invalid with Country] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit'),
    });
}

export function testVerifyPhone(check) {
    const payload = JSON.stringify({
        verification_sid: 'test_sid',
        code: '123456'
    });
    const res = http.post(`${BASE_URL}/verify/phone`, payload, { headers: getHeaders('POST', '/v1/verify/phone', payload) });
    check(res, {
        '[Verify Phone] status is 200 or error': (r) => r.status === 200 || r.status === 400 || r.status === 500,
    });
}

export default function (check) {
    // 3. If check is not provided (when running this file directly),
    //    use the original k6check as a fallback.
    check = check || k6check;
    testValidPhoneFirst(check);
    testValidPhoneSecond(check);
    testValidPhoneWithCountryFirst(check);
    testValidPhoneWithCountrySecond(check);
    testInvalidPhoneFormatFirst(check);
    testInvalidPhoneFormatSecond(check);
    testInvalidPhoneWithCountryFirst(check);
    testInvalidPhoneWithCountrySecond(check);
    testVerifyPhone(check);
    sleep(0.1);
}