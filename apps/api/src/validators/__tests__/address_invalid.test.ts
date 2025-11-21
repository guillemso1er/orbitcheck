
import { Pool } from 'pg';
import { validateAddress } from '../address';

// Mock dependencies
const mockPool = {
    query: jest.fn(),
} as unknown as Pool;

const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
} as any;

describe('Address Validation - Invalid Placeholders', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should fail fast for "asd" placeholder', async () => {
        const result = await validateAddress({
            line1: 'asd',
            city: 'adg',
            postal_code: '50269',
            country: 'US'
        }, mockPool, mockRedis);

        expect(result.valid).toBe(false);
        expect(result.reason_codes).toContain('INVALID_INPUT_DATA');
    });

    it('should fail fast for "adg" placeholder in city', async () => {
        const result = await validateAddress({
            line1: '123 Main St',
            city: 'adg',
            postal_code: '50269',
            country: 'US'
        }, mockPool, mockRedis);

        expect(result.valid).toBe(false);
        expect(result.reason_codes).toContain('INVALID_INPUT_DATA');
    });
});
