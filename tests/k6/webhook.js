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

export default function (check) {
    check = check || k6check;
    sleep(1);

    let webhookId = null;

    // Test Case 1: List webhooks
    const listRes = http.get(`${BASE_URL}/webhooks`, { headers: getHeaders('GET', '/v1/webhooks') });
    check(listRes, {
        '[List Webhooks] status 200': (r) => r.status === 200,
        '[List Webhooks] has data array': (r) => {
            const body = r.json();
            return body && Array.isArray(body.data);
        }
    });

    // Test Case 2: Create webhook
    const createPayload = JSON.stringify({
        url: 'https://example.com/webhook',
        events: ['validation_result']
    });
    const createRes = http.post(`${BASE_URL}/webhooks`, createPayload, { headers: getHeaders('POST', '/v1/webhooks', createPayload) });
    const createBody = createRes.status === 201 ? createRes.json() : null;
    check(createRes, {
        '[Create Webhook] status 201': (r) => r.status === 201,
        '[Create Webhook] has id': (r) => createBody && createBody.id,
        '[Create Webhook] has secret': (r) => createBody && createBody.secret,
        '[Create Webhook] has correct events': (r) => createBody && Array.isArray(createBody.events) && createBody.events.includes('validation_result')
    });

    if (createBody && createBody.id) {
        webhookId = createBody.id;
    }

    // Test Case 3: List webhooks again to verify creation
    const listRes2 = http.get(`${BASE_URL}/webhooks`, { headers: getHeaders('GET', '/v1/webhooks') });
    const listBody2 = listRes2.status === 200 ? listRes2.json() : null;
    check(listRes2, {
        '[List Webhooks After Create] status 200': (r) => r.status === 200,
        '[List Webhooks After Create] includes new webhook': (r) => {
            if (!listBody2 || !Array.isArray(listBody2.data) || !webhookId) return false;
            return listBody2.data.some(webhook => webhook.id === webhookId);
        }
    });

    // Test Case 4: Delete webhook (if we have an ID)
    if (webhookId) {
        const deleteRes = http.del(`${BASE_URL}/webhooks/${webhookId}`, null, { headers: getHeaders('DELETE', `/v1/webhooks/${webhookId}`) });
        check(deleteRes, {
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
    }

    // Test Case 5: Create webhook with multiple events
    const createPayload2 = JSON.stringify({
        url: 'https://example.com/webhook2',
        events: ['validation_result', 'order_evaluated']
    });
    const createRes2 = http.post(`${BASE_URL}/webhooks`, createPayload2, { headers: getHeaders('POST', '/v1/webhooks', createPayload2) });
    const createBody2 = createRes2.status === 201 ? createRes2.json() : null;
    check(createRes2, {
        '[Create Webhook Multiple Events] status 201': (r) => r.status === 201,
        '[Create Webhook Multiple Events] has all events': (r) => {
            if (!createBody2 || !Array.isArray(createBody2.events)) return false;
            return createBody2.events.includes('validation_result') && createBody2.events.includes('order_evaluated');
        }
    });

    sleep(0.1);
}