import { check as k6check, sleep } from 'k6';
import http from 'k6/http';
import { getHeaders } from './auth-utils.js';

export const options = {
    vus: 50,
    duration: '1m',
    thresholds: {
        'checks': ['rate>0.99'],
        http_req_duration: ['p(95)<200', 'p(50)<50']
    }
};

const BASE_URL = 'http://localhost:8080/v1';

export function testNoMatchFirst(check) {
    const timestamp = Date.now();
    const payload = JSON.stringify({
        email: `newuser${timestamp}@example.com`,
        first_name: 'John',
        last_name: 'Doe',
        phone: '+1234567890'
    });
    let res = http.post(`${BASE_URL}/dedupe/customer`, payload, { headers: getHeaders() });
    check(res, {
        '[No Match] status 200 (first req)': (r) => r.status === 200,
        '[No Match] matches empty (first req)': (r) => {
            if (r.status !== 200) return false;
            try {
                const body = JSON.parse(r.body);
                return Array.isArray(body.matches) && body.matches.length === 0;
            } catch (e) {
                return false;
            }
        },
        '[No Match] suggested_action create_new (first req)': (r) => {
            if (r.status !== 200) return false;
            try {
                const body = JSON.parse(r.body);
                return body.suggested_action === 'create_new';
            } catch (e) {
                return false;
            }
        }
    });
}

