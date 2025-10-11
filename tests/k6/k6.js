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

const BASE_URL = 'http://localhost:8080';
const API_V1_URL = `${BASE_URL}/v1`;
const HEADERS = {
    'Content-Type': 'application/json'
};
const NO_BODY_HEADERS = {
    // No Content-Type for requests without body
};

export default function () {
    const check = k6check;

    console.log('Starting k6 comprehensive journey test with new auth...');

    // Step 1: Register a new user - Returns PAT and API key (no JWT)
    const registerPayload = JSON.stringify({
        email: `k6test${Date.now()}@example.com`,
        password: 'password123'
    });
    const resRegister = http.post(`${BASE_URL}/auth/register`, registerPayload, { headers: HEADERS });
    check(resRegister, {
        '[Register] status 201': (r) => r.status === 201,
        '[Register] has credentials': (r) => {
            const body = JSON.parse(r.body);
            return body.user && body.pat_token && body.api_key;
        }
    });
    const registerBody = JSON.parse(resRegister.body);
    const patToken = registerBody.pat_token; // Personal Access Token for management API
    const defaultApiKey = registerBody.api_key; // API key for runtime endpoints
    const userEmail = registerBody.user.email;

    // Step 2: Login - Sets session cookie (for dashboard), no token returned
    const loginPayload = JSON.stringify({
        email: userEmail,
        password: 'password123'
    });
    const resLogin = http.post(`${BASE_URL}/auth/login`, loginPayload, {
        headers: HEADERS
    });
    check(resLogin, {
        '[Login] status 200': (r) => r.status === 200,
        '[Login] has user': (r) => {
            const body = JSON.parse(r.body);
            return body.user && !body.token; // No token in new system
        }
    });

    // Extract session cookie for dashboard requests (if needed)
    const sessionCookie = resLogin.cookies['orbicheck_session'] || [];

    // Management API headers with PAT
    const mgmtHeaders = Object.assign({}, HEADERS, {
        'Authorization': `Bearer ${patToken}`,
        'Cache-Control': 'no-cache'
    });

    // Runtime API headers with API key
    const runtimeHeaders = Object.assign({}, HEADERS, {
        'Authorization': `Bearer ${defaultApiKey}`,
        'Cache-Control': 'no-cache'
    });

    // Dashboard requests would use session cookie (not used in this test)
    const dashboardHeaders = Object.assign({}, HEADERS, {
        'Cookie': sessionCookie.length > 0 ? `orbicheck_session=${sessionCookie[0]}` : ''
    });

    // Step 3: List API keys (Management API - use PAT)
    const resListKeys = http.get(`${BASE_URL}/v1/api-keys`, { headers: mgmtHeaders });
    check(resListKeys, {
        '[List API Keys] status 200': (r) => r.status === 200,
        '[List API Keys] is array': (r) => r.status === 200 && Array.isArray(JSON.parse(r.body).data)
    });
    const initialKeys = resListKeys.status === 200 ? JSON.parse(resListKeys.body).data : [];
    console.log('Initial keys count:', initialKeys.length);

    // Step 4: Create API key (Management API - use PAT)
    const createKeyPayload = JSON.stringify({ name: 'k6-test-key' });
    const resCreateKey = http.post(`${BASE_URL}/v1/api-keys`, createKeyPayload, { headers: mgmtHeaders });
    check(resCreateKey, {
        '[Create API Key] status 201': (r) => r.status === 201,
        '[Create API Key] has key': (r) => {
            const body = JSON.parse(r.body);
            return body.full_key && body.id;
        }
    });
    const createBody = resCreateKey.status === 201 ? JSON.parse(resCreateKey.body) : { full_key: null, id: null };
    console.log('Create API Key response:', JSON.stringify(createBody));
    const newApiKey = createBody.full_key;

    // New runtime headers with the newly created API key
    const newRuntimeHeaders = Object.assign({}, HEADERS, {
        'Authorization': `Bearer ${newApiKey}`
    });

    // Step 5: List API keys again (Management API - use PAT)
    const resListKeys2 = http.get(`${BASE_URL}/v1/api-keys`, { headers: mgmtHeaders });
    check(resListKeys2, {
        '[List API Keys After Create] status 200': (r) => r.status === 200,
        '[List API Keys After Create] has one more key': (r) => r.status === 200 && JSON.parse(r.body).data.length === initialKeys.length + 1
    });

    // Step 6-10: Validation endpoints (Runtime API - use API key)
    const emailPayload = JSON.stringify({ email: 'test@example.com' });
    const resValidateEmail = http.post(`${API_V1_URL}/validate/email`, emailPayload, { headers: newRuntimeHeaders });
    check(resValidateEmail, {
        '[Validate Email] status 200': (r) => r.status === 200,
        '[Validate Email] has result': (r) => {
            const body = JSON.parse(r.body);
            return body.valid !== undefined;
        }
    });

    const phonePayload = JSON.stringify({ phone: '+1234567890', request_otp: true });
    const resValidatePhone = http.post(`${API_V1_URL}/validate/phone`, phonePayload, { headers: newRuntimeHeaders });
    check(resValidatePhone, {
        '[Validate Phone] status 200': (r) => r.status === 200,
        '[Validate Phone] has result': (r) => {
            const body = JSON.parse(r.body);
            return body.valid !== undefined;
        }
    });
    const phoneBody = JSON.parse(resValidatePhone.body);
    const verificationSid = phoneBody.verification_sid;

    // Step 10: Verify phone OTP (Runtime API - use API key)
    if (verificationSid) {
        const verifyPayload = JSON.stringify({ verification_sid: verificationSid, code: '123456' });
        const resVerifyPhone = http.post(`${API_V1_URL}/verify/phone`, verifyPayload, { headers: newRuntimeHeaders });
        check(resVerifyPhone, {
            '[Verify Phone] status 200': (r) => r.status === 200,
            '[Verify Phone] has result': (r) => {
                const body = JSON.parse(r.body);
                return body.valid !== undefined;
            }
        });
    }

    const addressPayload = JSON.stringify({
        address: {
            line1: '123 Main St',
            city: 'Anytown',
            postal_code: '12345',
            state: 'CA',
            country: 'US'
        }
    });
    const resValidateAddress = http.post(`${API_V1_URL}/validate/address`, addressPayload, { headers: newRuntimeHeaders });
    check(resValidateAddress, {
        '[Validate Address] status 200': (r) => r.status === 200,
        '[Validate Address] has result': (r) => {
            const body = JSON.parse(r.body);
            return body.valid !== undefined;
        }
    });

    const taxidPayload = JSON.stringify({ type: 'ssn', value: '123-45-6789', country: 'US' });
    const resValidateTaxid = http.post(`${API_V1_URL}/validate/tax-id`, taxidPayload, { headers: newRuntimeHeaders });
    check(resValidateTaxid, {
        '[Validate Tax ID] status 200': (r) => r.status === 200,
        '[Validate Tax ID] has result': (r) => {
            const body = JSON.parse(r.body);
            return body.valid !== undefined;
        }
    });

    // Step 11: Batch validation (Runtime API - use API key)
    const batchValidatePayload = JSON.stringify({
        type: 'email',
        data: ['batch1@example.com', 'batch2@example.com', 'batch3@example.com']
    });
    const resBatchValidate = http.post(`${API_V1_URL}/batch/validate`, batchValidatePayload, { headers: newRuntimeHeaders });
    check(resBatchValidate, {
        '[Batch Validate] status 202': (r) => r.status === 202,
        '[Batch Validate] has job_id': (r) => {
            const body = JSON.parse(r.body);
            return body.job_id && body.status === 'pending';
        }
    });
    const batchValidateBody = JSON.parse(resBatchValidate.body);
    const validateJobId = batchValidateBody.job_id;

    // Step 12: Batch deduplication (Runtime API - use API key)
    const batchDedupePayload = JSON.stringify({
        type: 'customers',
        data: [
            { email: 'batch-customer1@example.com', first_name: 'John', last_name: 'Doe' },
            { email: 'batch-customer2@example.com', first_name: 'Jane', last_name: 'Smith' }
        ]
    });
    const resBatchDedupe = http.post(`${API_V1_URL}/batch/dedupe`, batchDedupePayload, { headers: newRuntimeHeaders });
    check(resBatchDedupe, {
        '[Batch Dedupe] status 202': (r) => r.status === 202,
        '[Batch Dedupe] has job_id': (r) => {
            const body = JSON.parse(r.body);
            return body.job_id && body.status === 'pending';
        }
    });
    const batchDedupeBody = JSON.parse(resBatchDedupe.body);
    const dedupeJobId = batchDedupeBody.job_id;

    // Step 13: Check job status for validation job (Runtime API - use API key)
    if (validateJobId) {
        const resGetValidateJob = http.get(`${API_V1_URL}/jobs/${validateJobId}`, { headers: newRuntimeHeaders });
        check(resGetValidateJob, {
            '[Get Validate Job Status] status 200': (r) => r.status === 200,
            '[Get Validate Job Status] has status': (r) => {
                const body = JSON.parse(r.body);
                return body.status && body.job_id === validateJobId;
            }
        });
    }

    // Step 14: Check job status for dedupe job (Runtime API - use API key)
    if (dedupeJobId) {
        const resGetDedupeJob = http.get(`${API_V1_URL}/jobs/${dedupeJobId}`, { headers: newRuntimeHeaders });
        check(resGetDedupeJob, {
            '[Get Dedupe Job Status] status 200': (r) => r.status === 200,
            '[Get Dedupe Job Status] has status': (r) => {
                const body = JSON.parse(r.body);
                return body.status && body.job_id === dedupeJobId;
            }
        });
    }

    // Step 18-20: Dedupe endpoints (Runtime API - use API key)
    const dedupeCustomerPayload = JSON.stringify({
        email: 'customer@example.com',
        phone: '+1234567890',
        first_name: 'John',
        last_name: 'Doe'
    });
    const resDedupeCustomer = http.post(`${API_V1_URL}/dedupe/customer`, dedupeCustomerPayload, { headers: newRuntimeHeaders });
    check(resDedupeCustomer, {
        '[Dedupe Customer] status 200': (r) => r.status === 200,
        '[Dedupe Customer] has matches': (r) => {
            const body = JSON.parse(r.body);
            return body.matches !== undefined;
        }
    });
    const dedupeCustomerBody = JSON.parse(resDedupeCustomer.body);
    const customerId = dedupeCustomerBody.canonical_id || null;

    // Step 16: Merge deduplicated customers (Runtime API - use API key) - only if there are matches
    if (customerId) {
        const mergeCustomerPayload = JSON.stringify({
            type: 'customer',
            ids: [customerId],
            canonical_id: customerId
        });
        const resMergeCustomer = http.post(`${API_V1_URL}/dedupe/merge`, mergeCustomerPayload, { headers: newRuntimeHeaders });
        check(resMergeCustomer, {
            '[Dedupe Merge Customer] status 200': (r) => r.status === 200,
            '[Dedupe Merge Customer] success': (r) => {
                const body = JSON.parse(r.body);
                return body.success !== undefined;
            }
        });
    }

    const dedupeAddressPayload = JSON.stringify({
        line1: '123 Main St',
        city: 'Anytown',
        postal_code: '12345',
        state: 'CA',
        country: 'US'
    });
    const resDedupeAddress = http.post(`${API_V1_URL}/dedupe/address`, dedupeAddressPayload, { headers: newRuntimeHeaders });
    check(resDedupeAddress, {
        '[Dedupe Address] status 200': (r) => r.status === 200,
        '[Dedupe Address] has matches': (r) => {
            const body = JSON.parse(r.body);
            return body.matches !== undefined;
        }
    });

    // Step 21: Evaluate order (Runtime API - use API key)
    const orderPayload = JSON.stringify({
        order_id: `k6-order-${Date.now()}`,
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
    const resEvaluateOrder = http.post(`${API_V1_URL}/orders/evaluate`, orderPayload, { headers: newRuntimeHeaders });
    check(resEvaluateOrder, {
        '[Evaluate Order] status 200': (r) => r.status === 200,
        '[Evaluate Order] has action': (r) => {
            const body = JSON.parse(r.body);
            return body.action;
        }
    });

    // Step 26-29: Rules endpoints (Management API - use PAT)
    const resGetRules = http.get(`${API_V1_URL}/rules`, { headers: mgmtHeaders });
    check(resGetRules, {
        '[Get Rules] status 200': (r) => r.status === 200,
        '[Get Rules] has rules': (r) => r.status === 200 && Array.isArray(JSON.parse(r.body).rules)
    });

    const resGetCatalog = http.get(`${API_V1_URL}/rules/catalog`, { headers: mgmtHeaders });
    check(resGetCatalog, {
        '[Get Catalog] status 200': (r) => r.status === 200,
        '[Get Catalog] has reason_codes': (r) => {
            const body = JSON.parse(r.body);
            return body && Array.isArray(body.reason_codes);
        }
    });

    const customRulesPayload = JSON.stringify({
        rules: [
            {
                id: 'k6-custom-rule',
                name: 'k6-custom-rule',
                description: 'test rule',
                reason_code: 'test',
                severity: 'low',
                enabled: true
            }
        ]
    });
    const resRegisterRules = http.post(`${API_V1_URL}/rules/register`, customRulesPayload, { headers: mgmtHeaders });
    check(resRegisterRules, {
        '[Register Rules] status 200': (r) => r.status === 200,
        '[Register Rules] success': (r) => {
            const body = JSON.parse(r.body);
            return body.registered_rules && Array.isArray(body.registered_rules);
        }
    });

    // Step 30-31: Data endpoints (Management API - use PAT)
    const resGetLogs = http.get(`${BASE_URL}/v1/data/logs`, { headers: mgmtHeaders });
    check(resGetLogs, {
        '[Get Logs] status 200': (r) => r.status === 200,
        '[Get Logs] is array': (r) => r.status === 200 && Array.isArray(JSON.parse(r.body).data)
    });

    const resGetUsage = http.get(`${BASE_URL}/v1/data/usage`, { headers: mgmtHeaders });
    check(resGetUsage, {
        '[Get Usage] status 200': (r) => r.status === 200,
        '[Get Usage] has data': (r) => r.status === 200 && (() => { const body = JSON.parse(r.body); return body && typeof body === 'object'; })()
    });

    // Step 32: List webhooks (Management API - use PAT)
    const resListWebhooks = http.get(`${BASE_URL}/v1/webhooks`, { headers: mgmtHeaders });
    check(resListWebhooks, {
        '[List Webhooks] status 200': (r) => r.status === 200,
        '[List Webhooks] is array': (r) => r.status === 200 && Array.isArray(JSON.parse(r.body).data)
    });
    const initialWebhooks = resListWebhooks.status === 200 ? JSON.parse(resListWebhooks.body).data : [];
    console.log('Initial webhooks count:', initialWebhooks.length);

    // Step 33: Create webhook (Management API - use PAT)
    const createWebhookPayload = JSON.stringify({
        url: 'https://httpbin.org/post',
        events: ['validation_result', 'order_evaluated']
    });
    const resCreateWebhook = http.post(`${BASE_URL}/v1/webhooks`, createWebhookPayload, { headers: mgmtHeaders });
    check(resCreateWebhook, {
        '[Create Webhook] status 201': (r) => r.status === 201,
        '[Create Webhook] has webhook': (r) => {
            const body = JSON.parse(r.body);
            return body.id && body.url && body.events;
        }
    });
    const createWebhookBody = resCreateWebhook.status === 201 ? JSON.parse(resCreateWebhook.body) : { id: null };
    console.log('Create Webhook response:', JSON.stringify(createWebhookBody));
    const webhookId = createWebhookBody.id;

    // Step 34: List webhooks again (Management API - use PAT)
    const resListWebhooks2 = http.get(`${BASE_URL}/v1/webhooks`, { headers: mgmtHeaders });
    check(resListWebhooks2, {
        '[List Webhooks After Create] status 200': (r) => r.status === 200,
        '[List Webhooks After Create] has one more webhook': (r) => r.status === 200 && JSON.parse(r.body).data.length === initialWebhooks.length + 1
    });

    // Step 35: Delete webhook (Management API - use PAT)
    if (webhookId) {
        const resDeleteWebhook = http.del(`${BASE_URL}/v1/webhooks/${webhookId}`, null, { headers: Object.assign({}, NO_BODY_HEADERS, { 'Authorization': `Bearer ${patToken}` }) });
        check(resDeleteWebhook, {
            '[Delete Webhook] status 200': (r) => r.status === 200
        });
    }

    // Step 36: List webhooks after delete (Management API - use PAT)
    const resListWebhooks3 = http.get(`${BASE_URL}/v1/webhooks`, { headers: mgmtHeaders });
    check(resListWebhooks3, {
        '[List Webhooks After Delete] status 200': (r) => r.status === 200,
        '[List Webhooks After Delete] back to initial count': (r) => r.status === 200 && JSON.parse(r.body).data.length === initialWebhooks.length
    });

    // Step 37: Test webhook (Management API - use PAT)
    const webhookPayload = JSON.stringify({ url: 'https://httpbin.org/post', payload_type: 'validation' });
    const resTestWebhook = http.post(`${BASE_URL}/v1/webhooks/test`, webhookPayload, { headers: mgmtHeaders });
    check(resTestWebhook, {
        '[Test Webhook] status 200': (r) => r.status === 200,
        '[Test Webhook] success': (r) => {
            const body = JSON.parse(r.body);
            return body.response && body.response.status === 200;
        }
    });

    // Step 38: Revoke API key (Management API - use PAT)
    const keyId = createBody.id;
    const resRevokeKey = http.del(`${BASE_URL}/v1/api-keys/${keyId}`, null, { headers: Object.assign({}, NO_BODY_HEADERS, { 'Authorization': `Bearer ${patToken}` }) });
    check(resRevokeKey, {
        '[Revoke API Key] status 200': (r) => r.status === 200
    });

    // Step 39: List API keys to verify revocation (Management API - use PAT)
    const resListKeys3 = http.get(`${BASE_URL}/v1/api-keys`, { headers: mgmtHeaders });
    check(resListKeys3, {
        '[List API Keys After Revoke] status 200': (r) => r.status === 200,
        '[List API Keys After Revoke] still has revoked key': (r) => r.status === 200 && JSON.parse(r.body).data.length === initialKeys.length + 1
    });

    // Step 40: Test HMAC authentication (optional) - Runtime API
    const timestamp = Date.now().toString();
    const nonce = Math.random().toString(36).substring(7);

    // For HMAC, you'd need to compute the signature client-side
    // This is a simplified example - in practice you'd compute HMAC-SHA256
    const hmacHeaders = Object.assign({}, HEADERS, {
        'Authorization': `HMAC keyId=${newApiKey.slice(0, 6)} signature=test_sig ts=${timestamp} nonce=${nonce}`
    });

    // Test with HMAC (will fail without proper signature, but shows the format)
    const resHmacTest = http.post(`${API_V1_URL}/validate/email`, emailPayload, { headers: hmacHeaders });
    console.log('HMAC test status:', resHmacTest.status); // Expected to fail without proper signature

    // Step 36: Logout (clears session)
    const resLogout = http.post(`${BASE_URL}/auth/logout`, null, {
        headers: Object.assign({}, NO_BODY_HEADERS, {
            'Cookie': sessionCookie.length > 0 ? `orbicheck_session=${sessionCookie[0]}` : ''
        })
    });
    check(resLogout, {
        '[Logout] status 200': (r) => r.status === 200
    });

    console.log('k6 journey test with new authentication completed successfully!');
    sleep(0.1);
}