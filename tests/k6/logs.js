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

const BASE_URL = 'http://localhost:8080';
const API_V1_URL = `${BASE_URL}/v1`;

export function testGetLogs(headers, check) {
    const res = http.get(`${BASE_URL}/v1/data/logs`, { headers });
    check(res, {
        '[Get Logs] status 200': (r) => r.status === 200,
        '[Get Logs] is array': (r) => r.status === 200 && Array.isArray(JSON.parse(r.body).data)
    });
}

export function testGetLogsForDelete(headers, check) {
    const res = http.get(`${BASE_URL}/v1/data/logs?limit=1`, { headers });
    check(res, {
        '[Get Logs for Delete] status 200': (r) => r.status === 200
    });
    if (res.status === 200) {
        const body = JSON.parse(res.body);
        return body.data && body.data.length > 0 ? body.data[0] : null;
    }
    return null;
}

export function testDeleteLog(log, headers, check) {
    if (!log || !log.id) return;
    const delHeaders = Object.assign({}, headers);
    delete delHeaders['Content-Type'];
    const res = http.del(`${BASE_URL}/v1/logs/${log.id}`, null, { headers: delHeaders });
    check(res, {
        '[Delete Log] status 200': (r) => r.status === 200,
        '[Delete Log] success message': (r) => {
            const body = JSON.parse(r.body);
            return body.message && body.message.includes('deleted');
        }
    });
}

export function testEraseData(headers, check) {
    const eraseDataPayload = JSON.stringify({ reason: 'gdpr' });
    const res = http.post(`${BASE_URL}/v1/data/erase`, eraseDataPayload, { headers });
    check(res, {
        '[Erase Data] status 202': (r) => r.status === 202,
        '[Erase Data] confirmation message': (r) => {
            const body = JSON.parse(r.body);
            return body.message && body.message.includes('erasure');
        }
    });
}

export default function (check) {
    // If check is not provided (when running this file directly),
    // use the original k6check as a fallback.
    check = check || k6check;

    testGetLogs(check);
    const logToDelete = testGetLogsForDelete(check);
    testDeleteLog(logToDelete, check);

    sleep(0.1);
}