export function testNoMatchSecond(check) {
    const timestamp = Date.now();
    const payload = JSON.stringify({
        email: `newuser${timestamp}@example.com`,
        first_name: 'John',
        last_name: 'Doe',
        phone: '+1234567890'
    });
    // Second request for the same data. THIS MUST be a HIT.
    const res = http.post(`${BASE_URL}/dedupe/customer`, payload, { headers: getHeaders() });
    check(res, {
        '[No Match] status 200 HIT': (r) => r.status === 200,
        '[No Match] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });
}

export function testFuzzyMatchFirst(check) {
    const timestamp = Date.now();
    const payload = JSON.stringify({
        email: `fuzzy${timestamp}@example.com`,
        first_name: 'Jane',
        last_name: 'Smith'
    });
    let res = http.post(`${BASE_URL}/dedupe/customer`, payload, { headers: getHeaders() });
    check(res, {
        '[Fuzzy] status 200 (first req)': (r) => r.status === 200,
        '[Fuzzy] response structure (first req)': (r) => {
            if (r.status !== 200) return false;
            try {
                const body = JSON.parse(r.body);
                return body.matches !== undefined && body.suggested_action !== undefined;
            } catch (e) {
                return false;
            }
        }
    });
}

export function testFuzzyMatchSecond(check) {
    const timestamp = Date.now();
    const payload = JSON.stringify({
        email: `fuzzy${timestamp}@example.com`,
        first_name: 'Jane',
        last_name: 'Smith'
    });
    // Second request, check for HIT.
    const res = http.post(`${BASE_URL}/dedupe/customer`, payload, { headers: getHeaders() });
    check(res, {
        '[Fuzzy] status 200 HIT': (r) => r.status === 200,
        '[Fuzzy] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });
}

export function testExactMatchFirst(check) {
    const timestamp = Date.now();
    const payload = JSON.stringify({
        email: `existing${timestamp}@example.com`,
        first_name: 'Existing',
        last_name: 'User'
    });
    let res = http.post(`${BASE_URL}/dedupe/customer`, payload, { headers: getHeaders() });
    check(res, {
        '[Exact] status 200 (first req)': (r) => r.status === 200,
        '[Exact] matches empty (first req)': (r) => {
            if (r.status !== 200) return false;
            try {
                const body = JSON.parse(r.body);
                return Array.isArray(body.matches) && body.matches.length === 0;
            } catch (e) {
                return false;
            }
        },
        '[Exact] suggested_action create_new (first req)': (r) => {
            if (r.status !== 200) return false;
            try {
                const body = JSON.parse(r.body);
                return body.suggested_action === 'create_new';
            } catch (e) {
                return false;
            }
        }
    });
}

export function testExactMatchSecond(check) {
    const timestamp = Date.now();
    const payload = JSON.stringify({
        email: `existing${timestamp}@example.com`,
        first_name: 'Existing',
        last_name: 'User'
    });
    // Second request, check for HIT.
    const res = http.post(`${BASE_URL}/dedupe/customer`, payload, { headers: getHeaders() });
    check(res, {
        '[Exact] status 200 HIT': (r) => r.status === 200,
        '[Exact] cache HIT': (r) => (r.headers['Cache-Status'] || '').toLowerCase().includes('hit')
    });
}

export function testDedupeAddress(check) {
    const payload = JSON.stringify({
        line1: '123 Main St',
        city: 'Anytown',
        postal_code: '12345',
        country: 'US'
    });
    const res = http.post(`${BASE_URL}/dedupe/address`, payload, { headers: getHeaders() });
    check(res, {
        '[Address Dedupe] status 200': (r) => r.status === 200,
        '[Address Dedupe] has matches and action': (r) => {
            if (r.status !== 200) return false;
            try {
                const body = JSON.parse(r.body);
                return body.matches !== undefined && body.suggested_action;
            } catch (e) {
                return false;
            }
        }
    });
}

export function testDedupeCustomer(headers, check) {
    const dedupeCustomerPayload = JSON.stringify({
        email: 'customer@example.com',
        phone: '+1234567890',
        first_name: 'John',
        last_name: 'Doe'
    });
    const res = http.post(`${BASE_URL}/dedupe/customer`, dedupeCustomerPayload, { headers });
    check(res, {
        '[Dedupe Customer] status 200': (r) => r.status === 200,
        '[Dedupe Customer] has matches': (r) => {
            const body = JSON.parse(r.body);
            return body.matches !== undefined;
        }
    });
    const dedupeCustomerBody = JSON.parse(res.body);
    return dedupeCustomerBody.canonical_id || null;
}

export function testDedupeMergeCustomer(customerId, headers, check) {
    if (!customerId) return;
    const mergeCustomerPayload = JSON.stringify({
        type: 'customer',
        ids: [customerId],
        canonical_id: customerId
    });
    const res = http.post(`${BASE_URL}/dedupe/merge`, mergeCustomerPayload, { headers });
    check(res, {
        '[Dedupe Merge Customer] status 200': (r) => r.status === 200,
        '[Dedupe Merge Customer] success': (r) => {
            const body = JSON.parse(r.body);
            return body.success !== undefined;
        }
    });
}

export function testBatchDedupe(headers, check) {
    const batchDedupePayload = JSON.stringify({
        type: 'customers',
        data: [
            { email: 'batch-customer1@example.com', first_name: 'John', last_name: 'Doe' },
            { email: 'batch-customer2@example.com', first_name: 'Jane', last_name: 'Smith' }
        ]
    });
    const res = http.post(`${BASE_URL}/batch/dedupe`, batchDedupePayload, { headers });
    check(res, {
        '[Batch Dedupe] status 202': (r) => r.status === 202,
        '[Batch Dedupe] has job_id': (r) => {
            const body = JSON.parse(r.body);
            return body.job_id && body.status === 'pending';
        }
    });
    const batchDedupeBody = JSON.parse(res.body);
    return batchDedupeBody.job_id;
}

export function testGetDedupeJobStatus(jobId, headers, check) {
    if (!jobId) return;
    const res = http.get(`${BASE_URL}/jobs/${jobId}`, { headers });
    check(res, {
        '[Get Dedupe Job Status] status 200': (r) => r.status === 200,
        '[Get Dedupe Job Status] has status': (r) => {
            const body = JSON.parse(r.body);
            return body.status && body.job_id === jobId;
        }
    });
}

export function testDedupeAddressSimple(headers, check) {
    const dedupeAddressPayload = JSON.stringify({
        line1: '123 Main St',
        city: 'Anytown',
        postal_code: '12345',
        state: 'CA',
        country: 'US'
    });
    const res = http.post(`${BASE_URL}/dedupe/address`, dedupeAddressPayload, { headers });
    check(res, {
        '[Dedupe Address] status 200': (r) => r.status === 200,
        '[Dedupe Address] has matches': (r) => {
            const body = JSON.parse(r.body);
            return body.matches !== undefined;
        }
    });
}

export function testMerge(check) {
    const payload = JSON.stringify({
        type: 'customer',
        ids: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
        canonical_id: '00000000-0000-0000-0000-000000000001'
    });
    const res = http.post(`${BASE_URL}/dedupe/merge`, payload, { headers: getHeaders() });
    check(res, {
        '[Merge] status is 200 or expected error': (r) => r.status === 200 || r.status === 400
    });
}

export default function (check) {
    // If check is not provided (when running this file directly),
    // use the original k6check as a fallback.
    check = check || k6check;

    // Dedupe customer
    const customerId = testDedupeCustomer(check);

    // Dedupe merge customer
    testDedupeMergeCustomer(customerId, check);

    // Dedupe address
    testDedupeAddressSimple(check);

    // Batch dedupe
    const dedupeJobId = testBatchDedupe(check);

    // Get dedupe job status
    testGetDedupeJobStatus(dedupeJobId, check);

    // Scenario 1: Test dedupe with no matches (new customer)
    testNoMatchFirst(check);
    testNoMatchSecond(check);

    // Scenario 2: Test dedupe with potential fuzzy match
    testFuzzyMatchFirst(check);
    testFuzzyMatchSecond(check);

    // Scenario 3: Test dedupe with exact email match
    testExactMatchFirst(check);
    testExactMatchSecond(check);

    // Scenario 4: Test dedupe address (old)
    testDedupeAddress(check);

    // Scenario 5: Test dedupe merge (assuming some IDs exist, but since it's new, might fail or be empty)
    testMerge(check);

    sleep(0.1);
}
