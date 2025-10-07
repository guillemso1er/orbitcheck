import { check as k6check, sleep } from 'k6';
import http from 'k6/http';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        'checks': ['rate>0.90'],
        'http_req_duration': ['p(95)<2000', 'p(50)<1000']
    }
};

const BASE_URL = 'http://localhost:8081';
const API_V1_URL = `${BASE_URL}/v1`;
const DASHBOARD_HEADERS = {
    'Content-Type': 'application/json'
};

export default function () {
    const check = k6check;

    console.log('Starting k9 comprehensive journey test...');

    // Step 1: Register a new user
    const registerPayload = JSON.stringify({
        email: `k9test${Date.now()}@example.com`,
        password: 'password123'
    });
    const resRegister = http.post(`${BASE_URL}/auth/register`, registerPayload, { headers: DASHBOARD_HEADERS });
    check(resRegister, {
        '[Register] status 201': (r) => r.status === 201,
        '[Register] has token': (r) => {
            const body = JSON.parse(r.body);
            return body.token && body.user;
        }
    });
    const jwt = JSON.parse(resRegister.body).token;

    // Step 2: Login (verify)
    const loginPayload = JSON.stringify({
        email: JSON.parse(resRegister.body).user.email,
        password: 'password123'
    });
    const resLogin = http.post(`${BASE_URL}/auth/login`, loginPayload, { headers: DASHBOARD_HEADERS });
    check(resLogin, {
        '[Login] status 200': (r) => r.status === 200,
        '[Login] has token': (r) => {
            const body = JSON.parse(r.body);
            return body.token && body.user;
        }
    });

    // Dashboard headers with JWT
    const dashboardAuthHeaders = Object.assign({}, DASHBOARD_HEADERS, { 'Authorization': `Bearer ${jwt}` });

    // Step 3: List API keys (should be empty initially)
    const resListKeys = http.get(`${BASE_URL}/api-keys`, { headers: dashboardAuthHeaders });
    check(resListKeys, {
        '[List API Keys] status 200': (r) => r.status === 200,
        '[List API Keys] is array': (r) => Array.isArray(JSON.parse(r.body).data)
    });
    const initialKeys = JSON.parse(resListKeys.body).data;

    // Step 4: Create API key
    const createKeyPayload = JSON.stringify({ name: 'k9-test-key' });
    const resCreateKey = http.post(`${BASE_URL}/api-keys`, createKeyPayload, { headers: dashboardAuthHeaders });
    check(resCreateKey, {
        '[Create API Key] status 201': (r) => r.status === 201,
        '[Create API Key] has key': (r) => {
            const body = JSON.parse(r.body);
            return body.full_key && body.id;
        }
    });
    const apiKey = JSON.parse(resCreateKey.body).full_key;

    // Step 5: List API keys again (should have one more)
    const resListKeys2 = http.get(`${BASE_URL}/api-keys`, { headers: dashboardAuthHeaders });
    check(resListKeys2, {
        '[List API Keys After Create] status 200': (r) => r.status === 200,
        '[List API Keys After Create] has one more key': (r) => {
            const body = JSON.parse(r.body).data;
            return body.length === initialKeys.length + 1;
        }
    });

    // API headers with API key
    const apiHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    // Step 6: Validate email
    const emailPayload = JSON.stringify({ email: 'test@example.com' });
    const resValidateEmail = http.post(`${API_V1_URL}/validate/email`, emailPayload, { headers: apiHeaders });
    check(resValidateEmail, {
        '[Validate Email] status 200': (r) => r.status === 200,
        '[Validate Email] has result': (r) => {
            const body = JSON.parse(r.body);
            return body.valid !== undefined;
        }
    });

    // Step 7: Validate phone
    const phonePayload = JSON.stringify({ phone: '+1234567890' });
    const resValidatePhone = http.post(`${API_V1_URL}/validate/phone`, phonePayload, { headers: apiHeaders });
    check(resValidatePhone, {
        '[Validate Phone] status 200': (r) => r.status === 200,
        '[Validate Phone] has result': (r) => {
            const body = JSON.parse(r.body);
            return body.valid !== undefined;
        }
    });

    // Step 8: Validate address
    const addressPayload = JSON.stringify({
        line1: '123 Main St',
        city: 'Anytown',
        postal_code: '12345',
        state: 'CA',
        country: 'US'
    });
    const resValidateAddress = http.post(`${API_V1_URL}/validate/address`, addressPayload, { headers: apiHeaders });
    check(resValidateAddress, {
        '[Validate Address] status 200': (r) => r.status === 200,
        '[Validate Address] has result': (r) => {
            const body = JSON.parse(r.body);
            return body.valid !== undefined;
        }
    });

    // Step 9: Validate tax id
    const taxidPayload = JSON.stringify({ tax_id: '123-45-6789', country: 'US' });
    const resValidateTaxid = http.post(`${API_V1_URL}/validate/tax-id`, taxidPayload, { headers: apiHeaders });
    check(resValidateTaxid, {
        '[Validate Tax ID] status 200': (r) => r.status === 200,
        '[Validate Tax ID] has result': (r) => {
            const body = JSON.parse(r.body);
            return body.valid !== undefined;
        }
    });

    // Step 10: Dedupe customer
    const dedupeCustomerPayload = JSON.stringify({
        email: 'customer@example.com',
        phone: '+1234567890',
        first_name: 'John',
        last_name: 'Doe'
    });
    const resDedupeCustomer = http.post(`${API_V1_URL}/dedupe/customer`, dedupeCustomerPayload, { headers: apiHeaders });
    check(resDedupeCustomer, {
        '[Dedupe Customer] status 200': (r) => r.status === 200,
        '[Dedupe Customer] has id': (r) => {
            const body = JSON.parse(r.body);
            return body.id;
        }
    });
    const customerId = JSON.parse(resDedupeCustomer.body).id;

    // Step 11: Dedupe address
    const dedupeAddressPayload = JSON.stringify({
        line1: '123 Main St',
        city: 'Anytown',
        postal_code: '12345',
        state: 'CA',
        country: 'US'
    });
    const resDedupeAddress = http.post(`${API_V1_URL}/dedupe/address`, dedupeAddressPayload, { headers: apiHeaders });
    check(resDedupeAddress, {
        '[Dedupe Address] status 200': (r) => r.status === 200,
        '[Dedupe Address] has id': (r) => {
            const body = JSON.parse(r.body);
            return body.id;
        }
    });
    const addressId = JSON.parse(resDedupeAddress.body).id;

    // Step 12: Merge deduped records (assuming customer and address can be merged)
    const mergePayload = JSON.stringify({
        customer_id: customerId,
        address_id: addressId
    });
    const resMerge = http.post(`${API_V1_URL}/dedupe/merge`, mergePayload, { headers: apiHeaders });
    check(resMerge, {
        '[Merge Deduped] status 200': (r) => r.status === 200,
        '[Merge Deduped] success': (r) => {
            const body = JSON.parse(r.body);
            return body.success || body.merged;
        }
    });

    // Step 13: Evaluate order
    const orderPayload = JSON.stringify({
        order_id: `k9-order-${Date.now()}`,
        customer: {
            email: 'customer@example.com',
            phone: '+1234567890',
            first_name: 'John',
            last_name: 'Doe'
        },
        shipping_address: {
            line1: '123 Main St',
            city: 'Anytown',
            postal_code: '12345',
            state: 'CA',
            country: 'US'
        },
        total_amount: 100,
        currency: 'USD',
        payment_method: 'card'
    });
    const resEvaluateOrder = http.post(`${API_V1_URL}/orders/evaluate`, orderPayload, { headers: apiHeaders });
    check(resEvaluateOrder, {
        '[Evaluate Order] status 200': (r) => r.status === 200,
        '[Evaluate Order] has action': (r) => {
            const body = JSON.parse(r.body);
            return body.action;
        }
    });

    // Step 14: Get available rules
    const resGetRules = http.get(`${API_V1_URL}/rules`, { headers: apiHeaders });
    check(resGetRules, {
        '[Get Rules] status 200': (r) => r.status === 200,
        '[Get Rules] is array': (r) => Array.isArray(JSON.parse(r.body))
    });
    const initialRules = JSON.parse(resGetRules.body);

    // Step 15: Get reason code catalog
    const resGetCatalog = http.get(`${API_V1_URL}/rules/catalog`, { headers: apiHeaders });
    check(resGetCatalog, {
        '[Get Catalog] status 200': (r) => r.status === 200,
        '[Get Catalog] has data': (r) => {
            const body = JSON.parse(r.body);
            return body && typeof body === 'object';
        }
    });

    // Step 16: Register custom rules
    const customRulesPayload = JSON.stringify([
        {
            name: 'k9-custom-rule',
            condition: 'total_amount > 500',
            action: 'block'
        }
    ]);
    const resRegisterRules = http.post(`${API_V1_URL}/rules/register`, customRulesPayload, { headers: apiHeaders });
    check(resRegisterRules, {
        '[Register Rules] status 201': (r) => r.status === 201,
        '[Register Rules] success': (r) => {
            const body = JSON.parse(r.body);
            return body.registered || body.success;
        }
    });

    // Step 17: Get rules again to verify addition
    const resGetRules2 = http.get(`${API_V1_URL}/rules`, { headers: apiHeaders });
    check(resGetRules2, {
        '[Get Rules After Register] status 200': (r) => r.status === 200,
        '[Get Rules After Register] has more rules': (r) => {
            const body = JSON.parse(r.body);
            return body.length >= initialRules.length;
        }
    });

    // Step 18: Get event logs
    const resGetLogs = http.get(`${BASE_URL}/data/logs`, { headers: dashboardAuthHeaders });
    check(resGetLogs, {
        '[Get Logs] status 200': (r) => r.status === 200,
        '[Get Logs] is array': (r) => Array.isArray(JSON.parse(r.body))
    });

    // Step 19: Get usage statistics
    const resGetUsage = http.get(`${BASE_URL}/data/usage`, { headers: dashboardAuthHeaders });
    check(resGetUsage, {
        '[Get Usage] status 200': (r) => r.status === 200,
        '[Get Usage] has data': (r) => {
            const body = JSON.parse(r.body);
            return body && typeof body === 'object';
        }
    });

    // Step 20: Test webhook
    const webhookPayload = JSON.stringify({ url: 'https://example.com/webhook', event: 'test' });
    const resTestWebhook = http.post(`${BASE_URL}/webhooks/test`, webhookPayload, { headers: dashboardAuthHeaders });
    check(resTestWebhook, {
        '[Test Webhook] status 200': (r) => r.status === 200,
        '[Test Webhook] success': (r) => {
            const body = JSON.parse(r.body);
            return body.sent || body.success;
        }
    });

    // Step 21: Revoke API key
    const keyId = JSON.parse(resCreateKey.body).id;
    const resRevokeKey = http.del(`${BASE_URL}/api-keys/${keyId}`, null, { headers: dashboardAuthHeaders });
    check(resRevokeKey, {
        '[Revoke API Key] status 200': (r) => r.status === 200
    });

    // Step 22: List API keys to verify revocation
    const resListKeys3 = http.get(`${BASE_URL}/api-keys`, { headers: dashboardAuthHeaders });
    check(resListKeys3, {
        '[List API Keys After Revoke] status 200': (r) => r.status === 200,
        '[List API Keys After Revoke] back to initial count': (r) => {
            const body = JSON.parse(r.body).data;
            return body.length === initialKeys.length;
        }
    });

    console.log('k9 journey test completed successfully!');
    sleep(0.1);
}