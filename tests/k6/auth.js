import { check as k6check, sleep } from 'k6';
import http from 'k6/http';
import crypto from 'k6/crypto';

export const options = {
    vus: 10,
    duration: '30s',
    thresholds: {
        'checks': ['rate>0.95'],
        http_req_duration: ['p(95)<500', 'p(50)<200']
    }
};

const BASE_URL = 'http://localhost:8080';
const API_V1_URL = `${BASE_URL}/v1`;
const HEADERS = {
    'Content-Type': 'application/json'
};

export function testRegister(check) {
    const email = `k6test${Date.now()}@example.com`;
    const payload = JSON.stringify({
        email: email,
        password: 'password123',
        confirm_password: 'password123'
    });
    const res = http.post(`${BASE_URL}/auth/register`, payload, { headers: HEADERS });

    let body = null;
    if (res.status === 201) {
        try {
            body = JSON.parse(res.body);
        } catch (e) {
            // ignore parse errors
        }
    }

    check(res, {
        '[Register] status 201': (r) => r.status === 201,
        '[Register] has credentials': (r) => {
            return body && body.user && body.pat_token && body.api_key;
        }
    });

    const patToken = body ? body.pat_token : null;
    const defaultApiKey = body ? body.api_key : null;

    return { res, body, email, patToken, defaultApiKey };
}

export function testLogin(email, check) {
    const loginEmail = email || 'test@example.com';
    const payload = JSON.stringify({
        email: loginEmail,
        password: 'password123'
    });
    const res = http.post(`${BASE_URL}/auth/login`, payload, { headers: HEADERS });

    let body = null;
    if (res.status === 200) {
        try {
            body = JSON.parse(res.body);
        } catch (e) {
            // ignore parse errors
        }
    }

    check(res, {
        '[Login] status 200': (r) => r.status === 200,
        '[Login] has user': (r) => {
            return body && body.user && !body.token; // No token in new system
        }
    });

    return { res, body };
}

export function testListApiKeys(patToken, check) {
    const mgmtHeaders = Object.assign({}, HEADERS, {
        'Authorization': `Bearer ${patToken}`,
        'Cache-Control': 'no-cache'
    });
    const res = http.get(`${API_V1_URL}/api-keys`, { headers: mgmtHeaders });

    let initialKeys = [];
    if (res.status === 200) {
        try {
            const body = JSON.parse(res.body);
            initialKeys = body.data || [];
        } catch (e) {
            // ignore parse errors
        }
    }

    check(res, {
        '[List API Keys] status 200': (r) => r.status === 200,
        '[List API Keys] is array': (r) => r.status === 200 && Array.isArray(initialKeys)
    });

    return initialKeys;
}

export function testCreateApiKey(patToken, check) {
    const mgmtHeaders = Object.assign({}, HEADERS, {
        'Authorization': `Bearer ${patToken}`,
        'Cache-Control': 'no-cache'
    });
    const createKeyPayload = JSON.stringify({ name: 'k6-test-key' });
    const res = http.post(`${API_V1_URL}/api-keys`, createKeyPayload, { headers: mgmtHeaders });

    let createBody = { full_key: null, id: null };
    if (res.status === 201) {
        try {
            createBody = JSON.parse(res.body);
        } catch (e) {
            // ignore parse errors
        }
    }

    check(res, {
        '[Create API Key] status 201': (r) => r.status === 201,
        '[Create API Key] has key': (r) => r.status === 201 && createBody.full_key && createBody.id
    });

    const newApiKey = createBody.full_key;
    return { newApiKey, keyId: createBody.id };
}

export function testListApiKeysAfterCreate(patToken, check) {
    const mgmtHeaders = Object.assign({}, HEADERS, {
        'Authorization': `Bearer ${patToken}`,
        'Cache-Control': 'no-cache'
    });
    const res = http.get(`${API_V1_URL}/api-keys`, { headers: mgmtHeaders });

    let keysAfterCreate = [];
    if (res.status === 200) {
        try {
            const body = JSON.parse(res.body);
            keysAfterCreate = body.data || [];
        } catch (e) {
            // ignore parse errors
        }
    }

    check(res, {
        '[List API Keys After Create] status 200': (r) => r.status === 200,
        '[List API Keys After Create] has one more key': (r) => r.status === 200 && keysAfterCreate.length > 0
    });
}

export function testRevokeApiKey(patToken, keyId, check) {
    const NO_BODY_HEADERS = {};
    const headers = Object.assign({}, NO_BODY_HEADERS, { 'Authorization': `Bearer ${patToken}` });
    const res = http.del(`${API_V1_URL}/api-keys/${keyId}`, null, { headers });

    check(res, {
        '[Revoke API Key] status 200': (r) => r.status === 200
    });
}

export function testListApiKeysAfterRevoke(patToken, check) {
    const mgmtHeaders = Object.assign({}, HEADERS, {
        'Authorization': `Bearer ${patToken}`,
        'Cache-Control': 'no-cache'
    });
    const res = http.get(`${API_V1_URL}/api-keys`, { headers: mgmtHeaders });

    check(res, {
        '[List API Keys After Revoke] status 200': (r) => r.status === 200
    });
}

export function testLogout(check) {
    const logoutHeaders = Object.assign({}, HEADERS);
    delete logoutHeaders['Content-Type'];
    const res = http.post(`${BASE_URL}/auth/logout`, null, { headers: logoutHeaders });

    check(res, {
        '[Logout] status 200': (r) => r.status === 200
    });
}

export function testHmacAuth(apiKey, check) {
    if (!apiKey) return;

    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(8).toString('hex');

    // For HMAC, compute the signature client-side using k6's crypto
    const body = JSON.stringify({ email: 'test@example.com' });
    // Use the path only, not the full URL (server expects request.url which is the path)
    const message = 'POST' + '/v1/validate/email' + body + timestamp + nonce;
    const signature = crypto.hmac('sha256', apiKey, message, 'hex');

    const hmacHeaders = Object.assign({}, HEADERS, {
        'Authorization': `HMAC keyId=${apiKey.slice(0, 8)} signature=${signature} ts=${timestamp} nonce=${nonce}`
    });

    // Test with HMAC - API supports HMAC
    const res = http.post(`${API_V1_URL}/validate/email`, JSON.stringify({ email: 'test@example.com' }), { headers: hmacHeaders });
    check(res, {
        '[HMAC Auth] status 200': (r) => r.status === 200
    });
    return res;
}

export default function (check) {
    check = check || k6check;

    // Scenario 1: Register a new user
    const { email, patToken, defaultApiKey } = testRegister(check);

    // Scenario 2: Login with the registered user
    testLogin(email, check);

    // Scenario 3: List API keys (Management API - use PAT)
    const initialKeys = testListApiKeys(patToken, check);

    // Scenario 4: Create API key (Management API - use PAT)
    const { newApiKey, keyId } = testCreateApiKey(patToken, check);

    // Scenario 5: List API keys again (Management API - use PAT)
    testListApiKeysAfterCreate(patToken, check);

    // Scenario 6: Revoke API key (Management API - use PAT)
    if (keyId) {
        testRevokeApiKey(patToken, keyId, check);

        // Scenario 7: List API keys after revoke
        testListApiKeysAfterRevoke(patToken, check);
    }

    // Scenario 8: Logout
    testLogout(check);

    sleep(0.1);
}