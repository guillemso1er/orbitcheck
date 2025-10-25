import { check as k6check, sleep } from 'k6';
import exec from 'k6/x/exec'; // Import the exec module for container management
import { testNormalizeAddress, testValidateAddress } from './address.js';
import { testCreateApiKey, testCreatePat, testHmacAuth, testListApiKeys, testListApiKeysAfterCreate, testListApiKeysAfterRevoke, testListPats, testListPatsAfterRevoke, testLogin, testLogout, testRegister, testRevokeApiKey, testRevokePat } from './auth.js';
import { testBatchDedupe, testDedupeAddressSimple, testDedupeCustomer, testDedupeMergeCustomer, testGetDedupeJobStatus } from './dedupe.js';
import { testBatchValidate, testGetValidateJobStatus, testValidateEmail } from './email.js';
import { testDeleteLog, testEraseData, testGetLogs, testGetLogsForDelete } from './logs.js';
import { testEvaluateOrder } from './order.js';
import { testValidatePhoneSimple, testVerifyPhone } from './phone.js';
import { testGetRulesCatalog, testGetRulesErrorCodes, testGetRulesFirst, testRegisterRules, testTestRules } from './rules.js';
import { testGetSettings, testUpdateSettings } from './settings.js';
import { testValidateName, testValidateTaxid } from './taxid.js';
import { testGetUsage } from './usage.js';
import { testCreateWebhook, testDeleteWebhook, testListWebhooks, testListWebhooksAfterCreate, testListWebhooksAfterDelete, testTestWebhook } from './webhook.js';

// --- Life Cycle Functions for Container Management ---

export function setup() {
    console.log('Setting up test environment...');

    // --- Preemptive Cleanup ---
    // This is the robust way to ensure cleanup commands don't halt the script on failure.
    // We run the podman command inside a shell ('sh -c'). The '|| true' guarantees that
    // the shell command line always exits with code 0 (success), even if the podman
    // command fails (e.g., because the container doesn't exist).
    console.log('Performing preemptive cleanup of old containers...');
    exec.command('sh', ['-c', 'podman stop httpbin || true']);
    exec.command('sh', ['-c', 'podman rm httpbin || true']);


    // --- Image and Container Setup ---

    console.log('Ensuring mccutchen/go-httpbin container image is available...');
    // The pull command should succeed, so we don't need the wrapper here.
    exec.command('podman', ['pull', 'mccutchen/go-httpbin']);

    console.log('Starting httpbin container for webhook tests...');
    const commandOutput = exec.command('podman', ['run', '-d', '--rm', '--name', 'httpbin', '-p', '8054:8080', 'mccutchen/go-httpbin']);

    // Check for actual errors during the critical container startup
    if (commandOutput.includes('Error')) {
        throw new Error(`Failed to start container: ${commandOutput}`);
    }

    console.log('Container started successfully.');
    sleep(2); // Give the container more time to initialize.
}

export function teardown() {
    console.log('Tearing down test environment...');

    // Stop and remove the httpbin container. It's good practice
    // to use the robust shell wrapper here as well.
    exec.command('sh', ['-c', 'podman stop httpbin || true']);
    exec.command('sh', ['-c', 'podman rm httpbin || true']);

    console.log('Container stopped and removed.');
}


// --- Test Options ---

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        'checks': ['rate>0.95'], // Adjusted for better accuracy
        'http_req_duration': ['p(95)<2000', 'p(50)<1000']
    }
};

// --- Main Test Function ---

