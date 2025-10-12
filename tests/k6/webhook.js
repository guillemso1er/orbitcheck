import { check as k6check, sleep } from 'k6';
import http from 'k6/http';
import { getHeaders } from './auth-utils.js';

export const options = {
    vus: 10,
    duration: '30s',
    thresholds: {
        'checks': ['rate>0.95'],
        http_req_duration: ['p(95)<500', 'p(50)<100']
    }
};

const BASE_URL = 'http://localhost:8080';

export function testListWebhooks(headers, check) {
    const res = http.get(`${BASE_URL}/v1/webhooks`, { headers });
    check(res, {
        '[List Webhooks] status 200': (r) => r.status === 200,
        '[List Webhooks] is array': (r) => r.status === 200 && Array.isArray(JSON.parse(r.body).data)
    });
    const initialWebhooks = res.status === 200 ? JSON.parse(res.body).data : [];
    return initialWebhooks;
}

export function testCreateWebhook(headers, check) {
    const createWebhookPayload = JSON.stringify({
        url: 'https://httpbin.org/post',
        events: ['validation_result', 'order_evaluated']
    });
    const res = http.post(`${BASE_URL}/v1/webhooks`, createWebhookPayload, { headers });
    check(res, {
        '[Create Webhook] status 201': (r) => r.status === 201,
        '[Create Webhook] has webhook': (r) => {
            const body = JSON.parse(r.body);
            return body.id && body.url && body.events;
        }
    });
    const createWebhookBody = res.status === 201 ? JSON.parse(res.body) : { id: null };
    return createWebhookBody;
}

export function testListWebhooksAfterCreate(headers, check) {
    const res = http.get(`${BASE_URL}/v1/webhooks`, { headers });
    check(res, {
        '[List Webhooks After Create] status 200': (r) => r.status === 200,
        '[List Webhooks After Create] has one more webhook': (r) => r.status === 200 && JSON.parse(r.body).data.length > 0
    });
}

export function testDeleteWebhook(headers, check, webhookId) {
    const delHeaders = Object.assign({}, headers);
    delete delHeaders['Content-Type'];
    const res = http.del(`${BASE_URL}/v1/webhooks/${webhookId.id}`, null, { headers: delHeaders });
    check(res, {
        '[Delete Webhook] status 200': (r) => r.status === 200
    });
}

export function testTestWebhook(headers, check) {
    const webhookPayload = JSON.stringify({ url: 'https://httpbin.org/post', payload_type: 'validation' });
    const res = http.post(`${BASE_URL}/v1/webhooks/test`, webhookPayload, { headers });
    check(res, {
        '[Test Webhook] status 200': (r) => r.status === 200,
        '[Test Webhook] success': (r) => {
            const body = JSON.parse(r.body);
            return body.response && body.response.status === 200;
        }
    });
}

export function testListWebhooksAfterDelete(headers, check) {
    const res = http.get(`${BASE_URL}/v1/webhooks`, { headers });
    check(res, {
        '[List Webhooks After Delete] status 200': (r) => r.status === 200,
        '[List Webhooks After Delete] back to initial count': (r) => r.status === 200 && JSON.parse(r.body).data.length === 0
    });
}

export function testCreateWebhookMultipleEvents(check) {
    const payload = JSON.stringify({
        url: 'https://example.com/webhook2',
        events: ['validation_result', 'order_evaluated']
    });
    const res = http.post(`${BASE_URL}/webhooks`, payload, { headers: getHeaders('POST', '/v1/webhooks', payload) });
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

    // Test Case 1: List webhooks
    testListWebhooks(check);

    // Test Case 2: Create webhook
    const { body: createBody } = testCreateWebhook(check);
    const webhookId = createBody ? createBody.id : null;

    // Test Case 3: List webhooks again to verify creation
    if (webhookId) {
        testListWebhooksAfterCreate(check, webhookId);

        // Test Case 4: Delete webhook
        testDeleteWebhook(check, {}, webhookId);
    }

    // Test Case 5: Create webhook with multiple events
    testCreateWebhookMultipleEvents(check);

    sleep(0.1);
}