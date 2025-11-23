
import { Pool } from 'pg';
import { validateAddress } from '../src/validators/address';

// Mock Pool
const mockPool = {
    query: async () => ({ rows: [] }),
} as unknown as Pool;

// Mock Redis
const mockRedis = {
    get: async () => null,
    set: async () => 'OK',
} as any;

async function run() {
    const input = {
        line1: "Aster Street",
        line2: "123124",
        city: "Edited manually city",
        state: "South Carolina",
        postal_code: "29405",
        country: "US"
    };

    console.log("Testing with input:", input);

    try {
        const result = await validateAddress(input, mockPool, mockRedis);
        console.log("Result:", JSON.stringify(result, null, 2));
    } catch (error) {
        console.error("Error:", error);
    }
}

run();
