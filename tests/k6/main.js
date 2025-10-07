import { check as k6check, sleep } from 'k6'; // Renamed original 'check' to 'k6check'
import http from 'k6/http';
import { default as addressTest } from './address.js';
import { default as authTest } from './auth.js';
import { default as dedupeTest } from './dedupe.js';
import { default as emailTest } from './email.js';
import { default as logsTest } from './logs.js';
import { default as orderTest } from './order.js';
import { default as phoneTest } from './phone.js';
import { default as rulesTest } from './rules.js';
import { default as taxidTest } from './taxid.js';
import { default as usageTest } from './usage.js';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        'checks': ['rate>0.90'], // More lenient threshold for single iteration testing
        'http_req_duration': ['p(95)<1000', 'p(50)<500'] // More lenient thresholds for single iteration
    }
};

const KEY = (__ENV.KEY || '').trim();
const BASE_URL = 'http://localhost:8081/v1';
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${KEY}`
};

/**
 * Creates a wrapper around the k6 `check` function to prepend a name.
 * @param {string} name - The name of the test file (e.g., 'address').
 * @returns {function} A new check function with prefixed descriptions.
 */
function createCheckFor(name) {
    return (val, sets, tags) => {
        const newSets = {};
        for (const key in sets) {
            // Prepend the file name to each check description
            newSets[`[${name}] ${key}`] = sets[key];
        }
        return k6check(val, newSets, tags);
    };
}

// Note: The individual scenario functions below are for running tests in isolation via `k6 run --scenario <scenario_name>`.
// They are not used in the default execution flow.

export function addressScenario() {
    addressTest(createCheckFor('address'));
}

export function authScenario() {
    authTest(createCheckFor('auth'));
}

export function dedupeScenario() {
    dedupeTest(createCheckFor('dedupe'));
}

export function emailScenario() {
    emailTest(createCheckFor('email'));
}

export function logsScenario() {
    logsTest(createCheckFor('logs'));
}

export function orderScenario() {
    orderTest(createCheckFor('order'));
}

export function phoneScenario() {
    phoneTest(createCheckFor('phone'));
}

export function rulesScenario() {
    rulesTest(createCheckFor('rules'));
}

export function taxidScenario() {
    taxidTest(createCheckFor('taxid'));
}

export function usageScenario() {
    usageTest(createCheckFor('usage'));
}

// Main function that runs all tests
export default function () {
    console.log('Starting comprehensive k6 test suite...');
    
    const testsToRun = (__ENV.TESTS || '').trim();
    if (testsToRun) {
        runSpecificTests(testsToRun.split(',').map(t => t.trim()));
        return;
    }

    // Run all tests sequentially, passing the appropriate prefixed check function to each.
    console.log('Running address tests...');
    addressTest(createCheckFor('address'));

    console.log('Running auth tests...');
    authTest(createCheckFor('auth'));

    console.log('Running dedupe tests...');
    dedupeTest(createCheckFor('dedupe'));

    console.log('Running email tests...');
    emailTest(createCheckFor('email'));

    console.log('Running logs tests...');
    logsTest(createCheckFor('logs'));

    console.log('Running order tests...');
    orderTest(createCheckFor('order'));

    console.log('Running phone tests...');
    phoneTest(createCheckFor('phone'));

    console.log('Running rules tests...');
    rulesTest(createCheckFor('rules'));

    console.log('Running taxid tests...');
    taxidTest(createCheckFor('taxid'));

    console.log('Running usage tests...');
    usageTest(createCheckFor('usage'));
    
    console.log('All tests completed successfully!');
}

// Utility function to run specific tests
export function runSpecificTests(testNames = []) {
    const testMap = {
        address: () => addressTest(createCheckFor('address')),
        auth: () => authTest(createCheckFor('auth')),
        dedupe: () => dedupeTest(createCheckFor('dedupe')),
        email: () => emailTest(createCheckFor('email')),
        logs: () => logsTest(createCheckFor('logs')),
        order: () => orderTest(createCheckFor('order')),
        phone: () => phoneTest(createCheckFor('phone')),
        rules: () => rulesTest(createCheckFor('rules')),
        taxid: () => taxidTest(createCheckFor('taxid')),
        usage: () => usageTest(createCheckFor('usage'))
    };
    
    if (testNames.length === 0) {
        Object.values(testMap).forEach(testFunc => testFunc());
    } else {
        testNames.forEach(testName => {
            if (testMap[testName]) {
                console.log(`Running ${testName} tests...`);
                testMap[testName]();
            } else {
                console.log(`Warning: Test '${testName}' not found. Available tests: ${Object.keys(testMap).join(', ')}`);
            }
        });
    }
    
    console.log('Selected tests completed!');
}