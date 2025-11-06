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



export function testValidateEmail(headers, check) {
    const emailPayload = JSON.stringify({ email: 'test@example.com' });
    const res = http.post(`${API_V1_URL}/validate/email`, emailPayload, { headers });
    check(res, {
        '[Validate Email] status 200': (r) => r.status === 200,
        '[Validate Email] has result': (r) => {
            if (r.status !== 200) return false;
            try {
                const body = JSON.parse(r.body);
                console.log('Validate Email Response Body:', body);
                return body.valid !== undefined;
            } catch (e) {
                return false;
            }
        }
    });
}

export function testValidateEmailWithHeaders(check) {
    const headers = getHeaders('POST', '/v1/validate/email', JSON.stringify({ email: 'test@example.com' }));
    return testValidateEmail(headers, check);
}

export function testBatchValidate(headers, check) {
    const batchValidatePayload = JSON.stringify({
        type: 'email',
        data: ['batch1@example.com', 'batch2@example.com', 'batch3@example.com']
    });
    const res = http.post(`${API_V1_URL}/batch/validate`, batchValidatePayload, { headers });
    check(res, {
        '[Batch Validate] status 202': (r) => r.status === 202,
        '[Batch Validate] has job_id': (r) => {
            const body = JSON.parse(r.body);
            return body.job_id && body.status === 'pending';
        }
    });
    const batchValidateBody = JSON.parse(res.body);
    return batchValidateBody.job_id;
}

export function testBatchValidateWithHeaders(check) {
    const batchValidatePayload = JSON.stringify({
        type: 'email',
        data: ['batch1@example.com', 'batch2@example.com', 'batch3@example.com']
    });
    const headers = getHeaders('POST', '/v1/batch/validate', batchValidatePayload);
    return testBatchValidate(headers, check);
}

export function testGetValidateJobStatus(jobId, headers, check) {
    if (!jobId) return;

    // Poll for job completion (up to 10 seconds)
    let attempts = 0;
    const maxAttempts = 20;
    let jobCompleted = false;

    while (attempts < maxAttempts && !jobCompleted) {
        const res = http.get(`${API_V1_URL}/jobs/${jobId}`, { headers });
        if (res.status === 200) {
            try {
                const body = JSON.parse(res.body);
                if (body.status === 'completed' || body.status === 'failed') {
                    jobCompleted = true;
                    check(res, {
                        '[Get Validate Job Status] status 200': (r) => r.status === 200,
                        '[Get Validate Job Status] has status': (r) => {
                            const body = JSON.parse(r.body);
                            return body.status && body.job_id === jobId;
                        }
                    });
                    break;
                }
            } catch (e) {
                // ignore parse errors
            }
        }
        attempts++;
        sleep(0.5); // Wait 500ms between polls
    }

    // If we didn't get a completed job, still check what we have
    if (!jobCompleted) {
        const res = http.get(`${API_V1_URL}/jobs/${jobId}`, { headers });
        check(res, {
            '[Get Validate Job Status] status 200': (r) => r.status === 200,
            '[Get Validate Job Status] has status': (r) => {
                const body = JSON.parse(r.body);
                return body.status && body.job_id === jobId;
            }
        });
    }
}

export function testGetValidateJobStatusWithHeaders(jobId, check) {
    if (!jobId) return;
    const headers = getHeaders('GET', `/v1/jobs/${jobId}`);
    return testGetValidateJobStatus(jobId, headers, check);
}

export default function (check) {
    // If check is not provided (when running this file directly),
    // use the original k6check as a fallback.
    check = check || k6check;

    // Validate email
    testValidateEmailWithHeaders(check);

    // Batch validate email
    const validateJobId = testBatchValidateWithHeaders(check);

    // Get job status
    testGetValidateJobStatusWithHeaders(validateJobId, check);

    sleep(0.1);
}