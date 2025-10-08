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

export default function (check) {
    check = check || k6check;

    // Scenario 1: Register a new user
    const registerPayload = JSON.stringify({
        email: `testuser${Math.random()}@example.com`,
        password: 'password123'
    });
    const resRegister = http.post(`${BASE_URL}/auth/register`, registerPayload, { headers: HEADERS });

    let registerBody = null;
    if (resRegister.status === 201) {
        try {
            registerBody = JSON.parse(resRegister.body);
        } catch (e) {
            // ignore parse errors
        }
    }

    check(resRegister, {
        '[Register] status 200': (r) => r.status === 200,
        '[Register] has token': (r) => registerBody && registerBody.token && registerBody.user
    });

    // Scenario 2: Login with the registered user or fallback
    const loginEmail = registerBody ? registerBody.user.email : 'test@example.com';
    const loginPayload = JSON.stringify({
        email: loginEmail,
        password: 'password123'
    });
    const resLogin = http.post(`${BASE_URL}/auth/login`, loginPayload, { headers: HEADERS });

    let loginBody = null;
    if (resLogin.status === 200) {
        try {
            loginBody = JSON.parse(resLogin.body);
        } catch (e) {
            // ignore parse errors
        }
    }

    check(resLogin, {
        '[Login] status 200': (r) => r.status === 200,
        '[Login] has token': (r) => loginBody && loginBody.token && loginBody.user
    });

    sleep(0.1);
}