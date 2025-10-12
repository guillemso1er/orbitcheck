import { check as k6check, sleep } from 'k6';
import http from 'k6/http';

export const options = {
    vus: 10,
    duration: '30s',
    thresholds: {
        'checks': ['rate>0.95'],
        http_req_duration: ['p(95)<500', 'p(50)<200']
    }
};

const BASE_URL = 'http://localhost:8081';
const HEADERS = {
    'Content-Type': 'application/json'
};

export function testRegister(check) {
    const email = `testuser${Math.random()}@example.com`;
    const payload = JSON.stringify({
        email: email,
        password: 'password123'
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
        '[Register] status 200': (r) => r.status === 200,
        '[Register] has token': (r) => body && body.token && body.user
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
        '[Login] has token': (r) => body && body.token && body.user
    });

    return { res, body };
}

export default function (check) {
    check = check || k6check;

    // Scenario 1: Register a new user
    const { email } = testRegister(check);

    // Scenario 2: Login with the registered user or fallback
    testLogin(email, check);

    sleep(0.1);
}