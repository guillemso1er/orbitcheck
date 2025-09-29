import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = { vus: 10, duration: '30s' };

const KEY = __ENV.KEY;
const BASE_URL = 'http://localhost:8081';
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${KEY}`
};

export default function () {
    // Test low-risk order (should approve)
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
        'status 200': (r) => r.status === 200,
        'order_id matches': (r) => {
            const body = JSON.parse(r.body);
            return body.order_id === 'low-risk-1';
        },
        'risk_score low': (r) => {
            const body = JSON.parse(r.body);
            return body.risk_score < 40;
        },
        'action approve': (r) => {
            const body = JSON.parse(r.body);
            return body.action === 'approve';
        },
        'validations structure': (r) => {
            const body = JSON.parse(r.body);
            return body.validations && typeof body.validations === 'object';
        }
    });

    // Test high-risk order (PO box, high value, COD)
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
        'status 200': (r) => r.status === 200,
        'order_id matches': (r) => {
            const body = JSON.parse(r.body);
            return body.order_id === 'high-risk-1';
        },
        'risk_score high': (r) => {
            const body = JSON.parse(r.body);
            return body.risk_score > 70;
        },
        'action block': (r) => {
            const body = JSON.parse(r.body);
            return body.action === 'block';
        },
        'tags present': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.tags) && body.tags.length > 0;
        },
        'reason_codes present': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.reason_codes) && body.reason_codes.length > 0;
        }
    });

    // Test medium-risk order (hold)
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
        'status 200': (r) => r.status === 200,
        'order_id matches': (r) => {
            const body = JSON.parse(r.body);
            return body.order_id === 'medium-risk-1';
        },
        'risk_score medium': (r) => {
            const body = JSON.parse(r.body);
            return body.risk_score >= 40 && body.risk_score <= 70;
        },
        'action hold': (r) => {
            const body = JSON.parse(r.body);
            return body.action === 'hold';
        }
    });

    sleep(0.1);
}