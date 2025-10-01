import { FastifyInstance } from 'fastify'; // Import the type for safety
import request from 'supertest';
import { createApp, hapi, mockDns, mockPool, mockRedisInstance, mockValidateEmail, setupBeforeAll } from './testSetup';
const { validateEmail } = jest.requireActual('../validators/email');
import crypto from 'crypto';

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
        });

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
        mockRedisInstance.sismember.mockResolvedValue(0);
        mockRedisInstance.get.mockResolvedValue(null);
        mockRedisInstance.set.mockResolvedValue('OK');
        hapi.isEmailValid.mockReturnValue(true);
        mockDns.resolveMx.mockResolvedValue([{ exchange: 'mx.example.com' }]);
        mockDns.resolve4.mockResolvedValue(['1.2.3.4']);
        mockDns.resolve6.mockResolvedValue([]);

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
            hapi.isEmailValid.mockReturnValue(false);

            const result = await validateEmail('invalid-email');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.invalid_format');
            expect(result.mx_found).toBe(false); // Since format invalid, no DNS check
        });

        it('should invalidate email with no MX records, fallback to A/AAAA', async () => {
            mockDns.resolveMx.mockRejectedValue(new Error('No MX'));
            mockDns.resolve4.mockResolvedValue(['1.2.3.4']); // Has A record

            const result = await validateEmail('test@example.com');

            expect(result.valid).toBe(true);
            expect(result.mx_found).toBe(true); // Fallback succeeded
            expect(mockDns.resolve4).toHaveBeenCalledWith('example.com');
        });

        it('should invalidate email with no MX and no A/AAAA records', async () => {
            mockDns.resolveMx.mockRejectedValue(new Error('No MX'));
            mockDns.resolve4.mockRejectedValue(new Error('No A'));
            mockDns.resolve6.mockRejectedValue(new Error('No AAAA'));

            const result = await validateEmail('test@invalid.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.mx_not_found');
            expect(result.mx_found).toBe(false);
        });

        it('should detect disposable domain with Redis', async () => {
            const mockRedis = mockRedisInstance as any;
            mockRedis.sismember.mockResolvedValueOnce(1); // disposable

            const result = await validateEmail('test@disposable.com', mockRedis);

            expect(result.valid).toBe(false);
            expect(result.disposable).toBe(true);
            expect(result.reason_codes).toContain('email.disposable_domain');
            expect(mockRedis.sismember).toHaveBeenCalledWith('disposable_domains', 'disposable.com');
        });

        it('should use cache from Redis for full email', async () => {
            const mockRedis = mockRedisInstance as any;
            const cachedResult = {
                valid: true,
                normalized: 'cached@example.com',
                disposable: false,
                mx_found: true,
                reason_codes: [],
                request_id: '123e4567-e89b-12d3-a456-426614174000',
                ttl_seconds: 2592000
            };
            const hash = crypto.createHash('sha1').update('cached@example.com').digest('hex');
            mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedResult));

            const result = await validateEmail('cached@example.com', mockRedis);

            expect(result).toEqual(cachedResult);
            expect(mockRedis.get).toHaveBeenCalledWith(`validator:email:${hash}`);
            // No further validations since cache hit
            expect(hapi.isEmailValid).not.toHaveBeenCalled();
            expect(mockDns.resolveMx).not.toHaveBeenCalled();
        });

        it('should use domain cache for MX and disposable', async () => {
            const mockRedis = mockRedisInstance as any;
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
            mockDns.resolveMx.mockRejectedValue(new Error('ETIMEDOUT'));
            mockDns.resolve4.mockRejectedValue(new Error('ETIMEDOUT'));
            mockDns.resolve6.mockRejectedValue(new Error('ETIMEDOUT'));

            const result = await validateEmail('test@timeout.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.mx_not_found');
            expect(result.mx_found).toBe(false);
        });

        it('should handle server error gracefully', async () => {
            // Simulate error in parsing or something
            const originalSplit = String.prototype.split;
            String.prototype.split = jest.fn(() => { throw new Error('Parse error'); });

            const result = await validateEmail('error@example.com');

            expect(result.valid).toBe(false);
            expect(result.reason_codes).toContain('email.server_error');

            // Restore
            String.prototype.split = originalSplit;
        });

        it('should normalize email with ASCII domain', async () => {
            // Test with international domain, but since url.domainToASCII, assume simple
            const result = await validateEmail('Test@EXAMPLE.COM');

            expect(result.normalized).toBe('test@example.com');
        });

        it('should cache result in Redis after computation', async () => {
            const mockRedis = mockRedisInstance as any;
            mockRedis.get.mockResolvedValue(null); // No cache

            await validateEmail('uncached@example.com', mockRedis);

            const hash = crypto.createHash('sha1').update('uncached@example.com').digest('hex');
            expect(mockRedis.set).toHaveBeenCalledWith(
                `validator:email:${hash}`,
                expect.stringContaining('uncached@example.com'),
                'EX',
                30 * 24 * 3600
            );
        });

        it('should cache domain data in Redis', async () => {
            const mockRedis = mockRedisInstance as any;
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

    describe('POST /v1/validate/email', () => {
        it('should validate a valid email using default success mocks', async () => {
            // This test relies entirely on the default setup in beforeEach
            const res = await request(app.server)
                .post('/v1/validate/email')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'test@example.com' });

            expect(res.statusCode).toBe(200);
            expect(res.body.valid).toBe(true);
            expect(res.body.disposable).toBe(false);
            expect(res.body.mx_found).toBe(true);
        });

        it('should reject disposable email when Redis finds a match', async () => {
            // Override Redis mock to simulate finding a disposable domain
            mockRedisInstance.sismember.mockImplementation((setName: string, domain: string) =>
                Promise.resolve(domain === 'disposable.com' ? 1 : 0)
            );

            // Also override the main validator mock to return a disposable result
            mockValidateEmail.mockResolvedValue({
                valid: false,
                normalized: 'test@disposable.com',
                disposable: true,
                mx_found: true,
                reason_codes: ['email.disposable_domain'],
            });

            const res = await request(app.server)
                .post('/v1/validate/email')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'test@disposable.com' });

            expect(res.statusCode).toBe(200);
            expect(res.body.valid).toBe(false);
            expect(res.body.disposable).toBe(true);
            expect(res.body.reason_codes).toContain('email.disposable_domain');
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
            });

            const res = await request(app.server)
                .post('/v1/validate/email')
                .set('Authorization', 'Bearer valid_key')
                .send({ email: 'invalid-email' });

            expect(res.statusCode).toBe(200);
            expect(res.body.valid).toBe(false);
            expect(res.body.reason_codes).toContain('email.invalid_format');
        });
    });
});