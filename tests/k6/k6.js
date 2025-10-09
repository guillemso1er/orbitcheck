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

    // Step 12-14: Dedupe endpoints (Runtime API - use API key)
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

    // Step 11: Merge deduplicated customers (Runtime API - use API key) - only if there are matches
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

    // Step 15: Evaluate order (Runtime API - use API key)
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

    // Step 16-19: Rules endpoints (Management API - use PAT)
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

    // Step 20-21: Data endpoints (Management API - use PAT)
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

    // Step 22: Test webhook (Management API - use PAT)
    const webhookPayload = JSON.stringify({ url: 'https://httpbin.org/post', payload_type: 'validation' });
    const resTestWebhook = http.post(`${BASE_URL}/v1/webhooks/test`, webhookPayload, { headers: mgmtHeaders });
    check(resTestWebhook, {
        '[Test Webhook] status 200': (r) => r.status === 200,
        '[Test Webhook] success': (r) => {
            const body = JSON.parse(r.body);
            return body.response && body.response.status === 200;
        }
    });

    // Step 23: Revoke API key (Management API - use PAT)
    const keyId = createBody.id;
    const resRevokeKey = http.del(`${BASE_URL}/v1/api-keys/${keyId}`, null, { headers: Object.assign({}, NO_BODY_HEADERS, { 'Authorization': `Bearer ${patToken}` }) });
    check(resRevokeKey, {
        '[Revoke API Key] status 200': (r) => r.status === 200
    });

    // Step 24: List API keys to verify revocation (Management API - use PAT)
    const resListKeys3 = http.get(`${BASE_URL}/v1/api-keys`, { headers: mgmtHeaders });
    check(resListKeys3, {
        '[List API Keys After Revoke] status 200': (r) => r.status === 200,
        '[List API Keys After Revoke] still has revoked key': (r) => r.status === 200 && JSON.parse(r.body).data.length === initialKeys.length + 1
    });

    // Step 25: Test HMAC authentication (optional) - Runtime API
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

    // Step 26: Logout (clears session)
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