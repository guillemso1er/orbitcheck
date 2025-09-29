import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = { vus: 10, duration: '30s' };

const KEY = __ENV.KEY;
const BASE_URL = 'http://localhost:8081';
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${KEY}`
};

export default function () {
    // Test dedupe with no matches (new customer)
    const noMatchPayload = JSON.stringify({
        email: 'newuser@example.com',
        first_name: 'John',
        last_name: 'Doe',
        phone: '+1234567890'
    });
    let res = http.post(`${BASE_URL}/dedupe/customer`, noMatchPayload, { headers: HEADERS });
    check(res, {
        'status 200': (r) => r.status === 200,
        'matches empty': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.matches) && body.matches.length === 0;
        },
        'suggested_action create_new': (r) => {
            const body = JSON.parse(r.body);
            return body.suggested_action === 'create_new';
        }
    });

    // Test dedupe with potential fuzzy match (assuming DB has data or adjust expectation)
    const fuzzyPayload = JSON.stringify({
        email: 'fuzzy@example.com',
        first_name: 'Jane',
        last_name: 'Smith'
    });
    res = http.post(`${BASE_URL}/dedupe/customer`, fuzzyPayload, { headers: HEADERS });
    check(res, {
        'status 200': (r) => r.status === 200,
        'response structure': (r) => {
            const body = JSON.parse(r.body);
            return body.matches !== undefined && body.suggested_action !== undefined;
        }
    });

    // Test dedupe with exact email match (if DB has matching data)
    const exactPayload = JSON.stringify({
        email: 'existing@example.com',
        first_name: 'Existing',
        last_name: 'User'
    });
    res = http.post(`${BASE_URL}/dedupe/customer`, exactPayload, { headers: HEADERS });
    check(res, {
        'status 200': (r) => r.status === 200,
        'matches present': (r) => {
            const body = JSON.parse(r.body);
            return Array.isArray(body.matches) && body.matches.length > 0;
        },
        'suggested_action merge or review': (r) => {
            const body = JSON.parse(r.body);
            return ['merge_with', 'review'].includes(body.suggested_action);
        }
    });

    sleep(0.1);
}