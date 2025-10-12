import { check as k6check, sleep } from 'k6';
import http from 'k6/http';
import { testRegister, testLogin, testListApiKeys, testCreateApiKey, testListApiKeysAfterCreate, testRevokeApiKey, testListApiKeysAfterRevoke, testLogout, testHmacAuth } from './auth.js';
import { testValidateEmail, testBatchValidate, testGetValidateJobStatus } from './email.js';
import { testValidatePhoneSimple, testVerifyPhone } from './phone.js';
import { testValidateAddress } from './address.js';
import { testValidateTaxid } from './taxid.js';
import { testEvaluateOrder } from './order.js';
import { testGetRulesFirst, testGetRulesCatalog, testRegisterRules } from './rules.js';
import { testGetLogs, testGetLogsForDelete, testDeleteLog, testEraseData } from './logs.js';
import { testGetUsage } from './usage.js';
import { testGetSettings, testUpdateSettings } from './settings.js';
import { testDedupeCustomer, testDedupeMergeCustomer, testBatchDedupe, testGetDedupeJobStatus, testDedupeAddressSimple } from './dedupe.js';
import { testListWebhooks, testCreateWebhook, testListWebhooksAfterCreate, testDeleteWebhook, testTestWebhook, testListWebhooksAfterDelete } from './webhook.js';

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
    const { patToken, defaultApiKey, email: userEmail } = testRegister(check);

    // Step 2: Login - Sets session cookie (for dashboard), no token returned
    const { res: resLogin } = testLogin(userEmail, check);

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
    const initialKeys = testListApiKeys(patToken, check);
    console.log('Initial keys count:', initialKeys.length);

    // Step 4: Create API key (Management API - use PAT)
    const { newApiKey, keyId } = testCreateApiKey(patToken, check);
    console.log('Create API Key response:', JSON.stringify({ newApiKey, keyId }));

    // New runtime headers with the newly created API key
    const newRuntimeHeaders = Object.assign({}, HEADERS, {
        'Authorization': `Bearer ${newApiKey}`
    });

    // Step 5: List API keys again (Management API - use PAT)
    testListApiKeysAfterCreate(patToken, check);

    // Step 6-10: Validation endpoints (Runtime API - use API key)
    testValidateEmail(newRuntimeHeaders, check);

    const verificationSid = testValidatePhoneSimple(newRuntimeHeaders, check);

    // Step 10: Verify phone OTP (Runtime API - use API key)
    if (verificationSid) {
        testVerifyPhone(newRuntimeHeaders, check, verificationSid);
    }

    testValidateAddress(newRuntimeHeaders, check);

    testValidateTaxid(newRuntimeHeaders, check);

    // Step 11: Batch validation (Runtime API - use API key)
    const validateJobId = testBatchValidate(newRuntimeHeaders, check);

    // Step 12: Batch deduplication (Runtime API - use API key)
    const dedupeJobId = testBatchDedupe(newRuntimeHeaders, check);

    // Step 13: Check job status for validation job (Runtime API - use API key)
    if (validateJobId) {
        testGetValidateJobStatus(validateJobId, newRuntimeHeaders, check);
    }

    // Step 14: Check job status for dedupe job (Runtime API - use API key)
    if (dedupeJobId) {
        testGetDedupeJobStatus(dedupeJobId, newRuntimeHeaders, check);
    }

    // Step 18-20: Dedupe endpoints (Runtime API - use API key)
    const customerId = testDedupeCustomer(newRuntimeHeaders, check);

    // Step 16: Merge deduplicated customers (Runtime API - use API key) - only if there are matches
    if (customerId) {
        testDedupeMergeCustomer(customerId, newRuntimeHeaders, check);
    }

    testDedupeAddressSimple(newRuntimeHeaders, check);

    // Step 21: Evaluate order (Runtime API - use API key)
    testEvaluateOrder(newRuntimeHeaders, check);

    // Step 26-29: Rules endpoints (Management API - use PAT)
    testGetRulesFirst(mgmtHeaders, check);
    testGetRulesCatalog(mgmtHeaders, check);
    testRegisterRules(mgmtHeaders, check);

    // Step 30-31: Data endpoints (Management API - use PAT)
    testGetLogs(mgmtHeaders, check);
    testGetUsage(mgmtHeaders, check);

    // Step 30b: Get tenant settings (Management API - use PAT)
    testGetSettings(mgmtHeaders, check);

    // Step 30c: Update tenant settings (Management API - use PAT)
    testUpdateSettings(mgmtHeaders, check);

    // Step 30d: Create a log entry for deletion test (Runtime API - use API key)
    testValidateEmail(newRuntimeHeaders, check);

    // Step 30e: Get logs to find one to delete (Management API - use PAT)
    const logToDelete = testGetLogsForDelete(mgmtHeaders, check);

    // Step 30f: Delete a log entry (Management API - use PAT)
    if (logToDelete) {
        testDeleteLog(logToDelete, mgmtHeaders, check);
    }

    // Step 30g: Erase user data (Management API - use PAT)
    testEraseData(mgmtHeaders, check);

    // Step 32: List webhooks (Management API - use PAT)
    const initialWebhooks = testListWebhooks(mgmtHeaders, check);
    console.log('Initial webhooks count:', initialWebhooks.length);

    // Step 33: Create webhook (Management API - use PAT)
    const webhookId = testCreateWebhook(mgmtHeaders, check);
    console.log('Created webhook with id:', webhookId);

    // Step 34: List webhooks again (Management API - use PAT)
    testListWebhooksAfterCreate(mgmtHeaders, check);

    // Step 35: Delete webhook (Management API - use PAT)
    if (webhookId) {
        testDeleteWebhook(mgmtHeaders, check, webhookId);
    }

    // Step 36: List webhooks after delete (Management API - use PAT)
    testListWebhooksAfterDelete(mgmtHeaders, check);

    // Step 37: Test webhook (Management API - use PAT)
    testTestWebhook(mgmtHeaders, check);

    // Step 38: Revoke API key (Management API - use PAT)
    if (keyId) {
        testRevokeApiKey(patToken, keyId, check);
    }

    // Step 39: List API keys to verify revocation (Management API - use PAT)
    testListApiKeysAfterRevoke(patToken, check);

    // Step 40: Test HMAC authentication (optional) - Runtime API
    testHmacAuth(newApiKey, check);

    // Step 36: Logout (clears session)
    testLogout(check);

    console.log('k6 journey test with new authentication completed successfully!');
    sleep(0.1);
}