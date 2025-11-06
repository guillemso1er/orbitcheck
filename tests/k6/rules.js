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

export function testGetRulesFirst(headers, check) {
    const res = http.get(`${BASE_URL}/rules`, { headers });
    check(res, {
        '[Get Rules] status 200': (r) => r.status === 200,
        '[Get Rules] has rules': (r) => r.status === 200 && Array.isArray(JSON.parse(r.body).rules)
    });
}

export function testGetRulesSecond(check) {
    // Second request for cache HIT.
    const res = http.get(`${BASE_URL}/rules`, { headers: getHeaders() });
    check(res, {
        '[Get Rules] status 200': (r) => r.status === 200
    });
}

export function testGetRulesCatalog(headers, check) {
    const res = http.get(`${BASE_URL}/rules/catalog`, { headers });
    check(res, {
        '[Get Catalog] status 200': (r) => r.status === 200,
        '[Get Catalog] has reason_codes': (r) => {
            const body = JSON.parse(r.body);
            return body && Array.isArray(body.reason_codes);
        }
    });
}

export function testRegisterRules(headers, check) {
    const payload = JSON.stringify({
        rules: [{
            id: 'k6-custom-rule',
            name: 'k6-custom-rule',
            description: 'test rule',
            condition: 'true', // Add required condition field
            severity: 'low',
            enabled: true
        }]
    });
    const res = http.post(`${BASE_URL}/rules/register`, payload, { headers });
    check(res, {
        '[Register Rules] status 200 or 201': (r) => r.status === 200 || r.status === 201,
        '[Register Rules] success': (r) => {
            try {
                const body = JSON.parse(r.body);
                return body.registered_rules && Array.isArray(body.registered_rules);
            } catch (e) {
                return false;
            }
        }
    });
}

export function testGetRulesErrorCodes(headers, check) {
    const res = http.get(`${BASE_URL}/rules/error-codes`, { headers });
    check(res, {
        '[Get Error Codes] status 200': (r) => r.status === 200,
        '[Get Error Codes] has error_codes': (r) => r.status === 200 && Array.isArray(JSON.parse(r.body).error_codes)
    });
}

export function testTestRules(headers, check) {
    const payload = JSON.stringify({
        data: {
            email: 'test@example.com',
            name: 'Test User'
        },
        rules: ['k6-custom-rule']
    });
    const res = http.post(`${BASE_URL}/rules/test`, payload, { headers });
    check(res, {
        '[Test Rules] status 200': (r) => r.status === 200,
        '[Test Rules] has results': (r) => {
            const body = JSON.parse(r.body);
            return body.results !== undefined;
        }
    });
}

export default function (check) {
    // If check is not provided (when running this file directly),
    // use the original k6check as a fallback.
    check = check || k6check;

    testGetRulesFirst(check);
    testGetRulesCatalog(check);
    testRegisterRules(check);

    sleep(0.1);
}
