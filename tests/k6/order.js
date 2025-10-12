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

export function testLowRiskOrderFirst(check) {
    const suffix = Math.random().toString(36).substring(2, 8);
    const orderId = `low-${suffix}`;
    const payload = JSON.stringify({
        order_id: orderId,
        customer: {
            email: 'customer@gmail.com',
            phone: '+16502530000',
            first_name: 'John',
            last_name: 'Doe'
        },
        shipping_address: {
            line1: '1600 Amphitheatre Pkwy',
            city: 'Mountain View',
            postal_code: '94043',
            state: 'CA',
            country: 'US'
        },
        total_amount: 100,
        currency: 'USD',
        payment_method: 'card'
    });
    let res = http.post(`${BASE_URL}/orders`, payload, { headers: getHeaders() });
    check(res, {
        '[Low Risk] status 200 (first req)': (r) => r.status === 200,
        '[Low Risk] action is approve (first req)': (r) => {
            if (r.status !== 200) return false;
            const body = JSON.parse(r.body);
            return body.action === 'approve';
        },
        '[Low Risk] risk_score is low (first req)': (r) => {
            if (r.status !== 200) return false;
            const body = JSON.parse(r.body);
            // Assuming RISK_HOLD_THRESHOLD is 40
            return body.risk_score < 40;
        }
    });
}

export function testLowRiskOrderSecond(check) {
    const suffix = Math.random().toString(36).substring(2, 8);
    const orderId = `low-${suffix}`;
    const payload = JSON.stringify({
        order_id: orderId,
        customer: {
            email: 'customer@gmail.com',
            phone: '+16502530000',
            first_name: 'John',
            last_name: 'Doe'
        },
        shipping_address: {
            line1: '1600 Amphitheatre Pkwy',
            city: 'Mountain View',
            postal_code: '94043',
            state: 'CA',
            country: 'US'
        },
        total_amount: 100,
        currency: 'USD',
        payment_method: 'card'
    });
    // Second request for the same order. THIS MUST be a HIT.
    // Must reuse the same payload and headers.
    const res = http.post(`${BASE_URL}/orders`, payload, { headers: getHeaders() });
    check(res, {
        '[Low Risk] status 200 HIT': (r) => r.status === 200,
        '[Low Risk] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });
}

export function testHighRiskOrderFirst(check) {
    const suffix = Math.random().toString(36).substring(2, 8);
    const orderId = `high-${suffix}`;
    const payload = JSON.stringify({
        order_id: orderId,
        customer: {
            email: 'risky@example.com',
            phone: '+16502530000',
            first_name: 'Risky',
            last_name: 'User'
        },
        shipping_address: {
            line1: 'P.O. Box 123',
            city: 'Mountain View',
            postal_code: '94043',
            state: 'CA',
            country: 'US'
        },
        total_amount: 1500,
        currency: 'USD',
        payment_method: 'cod'
    });
    let res = http.post(`${BASE_URL}/orders`, payload, { headers: getHeaders() });
    check(res, {
        '[High Risk] status 200 (first req)': (r) => r.status === 200,
        '[High Risk] action is hold (first req)': (r) => {
            if (r.status !== 200) return false;
            return JSON.parse(r.body).action === 'hold';
        },
        '[High Risk] tags present (first req)': (r) => {
            if (r.status !== 200) return false;
            const body = JSON.parse(r.body);
            return Array.isArray(body.tags) && body.tags.includes('po_box_detected') && body.tags.includes('high_value_order');
        }
    });
}

export function testHighRiskOrderSecond(check) {
    const suffix = Math.random().toString(36).substring(2, 8);
    const orderId = `high-${suffix}`;
    const payload = JSON.stringify({
        order_id: orderId,
        customer: {
            email: 'risky@example.com',
            phone: '+16502530000',
            first_name: 'Risky',
            last_name: 'User'
        },
        shipping_address: {
            line1: 'P.O. Box 123',
            city: 'Mountain View',
            postal_code: '94043',
            state: 'CA',
            country: 'US'
        },
        total_amount: 1500,
        currency: 'USD',
        payment_method: 'cod'
    });
    // Second request, check for HIT.
    // Must reuse the same payload and headers.
    const res = http.post(`${BASE_URL}/orders`, payload, { headers: getHeaders() });
    check(res, {
        '[High Risk] status 200 HIT': (r) => r.status === 200,
        '[High Risk] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });
}

export function testMediumRiskOrderFirst(check) {
    const suffix = Math.random().toString(36).substring(2, 8);
    const orderId = `medium-${suffix}`;
    const payload = JSON.stringify({
        order_id: orderId,
        customer: {
            email: 'bad@',
            phone: 'invalid-phone'
        },
        shipping_address: {
            line1: '1600 Amphitheatre Pkwy',
            city: 'Mountain View',
            postal_code: '94043',
            state: 'CA',
            country: 'US'
        },
        total_amount: 200,
        currency: 'USD',
        payment_method: 'card'
    });
    let res = http.post(`${BASE_URL}/orders`, payload, { headers: getHeaders() });
    check(res, {
        '[Medium Risk] status 200 (first req)': (r) => r.status === 200,
        '[Medium Risk] action is hold (first req)': (r) => {
            if (r.status !== 200) return false;
            return JSON.parse(r.body).action === 'hold';
        }
    });
}

export function testMediumRiskOrderSecond(check) {
    const suffix = Math.random().toString(36).substring(2, 8);
    const orderId = `medium-${suffix}`;
    const payload = JSON.stringify({
        order_id: orderId,
        customer: {
            email: 'bad@',
            phone: 'invalid-phone'
        },
        shipping_address: {
            line1: '1600 Amphitheatre Pkwy',
            city: 'Mountain View',
            postal_code: '94043',
            state: 'CA',
            country: 'US'
        },
        total_amount: 200,
        currency: 'USD',
        payment_method: 'card'
    });
    // Second request, check for HIT.
    // Must reuse the same payload and headers.
    const res = http.post(`${BASE_URL}/orders`, payload, { headers: getHeaders() });
    check(res, {
        '[Medium Risk] status 200 HIT': (r) => r.status === 200,
        '[Medium Risk] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });
}

export default function (check) {
    check = check || k6check;

    testLowRiskOrderFirst(check);
    testLowRiskOrderSecond(check);
    testHighRiskOrderFirst(check);
    testHighRiskOrderSecond(check);
    testMediumRiskOrderFirst(check);
    testMediumRiskOrderSecond(check);

    sleep(0.1);
}