export default function () {
    const check = k6check;

    console.log('Starting k6 comprehensive journey test with new auth...');

    // Step 1: Register a new user
    const { patToken, defaultApiKey, email: userEmail } = testRegister(check);

    // Step 2: Login
    const { res: resLogin } = testLogin(userEmail, check);
    const sessionCookie = resLogin.cookies['orbitcheck_session'] || [];

    // --- Define Headers ---
    const HEADERS = { 'Content-Type': 'application/json' };
    const mgmtHeaders = Object.assign({}, HEADERS, { 'Authorization': `Bearer ${patToken}`, 'Cache-Control': 'no-cache' });
    const runtimeHeaders = Object.assign({}, HEADERS, { 'Authorization': `Bearer ${defaultApiKey}`, 'Cache-Control': 'no-cache' });

    // Step 3: List PATs
    testListPats(patToken, check);

    // Step 4: Create a new PAT
    const { pat: newPat, tokenId: newPatTokenId } = testCreatePat(patToken, check);

    // Step 5: List PATs after creation
    testListPats(patToken, check);

    // Step 6: List API keys
    testListApiKeys(patToken, check);

    // Step 4: Create API key
    const { newApiKey, keyId } = testCreateApiKey(patToken, check);
    const newRuntimeHeaders = Object.assign({}, HEADERS, { 'Authorization': `Bearer ${newApiKey}` });

    // Step 5: List API keys again
    testListApiKeysAfterCreate(patToken, check);

    // Step 6-10: Validation endpoints
    testValidateEmail(newRuntimeHeaders, check);
    const verificationSid = testValidatePhoneSimple(newRuntimeHeaders, check);
    if (verificationSid) {
        testVerifyPhone(newRuntimeHeaders, check, verificationSid);
    }
    testValidateAddress(newRuntimeHeaders, check);
    testNormalizeAddress(newRuntimeHeaders, check);
    testValidateTaxid(newRuntimeHeaders, check);
    testValidateName(newRuntimeHeaders, check);

    // Step 11-14: Batch Jobs
    const validateJobId = testBatchValidate(newRuntimeHeaders, check);
    const dedupeJobId = testBatchDedupe(newRuntimeHeaders, check);
    if (validateJobId) {
        testGetValidateJobStatus(validateJobId, newRuntimeHeaders, check);
    }
    if (dedupeJobId) {
        testGetDedupeJobStatus(dedupeJobId, newRuntimeHeaders, check);
    }

    // Step 18-20: Dedupe endpoints
    const customerId = testDedupeCustomer(newRuntimeHeaders, check);
    if (customerId) {
        testDedupeMergeCustomer(customerId, newRuntimeHeaders, check);
    }
    testDedupeAddressSimple(newRuntimeHeaders, check);

    // Step 21: Evaluate order
    testEvaluateOrder(newRuntimeHeaders, check);

    // Step 26-29: Rules endpoints
    testGetRulesFirst(mgmtHeaders, check);
    testGetRulesCatalog(mgmtHeaders, check);
    testGetRulesErrorCodes(mgmtHeaders, check);
    testRegisterRules(mgmtHeaders, check);
    testTestRules(mgmtHeaders, check);

    // Step 30-31: Data endpoints
    testGetLogs(mgmtHeaders, check);
    testGetUsage(mgmtHeaders, check);

    // --- Settings and Logs Management ---
    testGetSettings(mgmtHeaders, check);
    testUpdateSettings(mgmtHeaders, check);
    testValidateEmail(newRuntimeHeaders, check); // Create a log for deletion
    const logToDelete = testGetLogsForDelete(mgmtHeaders, check);
    if (logToDelete) {
        testDeleteLog(logToDelete, mgmtHeaders, check);
    }
    testEraseData(mgmtHeaders, check);

    // --- Webhook Management ---
    console.log('--- Starting Webhook Tests ---');
    testListWebhooks(mgmtHeaders, check);
    const webhook = testCreateWebhook(mgmtHeaders, check);
    const webhookId = webhook ? webhook.id : null;
    console.log('Created webhook with id:', webhookId);
    if (webhookId) {
        testListWebhooksAfterCreate(mgmtHeaders, check);
        testDeleteWebhook(mgmtHeaders, check, webhookId);
        testListWebhooksAfterDelete(mgmtHeaders, check);
    }
    testTestWebhook(mgmtHeaders, check);
    console.log('--- Webhook Tests Completed ---');

    // Step 38: Test HMAC authentication
    testHmacAuth(newApiKey, check);

    // Step 39: Revoke API key
    if (keyId) {
        testRevokeApiKey(patToken, keyId, check);
    }

    // Step 40: List API keys to verify revocation
    testListApiKeysAfterRevoke(patToken, check);

    // Step 41: Revoke PAT
    if (newPatTokenId) {
        testRevokePat(patToken, newPatTokenId, check);
    }

    // Step 42: List PATs after revocation
    testListPatsAfterRevoke(patToken, check);

    // Step 43: Logout
    testLogout(check);

    console.log('k6 journey test completed successfully!');
    sleep(0.1);
}