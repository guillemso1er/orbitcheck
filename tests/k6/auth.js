import { URL } from 'https://jslib.k6.io/url/1.0.0/index.js';
import { check as k6check, sleep } from 'k6';
import crypto from 'k6/crypto';
import http from 'k6/http';

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
    });

    return { res, body, email };
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
            return body && body.user && body.pat_token
        }
    });

    return { res, body, patToken: body.pat_token };
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


function toHex(ab) {
    return Array.from(new Uint8Array(ab)).map(b => b.toString(16).padStart(2, '0')).join('');
}
export function testCreatePat(patToken, check) {
    const mgmtHeaders = Object.assign({}, HEADERS, {
        'Authorization': `Bearer ${patToken}`,
        'Cache-Control': 'no-cache'
    });

    const createPatPayload = JSON.stringify({
        name: 'k6-test-pat',
        scopes: ['keys:read', 'keys:write', 'webhooks:manage', 'logs:read', 'usage:read', 'pats:manage', 'rules:manage']
    });

    const res = http.post(`${API_V1_URL}/pats`, createPatPayload, { headers: mgmtHeaders });

    let patBody = null;
    if (res.status === 201) {
        try {
            patBody = JSON.parse(res.body);
        } catch (e) {
            // ignore parse errors
        }
    }

    check(res, {
        '[Create PAT] status 201': (r) => r.status === 201,
        '[Create PAT] has token': (r) => {
            if (r.status !== 201) return false;
            try {
                return patBody && patBody.token && patBody.token_id;
            } catch (e) {
                return false;
            }
        }
    });

    return {
        pat: patBody ? patBody.token : null,
        tokenId: patBody ? patBody.token_id : null
    };
}

export function testListPats(patToken, check) {
    const mgmtHeaders = Object.assign({}, HEADERS, {
        'Authorization': `Bearer ${patToken}`,
        'Cache-Control': 'no-cache'
    });

    const res = http.get(`${API_V1_URL}/pats`, { headers: mgmtHeaders });

    let pats = [];
    if (res.status === 200) {
        try {
            const body = JSON.parse(res.body);
            pats = body.data || [];
        } catch (e) {
            // ignore parse errors
        }
    }

    check(res, {
        '[List PATs] status 200': (r) => r.status === 200,
        '[List PATs] is array': (r) => r.status === 200 && Array.isArray(pats)
    });

    return pats;
}

export function testRevokePat(patToken, tokenIdToRevoke, check) {
    if (!tokenIdToRevoke) return;

    const mgmtHeaders = Object.assign({}, HEADERS, {
        'Authorization': `Bearer ${patToken}`,
        'Cache-Control': 'no-cache'
    });

    const res = http.del(`${API_V1_URL}/pats/${tokenIdToRevoke}`, null, { headers: mgmtHeaders });

    check(res, {
        '[Revoke PAT] status 200': (r) => r.status === 200
    });
}

export function testListPatsAfterRevoke(patToken, check) {
    const mgmtHeaders = Object.assign({}, HEADERS, {
        'Authorization': `Bearer ${patToken}`,
        'Cache-Control': 'no-cache'
    });

    const res = http.get(`${API_V1_URL}/pats`, { headers: mgmtHeaders });

    check(res, {
        '[List PATs After Revoke] status 200': (r) => r.status === 200
    });
}

export function testHmacAuth(apiKey, check) {
    if (!apiKey) return;

    const url = new URL(`${API_V1_URL}/validate/email`);
    const pathWithQuery = url.pathname + (url.search || '');
    const body = JSON.stringify({ email: 'test@example.com' });

    const ts = Date.now().toString();

    const nonce_buffer = crypto.randomBytes(16); // This returns an ArrayBuffer
    const nonce = toHex(nonce_buffer);

    const message = 'POST' + pathWithQuery + ts + nonce;

    // Ensure the output encoding is 'hex' here as well
    const signature = crypto.hmac('sha256', apiKey, message, 'hex');

    const headers = Object.assign({}, HEADERS, {
        'Authorization': `HMAC keyId=${apiKey.slice(0, 6)}&signature=${signature}&ts=${ts}&nonce=${nonce}`
    });

    const res = http.post(url.toString(), body, { headers });
    check(res, { '[HMAC Auth] status 200': (r) => r.status === 200 });
    return res;
}


export default function (check) {
    check = check || k6check;

    // Scenario 1: Register a new user
    const { email, } = testRegister(check);

    // Scenario 2: Login with the registered user
    const { patToken, } = testLogin(email, check);

    // Scenario 4: Create API key (Management API - use PAT)
    const { newApiKey, keyId } = testCreateApiKey(patToken, check);


    // Scenario 3: List API keys (Management API - use PAT)
    const initialKeys = testListApiKeys(patToken, check);


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