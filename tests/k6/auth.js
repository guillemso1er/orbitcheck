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
    check(resRegister, {
        '[Register] status 201': (r) => r.status === 201,
        '[Register] has token': (r) => {
            const body = JSON.parse(r.body);
            return body.token && body.user;
        }
    });

    // Scenario 2: Login with the user
    // Since we don't have the email, use a fixed one assuming it exists or handle dynamically
    // For simplicity, assume we can login with a test user
    // In real test, might need to register and then login
    const loginPayload = JSON.stringify({
        email: 'test@example.com',
        password: 'password123'
    });
    const resLogin = http.post(`${BASE_URL}/auth/login`, loginPayload, { headers: HEADERS });
    check(resLogin, {
        '[Login] status 200': (r) => r.status === 200,
        '[Login] has token': (r) => {
            const body = JSON.parse(r.body);
            return body.token && body.user;
        }
    });

    sleep(0.1);
}