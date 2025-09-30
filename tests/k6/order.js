import { check, sleep } from 'k6';
import http from 'k6/http';

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
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${KEY}`
};

export default function () {
    // Scenario 1: Test low-risk order (should approve)
    const lowRiskPayload = JSON.stringify({
        order_id: 'low-risk-1',
        customer: {
            email: 'customer@example.com',
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
    let res = http.post(`${BASE_URL}/orders/evaluate`, lowRiskPayload, { headers: HEADERS });
    check(res, {
        '[Low Risk] status 200 (first req)': (r) => r.status === 200,
        '[Low Risk] order_id matches (first req)': (r) => JSON.parse(r.body).order_id === 'low-risk-1',
        '[Low Risk] risk_score low (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.risk_score < 40;
        },
        '[Low Risk] action approve (first req)': (r) => JSON.parse(r.body).action === 'approve',
        '[Low Risk] validations structure (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.validations && typeof body.validations === 'object';
        }
    });

    // Second request for the same order. THIS MUST be a HIT.
    res = http.post(`${BASE_URL}/orders/evaluate`, lowRiskPayload, { headers: HEADERS });
    check(res, {
        '[Low Risk] status 200 HIT': (r) => r.status === 200,
        '[Low Risk] cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
    });

    // Scenario 2: Test high-risk order (PO box, high value, COD)
    const highRiskPayload = JSON.stringify({
        order_id: 'high-risk-1',
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
    res = http.post(`${BASE_URL}/orders/evaluate`, highRiskPayload, { headers: HEADERS });
    check(res, {
        '[High Risk] status 200 (first req)': (r) => r.status === 200,
        '[High Risk] order_id matches (first req)': (r) => JSON.parse(r.body).order_id === 'high-risk-1',
        '[High Risk] risk_score high (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.risk_score > 70;
        },
        '[High Risk] action block (first req)': (r) => JSON.parse(r.body).action === 'block',
        '[High Risk] tags present (first req)': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.tags) && body.tags.length > 0;
        },
        '[High Risk] reason_codes present (first req)': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.reason_codes) && body.reason_codes.length > 0;
        }
    });

    // Second request, check for HIT.
    res = http.post(`${BASE_URL}/orders/evaluate`, highRiskPayload, { headers: HEADERS });
    check(res, {
        '[High Risk] status 200 HIT': (r) => r.status === 200,
        '[High Risk] cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
    });

    // Scenario 3: Test medium-risk order (hold)
    const mediumRiskPayload = JSON.stringify({
        order_id: 'medium-risk-1',
        customer: {
            email: 'medium@example.com',
            phone: 'invalid-phone',
            first_name: 'Medium',
            last_name: 'User'
        },
        shipping_address: {
            line1: '123 Invalid St',
            city: 'InvalidCity',
            postal_code: '94043',
            state: 'CA',
            country: 'US'
        },
        total_amount: 500,
        currency: 'USD',
        payment_method: 'card'
    });
    res = http.post(`${BASE_URL}/orders/evaluate`, mediumRiskPayload, { headers: HEADERS });
    check(res, {
        '[Medium Risk] status 200 (first req)': (r) => r.status === 200,
        '[Medium Risk] order_id matches (first req)': (r) => JSON.parse(r.body).order_id === 'medium-risk-1',
        '[Medium Risk] risk_score medium (first req)': (r) => {
            const body = JSON.parse(r.body);
            return body.risk_score >= 40 && body.risk_score <= 70;
        },
        '[Medium Risk] action hold (first req)': (r) => JSON.parse(r.body).action === 'hold',
    });

    // Second request, check for HIT.
    res = http.post(`${BASE_URL}/orders/evaluate`, mediumRiskPayload, { headers: HEADERS });
    check(res, {
        '[Medium Risk] status 200 HIT': (r) => r.status === 200,
        '[Medium Risk] cache HIT': (r) => r.headers['X-Cache-Status'] === 'HIT',
    });

    sleep(0.1);
}