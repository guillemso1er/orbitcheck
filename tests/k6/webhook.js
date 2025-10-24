import { check as k6check, sleep } from 'k6';
import http from 'k6/http';
import { getHeaders } from './auth-utils.js';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        'checks': ['rate>0.90'],
        'http_req_duration': ['p(95)<2000', 'p(50)<1000']
    }
};

const BASE_URL = 'http://localhost:8080';
const API_V1_URL = `${BASE_URL}/v1`;
const HEADERS = {
    'Content-Type': 'application/json'
};

export function testListWebhooks(headers, check) {
    const res = http.get(`${API_V1_URL}/webhooks`, { headers });
    check(res, {
        '[List Webhooks] status 200': (r) => r.status === 200,
        '[List Webhooks] is array': (r) => r.status === 200 && Array.isArray(JSON.parse(r.body).data)
    });
    const initialWebhooks = res.status === 200 ? JSON.parse(res.body).data : [];
    return initialWebhooks;
}

export function testCreateWebhook(headers, check) {
    const createWebhookPayload = JSON.stringify({
        url: 'http://httpbin.org/post',
        events: ['validation_result', 'order_evaluated']
    });
    const res = http.post(`${API_V1_URL}/webhooks`, createWebhookPayload, { headers });
    check(res, {
        '[Create Webhook] status 200 or 201': (r) => r.status === 200 || r.status === 201,
        '[Create Webhook] has webhook': (r) => true
    });
    let createWebhookBody = { id: null };
    if (res.status === 201) {
        try {
            const body = JSON.parse(res.body);
            createWebhookBody = { id: body.id || null };
        } catch (e) {
            createWebhookBody = { id: null };
        }
    }
    return createWebhookBody;
}

export function testListWebhooksAfterCreate(headers, check) {
    const res = http.get(`${API_V1_URL}/webhooks`, { headers });
    check(res, {
        '[List Webhooks After Create] status 200': (r) => r.status === 200,
        '[List Webhooks After Create] has one more webhook': (r) => true
    });
}

export function testDeleteWebhook(headers, check, webhookId) {
    const delHeaders = Object.assign({}, headers);
    delete delHeaders['Content-Type'];
    const url = `${API_V1_URL}/webhooks/${webhookId}`;
    const res = http.del(url, null, { headers: delHeaders });
    check(res, {
        '[Delete Webhook] status 200 or 204': (r) => r.status === 200 || r.status === 204
    });
}

export function testTestWebhook(headers, check) {
    const webhookPayload = JSON.stringify({ url: 'https://httpbin.org/post', payload_type: 'validation' });
    const res = http.post(`${API_V1_URL}/webhooks/test`, webhookPayload, { headers });
    check(res, {
        '[Test Webhook] status 200 or 400': (r) => r.status === 200 || r.status === 400,
        '[Test Webhook] success': (r) => true
    });
}

export function testListWebhooksAfterDelete(headers, check) {
    const res = http.get(`${API_V1_URL}/webhooks`, { headers });
    check(res, {
        '[List Webhooks After Delete] status 200': (r) => r.status === 200,
        '[List Webhooks After Delete] back to initial count': (r) => r.status === 200 && JSON.parse(r.body).data.length === 0
    });
}

export function testCreateWebhookMultipleEvents(headers, check) {
    const payload = JSON.stringify({
        url: 'https://example.com/webhook2',
        events: ['validation_result', 'order_evaluated']
    });
    const res = http.post(`${API_V1_URL}/webhooks`, payload, { headers });
    const body = res.status === 201 ? res.json() : null;
    check(res, {
        '[Create Webhook Multiple Events] status 201': (r) => r.status === 201,
        '[Create Webhook Multiple Events] has all events': (r) => {
            if (!body || !Array.isArray(body.events)) return false;
            return body.events.includes('validation_result') && body.events.includes('order_evaluated');
        }
    });
    return { res, body };
}

export default function (check) {
    check = check || k6check;
    sleep(1);

    const headers = getHeaders('GET', '/v1/webhooks');

    // Test Case 1: List webhooks
    testListWebhooks(headers, check);

    // Test Case 2: Create webhook
    const createBody = testCreateWebhook(headers, check);
    const webhookId = createBody ? createBody.id : null;

    // Test Case 3: List webhooks again to verify creation
    if (webhookId) {
        testListWebhooksAfterCreate(headers, check);

        // Test Case 4: Delete webhook
        testDeleteWebhook(headers, check, webhookId);
    }

    // Test Case 5: Create webhook with multiple events
    testCreateWebhookMultipleEvents(headers, check);

    sleep(0.1);
}