

import crypto from 'node:crypto';

import type { FastifyInstance } from 'fastify'; // Import the type for safety
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { ValidationResult } from '../validators/email.js';
import { createApp, hapi, mockDns, mockPool, mockRedisInstance, mockValidateEmail, setupBeforeAll } from './testSetup.js';


const actualModule = jest.requireActual('../validators/email');
const { validateEmail } = actualModule;

describe('Email Validation Endpoints', () => {
    let app: FastifyInstance;

    // Create the app instance once before any tests in this suite run
    beforeAll(async () => {
        await setupBeforeAll(); // Set up all global mocks
        app = await createApp();  // Await the async function
        await app.ready();      // Wait for the app to be ready
    });

    // Close the app instance once after all tests in this suite are finished
    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    // Before each test, clear mocks and set up a default "valid email" state
    beforeEach(() => {
        jest.clearAllMocks();

        // Default to a successful validation response, which tests can override
        mockValidateEmail.mockResolvedValue({
            valid: true,
            normalized: 'test@example.com',
            disposable: false,
            mx_found: true,
            reason_codes: [],
            request_id: 'test-id',
            ttl_seconds: 2_592_000
        } as ValidationResult);

        // Default mock implementations for API key auth and logging
        mockPool.query.mockImplementation((queryText: string) => {
            const upperQuery = queryText.toUpperCase();
            if (upperQuery.includes('API_KEYS')) {
                return Promise.resolve({ rows: [{ id: 'test_key_id', project_id: 'test_project' }] });
            }
            if (upperQuery.startsWith('INSERT INTO LOGS')) {
                return Promise.resolve({ rows: [], rowCount: 1 });
            }
            return Promise.resolve({ rows: [] });
        });

        // Reset other specific mocks to their default success states
        const mockRedis = mockRedisInstance as unknown as jest.Mocked<Redis>;
        mockRedis.sismember.mockResolvedValue(0);
        mockRedis.get.mockResolvedValue(null);
        mockRedis.set.mockResolvedValue('OK');
        (hapi).isEmailValid.mockReturnValue(true);
        (mockDns).resolveMx.mockResolvedValue([{ exchange: 'mx.example.com' }]);
        (mockDns).resolve4.mockResolvedValue(['1.2.3.4']);
        (mockDns).resolve6.mockResolvedValue([]);

        // Mock crypto.randomUUID if needed
        jest.spyOn(crypto, 'randomUUID').mockReturnValue('123e4567-e89b-12d3-a456-426614174000');
    });

    describe('validateEmail function', () => {
        it('should validate a valid email without Redis', async () => {
            // No Redis provided
            const result = await validateEmail('Test@Example.com');

            expect(result.valid).toBe(true);
            expect(result.normalized).toBe('test@example.com');
            expect(result.disposable).toBe(false);
            expect(result.mx_found).toBe(true);
            expect(result.reason_codes).toEqual([]);
            expect(hapi.isEmailValid).toHaveBeenCalledWith('test@example.com');
            expect(mockDns.resolveMx).toHaveBeenCalledWith('example.com');
        });

        it('should invalidate email with invalid format', async () => {
            (hapi).isEmailValid.mockReturnValue(false);

            const result = await validateEmail('invalid-email');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.invalid_format');
            expect(result.mx_found).toBe(false); // Since format invalid, no DNS check
        });

        it('should invalidate email with no MX records, fallback to A/AAAA', async () => {
            (mockDns).resolveMx.mockRejectedValue(new Error('No MX'));
            (mockDns).resolve4.mockResolvedValue(['1.2.3.4']); // Has A record

            const result = await validateEmail('test@example.com');

            expect(result.valid).toBe(true);
            expect(result.mx_found).toBe(true); // Fallback succeeded
            expect(mockDns.resolve4).toHaveBeenCalledWith('example.com');
        });

        it('should invalidate email with no MX and no A/AAAA records', async () => {
            (mockDns).resolveMx.mockRejectedValue(new Error('No MX'));
            (mockDns).resolve4.mockRejectedValue(new Error('No A'));
            (mockDns).resolve6.mockRejectedValue(new Error('No AAAA'));

            const result = await validateEmail('test@invalid.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.mx_not_found');
            expect(result.mx_found).toBe(false);
        });

        it('should detect disposable domain with Redis', async () => {
            const mockRedis = mockRedisInstance as unknown as jest.Mocked<Redis>;
            mockRedis.sismember.mockResolvedValueOnce(1); // disposable

            const result = await validateEmail('test@disposable.com', mockRedis);

            expect(result.valid).toBe(false);
            expect(result.disposable).toBe(true);
            expect(result.reason_codes).toContain('email.disposable_domain');
            expect(mockRedis.sismember).toHaveBeenCalledWith('disposable_domains', 'disposable.com');
        });

        it('should use cache from Redis for full email', async () => {
            // --- ARRANGE ---
            const mockRedis = mockRedisInstance as unknown as jest.Mocked<Redis>;
            const cachedResult: ValidationResult = {
                valid: true,
                normalized: 'cached@example.com',
                disposable: false,
                mx_found: true,
                reason_codes: [],
                request_id: '123e4567-e89b-12d3-a456-426614174000',
                ttl_seconds: 2_592_000
            };

            const input = 'cached@example.com';
            const expectedHash = crypto.createHash('sha1').update(input).digest('hex');
            const expectedCacheKey = `validator:email:${expectedHash}`;

            // Ensure mocks are clear before this test
            (mockRedis.get as jest.Mock).mockClear();
            (hapi.isEmailValid as jest.Mock).mockClear();
            (mockDns.resolveMx as jest.Mock).mockClear();

            // Mock the Redis 'get' call to return our cached result
            (mockRedis.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(cachedResult));

            // --- ACT ---
            const result = await validateEmail('cached@example.com', mockRedis);

            // --- ASSERT ---
            // 1. The result should be the exact object from the cache.
            expect(result).toEqual(cachedResult);

            // 2. Redis's `get` method should have been called once with the correct key.
            expect(mockRedis.get).toHaveBeenCalledTimes(1);
            expect(mockRedis.get).toHaveBeenCalledWith(expectedCacheKey);

            // 3. Because a cached result was found, no further validation should have occurred.
            expect(hapi.isEmailValid).not.toHaveBeenCalled();
            expect(mockDns.resolveMx).not.toHaveBeenCalled();
        });

        it('should use domain cache for MX and disposable', async () => {
            const mockRedis = mockRedisInstance as unknown as jest.Mocked<Redis>;
            const domainData = { mx_found: true, disposable: false };
            mockRedis.get
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(JSON.stringify(domainData));

            const result = await validateEmail('test@cached-domain.com', mockRedis);

            expect(result.mx_found).toBe(true);
            expect(result.disposable).toBe(false);
            expect(mockRedis.get).toHaveBeenCalledWith('domain:cached-domain.com');
            // No DNS or sismember calls
            expect(mockDns.resolveMx).not.toHaveBeenCalled();
            expect(mockRedis.sismember).not.toHaveBeenCalled();
        });

        it('should handle DNS timeout', async () => {
            (mockDns).resolveMx.mockRejectedValue(new Error('ETIMEDOUT'));
            (mockDns).resolve4.mockRejectedValue(new Error('ETIMEDOUT'));
            (mockDns).resolve6.mockRejectedValue(new Error('ETIMEDOUT'));

            const result = await validateEmail('test@timeout.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.mx_not_found');
            expect(result.mx_found).toBe(false);
        });

        it('should handle server error gracefully', async () => {
            // Simulate error in parsing or something
            const splitMock = jest.spyOn(String.prototype, 'split').mockImplementation(() => { throw new Error('Parse error'); });

            const result = await validateEmail('error@example.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.server_error');

            // Restore
            splitMock.mockRestore();
        });

        it('should normalize email with ASCII domain', async () => {
            // Test with international domain, but since url.domainToASCII, assume simple
            const result = await validateEmail('Test@EXAMPLE.COM');

            expect(result.normalized).toBe('test@example.com');
        });

        it('should cache result in Redis after computation', async () => {
            // ARRANGE
            const mockRedis = mockRedisInstance as unknown as jest.Mocked<Redis>;
            mockRedis.get.mockResolvedValue(null); // Ensure no cache hits

            // ACT
            await validateEmail('uncached@example.com', mockRedis);

            // ASSERT
            const input = 'uncached@example.com';
            const expectedHash = crypto.createHash('sha1').update(input).digest('hex');

            // From your constants file (TTL_EMAIL)
            const expectedTtl = 2_592_000;

            // The function first caches the domain, then the full email.
            // We use `toHaveBeenLastCalledWith` to check the final, correct call.
            expect(mockRedis.set).toHaveBeenLastCalledWith(
                `validator:email:${expectedHash}`,
                expect.stringContaining('"normalized":"uncached@example.com"'), // More specific check of the payload
                'EX',
                expectedTtl
            );
        });

        it('should cache domain data in Redis', async () => {
            const mockRedis = mockRedisInstance as unknown as jest.Mocked<Redis>;
            mockRedis.get.mockResolvedValue(null); // No domain cache

            await validateEmail('test@newdomain.com', mockRedis);

            expect(mockRedis.set).toHaveBeenCalledWith(
                'domain:newdomain.com',
                expect.stringContaining('mx_found'),
                'EX',
                7 * 24 * 3600
            );
        });
    });

    describe('validateEmail function - non-obvious invalid cases', () => {
        it('should invalidate email with multiple @ symbols', async () => {
            (hapi).isEmailValid.mockReturnValue(false);

            const result = await validateEmail('user@name@domain.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.invalid_format');
        });

        it('should invalidate email with only @ but no local part', async () => {
            (hapi).isEmailValid.mockReturnValue(false);

            const result = await validateEmail('@domain.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.invalid_format');
        });

        it('should invalidate email with only @ but no domain part', async () => {
            (hapi).isEmailValid.mockReturnValue(false);

            const result = await validateEmail('user@');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.invalid_format');
        });

        it('should invalidate email with consecutive dots in local part', async () => {
            (hapi).isEmailValid.mockReturnValue(false);

            const result = await validateEmail('user..name@domain.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.invalid_format');
        });

        it('should invalidate email with leading dot in local part', async () => {
            (hapi).isEmailValid.mockReturnValue(false);

            const result = await validateEmail('.user@domain.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.invalid_format');
        });

        it('should invalidate email with trailing dot in local part', async () => {
            (hapi).isEmailValid.mockReturnValue(false);

            const result = await validateEmail('user.@domain.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.invalid_format');
        });

        it('should invalidate email with domain starting with hyphen', async () => {
            (hapi).isEmailValid.mockReturnValue(false);

            const result = await validateEmail('user@-domain.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.invalid_format');
        });

        it('should invalidate email with domain ending with hyphen', async () => {
            (hapi).isEmailValid.mockReturnValue(false);

            const result = await validateEmail('user@domain-.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.invalid_format');
        });

        it('should invalidate email with numbers-only domain that looks valid but has no MX', async () => {
            (mockDns).resolveMx.mockRejectedValue(new Error('No MX'));
            (mockDns).resolve4.mockRejectedValue(new Error('No A'));
            (mockDns).resolve6.mockRejectedValue(new Error('No AAAA'));

            const result = await validateEmail('user@123456789.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.mx_not_found');
            expect(result.mx_found).toBe(false);
        });

        it('should invalidate email with very long local part (255+ chars)', async () => {
            const longLocal = 'a'.repeat(250) + '@example.com';
            (hapi).isEmailValid.mockReturnValue(false);

            const result = await validateEmail(longLocal);

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.invalid_format');
        });

        it('should invalidate email with encoded characters that fail parsing', async () => {
            (hapi).isEmailValid.mockReturnValue(false);

            const result = await validateEmail('user%test@domain.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.invalid_format');
        });

        it('should invalidate email with whitespace embedded in local part', async () => {
            (hapi).isEmailValid.mockReturnValue(false);

            const result = await validateEmail('user name@domain.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.invalid_format');
        });

        it('should invalidate email with null input', async () => {
            const result = await validateEmail(null as any);

            expect(result.valid).toBe(false);
            expect(result.normalized).toBe('');
            expect(result.reason_codes).toContain('email.invalid_format');
        });

        it('should invalidate email with undefined input', async () => {
            const result = await validateEmail(undefined as any);

            expect(result.valid).toBe(false);
            expect(result.normalized).toBe('');
            expect(result.reason_codes).toContain('email.invalid_format');
        });

        it('should invalidate email with empty string', async () => {
            const result = await validateEmail('');

            expect(result.valid).toBe(false);
            expect(result.normalized).toBe('');
            expect(result.reason_codes).toContain('email.invalid_format');
        });
    });

    describe('POST /v1/validate/email', () => {
        it('should validate a valid email using default success mocks', async () => {
            // This test relies entirely on the default setup in beforeEach
            const response = await request(app.server)
                .post('/v1/validate/email')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'test@example.com' });

            expect(response.status).toBe(200);
            const body = response.body as ValidationResult;
            expect(body.valid).toBe(true);
            expect(body.disposable).toBe(false);
            expect(body.mx_found).toBe(true);
        });

        it('should reject disposable email when Redis finds a match', async () => {
            // Override Redis mock to simulate finding a disposable domain
            mockRedisInstance.sismember.mockImplementation((_setName: string, domain: string) =>
                Promise.resolve(domain === 'disposable.com' ? 1 : 0)
            );

            // Also override the main validator mock to return a disposable result
            mockValidateEmail.mockResolvedValue({
                valid: false,
                normalized: 'test@disposable.com',
                disposable: true,
                mx_found: true,
                reason_codes: ['email.disposable_domain'],
                request_id: 'test-id',
                ttl_seconds: 2_592_000
            } as ValidationResult);

            const response = await request(app.server)
                .post('/v1/validate/email')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'test@disposable.com' });

            expect(response.status).toBe(200);
            const body = response.body as ValidationResult;
            expect(body.valid).toBe(false);
            expect(body.disposable).toBe(true);
            expect(body.reason_codes).toContain('email.disposable_domain');
        });

        it('should handle invalid format when validator returns false', async () => {
            // Override the format checker mock to return false
            hapi.isEmailValid.mockReturnValue(false);

            // Also override the main validator mock to return an invalid format result
            mockValidateEmail.mockResolvedValue({
                valid: false,
                normalized: 'invalid-email',
                disposable: false,
                mx_found: false,
                reason_codes: ['email.invalid_format'],
                request_id: 'test-id',
                ttl_seconds: 2_592_000
            } as ValidationResult);

            const response = await request(app.server)
                .post('/v1/validate/email')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'invalid-email' });

            expect(response.status).toBe(200);
            const body = response.body as ValidationResult;
            expect(body.valid).toBe(false);
            expect(body.reason_codes).toContain('email.invalid_format');
        });
    });


});