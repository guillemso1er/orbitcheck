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

const BASE_URL = 'http://localhost:8081/v1';

export function testListWebhooks(check) {
    const res = http.get(`${BASE_URL}/webhooks`, { headers: getHeaders('GET', '/v1/webhooks') });
    check(res, {
        '[List Webhooks] status 200': (r) => r.status === 200,
        '[List Webhooks] has data array': (r) => {
            const body = r.json();
            return body && Array.isArray(body.data);
        }
    });
    return res;
}

export function testCreateWebhook(check) {
    const payload = JSON.stringify({
        url: 'https://example.com/webhook',
        events: ['validation_result']
    });
    const res = http.post(`${BASE_URL}/webhooks`, payload, { headers: getHeaders('POST', '/v1/webhooks', payload) });
    const body = res.status === 201 ? res.json() : null;
    check(res, {
        '[Create Webhook] status 201': (r) => r.status === 201,
        '[Create Webhook] has id': (r) => body && body.id,
        '[Create Webhook] has secret': (r) => body && body.secret,
        '[Create Webhook] has correct events': (r) => body && Array.isArray(body.events) && body.events.includes('validation_result')
    });
    return { res, body };
}

export function testListWebhooksAfterCreate(check, webhookId) {
    const res = http.get(`${BASE_URL}/webhooks`, { headers: getHeaders('GET', '/v1/webhooks') });
    const body = res.status === 200 ? res.json() : null;
    check(res, {
        '[List Webhooks After Create] status 200': (r) => r.status === 200,
        '[List Webhooks After Create] includes new webhook': (r) => {
            if (!body || !Array.isArray(body.data) || !webhookId) return false;
            return body.data.some(webhook => webhook.id === webhookId);
        }
    });
    return res;
}

export function testDeleteWebhook(check, webhookId) {
    const res = http.del(`${BASE_URL}/webhooks/${webhookId}`, null, { headers: getHeaders('DELETE', `/v1/webhooks/${webhookId}`) });
    check(res, {
        '[Delete Webhook] status 200': (r) => r.status === 200,
        '[Delete Webhook] has correct id': (r) => {
            const body = r.json();
            return body && body.id === webhookId;
        },
        '[Delete Webhook] status is deleted': (r) => {
            const body = r.json();
            return body && body.status === 'deleted';
        }
    });
    return res;
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
        testDeleteWebhook(check, webhookId);
    }

    // Test Case 5: Create webhook with multiple events
    testCreateWebhookMultipleEvents(check);

    sleep(0.1);
}