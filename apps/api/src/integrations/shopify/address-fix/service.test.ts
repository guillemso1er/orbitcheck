import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AddressFixService } from './service';

// Mock dependencies
const mockPool = {
    query: vi.fn(),
} as unknown as Pool;

const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
} as unknown as FastifyBaseLogger;

// Mock shopifyGraphql
vi.mock('../lib/graphql', () => ({
    shopifyGraphql: vi.fn().mockResolvedValue({
        mutate: vi.fn().mockResolvedValue({
            orderUpdate: { userErrors: [] },
            data: { orderUpdate: { userErrors: [] } }
        }),
    }),
    MUT_TAGS_ADD: 'MUT_TAGS_ADD',
}));

vi.mock('./graphql', () => ({
    MUT_ORDER_UPDATE: 'MUT_ORDER_UPDATE',
    MUT_FULFILLMENT_ORDER_RELEASE_HOLD: 'MUT_FULFILLMENT_ORDER_RELEASE_HOLD',
    MUT_TAGS_REMOVE: 'MUT_TAGS_REMOVE',
    MUT_METAFIELDS_SET: 'MUT_METAFIELDS_SET',
}));

describe('AddressFixService', () => {
    let service: AddressFixService;

    beforeEach(() => {
        service = new AddressFixService(mockPool, mockLogger);
        vi.clearAllMocks();
    });

    describe('resolveFieldFromSources', () => {
        // Access private method via any cast for testing
        const resolveField = (service as any).resolveFieldFromSources.bind(service);

        it('should prefer override value even if empty string', () => {
            const override = { address2: '' };
            const original = { address2: 'Apt 1' };

            // Should return empty string because it's in the override
            const result = resolveField([override, original], 'address2');
            expect(result).toBe('');
        });

        it('should fallback if key is missing in override', () => {
            const override = { address1: '123 Main St' }; // address2 missing
            const original = { address2: 'Apt 1' };

            const result = resolveField([override, original], 'address2');
            expect(result).toBe('Apt 1');
        });

        it('should use override value if present and non-empty', () => {
            const override = { city: 'New City' };
            const original = { city: 'Old City' };

            const result = resolveField([override, original], 'city');
            expect(result).toBe('New City');
        });

        it('should return null if not found in any source', () => {
            const override = {};
            const original = {};

            const result = resolveField([override, original], 'custom_field');
            expect(result).toBe(null);
        });
    });
});
