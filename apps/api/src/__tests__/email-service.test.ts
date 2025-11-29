import type { FastifyBaseLogger } from 'fastify';

import type { AddressFixEmailParams } from '../services/email/email-service.js';
import {
    BrevoEmailService,
    CompositeEmailService,
    KlaviyoEmailService,
    ShopifyFlowEmailService,
} from '../services/email/email-service.js';

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock logger
const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
} as unknown as FastifyBaseLogger;

describe('EmailService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.KLAVIYO_API_KEY = 'test-key';
        process.env.KLAVIYO_TEMPLATE_ID = 'test-template';
        process.env.BREVO_API_KEY = 'brevo-test-key';
        process.env.BREVO_TEMPLATE_ID = '123';
        process.env.BREVO_SENDER_EMAIL = 'noreply@orbitcheck.io';
        process.env.BREVO_SENDER_NAME = 'OrbitCheck';
    });

    describe('KlaviyoEmailService', () => {
        it('should send email via Klaviyo API', async () => {
            const service = new KlaviyoEmailService(mockLogger);
            const params: AddressFixEmailParams = {
                shopDomain: 'test.myshopify.com',
                customerEmail: 'customer@example.com',
                customerName: 'John Doe',
                fixUrl: 'https://orbitcheck.io/fix',
                orderId: '123',
                orderGid: 'gid://shopify/Order/123',
                orderName: '#123',
                address1: '123 Main St',
                city: 'New York',
                province: 'NY',
                zip: '10001',
                country: 'US'
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({})
            });

            await service.sendAddressFixEmail(params);

            expect(mockFetch).toHaveBeenCalledWith('https://a.klaviyo.com/api/events', expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Authorization': 'Klaviyo-API-Key test-key'
                })
            }));

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.data.attributes.profile.email).toBe('customer@example.com');
            expect(body.data.attributes.properties.fix_url).toBe('https://orbitcheck.io/fix');
        });

        it('should log warning if API key is missing', async () => {
            process.env.KLAVIYO_API_KEY = '';
            const service = new KlaviyoEmailService(mockLogger);
            const params: AddressFixEmailParams = {
                shopDomain: 'test.myshopify.com',
                customerEmail: 'customer@example.com',
                fixUrl: 'https://orbitcheck.io/fix',
                orderId: '123',
                orderGid: 'gid://shopify/Order/123',
                orderName: '#123',
                address1: '123 Main St',
                city: 'New York',
                province: 'NY',
                zip: '10001',
                country: 'US'
            };

            await service.sendAddressFixEmail(params);

            expect(mockFetch).not.toHaveBeenCalled();
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ shop: 'test.myshopify.com' }), expect.stringContaining('Skipping Klaviyo email'));
        });
    });

    describe('BrevoEmailService', () => {
        it('should send email via Brevo API with template', async () => {
            const service = new BrevoEmailService(mockLogger);
            const params: AddressFixEmailParams = {
                shopDomain: 'test.myshopify.com',
                customerEmail: 'customer@example.com',
                customerName: 'John Doe',
                fixUrl: 'https://orbitcheck.io/fix',
                orderId: '123',
                orderGid: 'gid://shopify/Order/123',
                orderName: '#123',
                address1: '123 Main St',
                city: 'New York',
                province: 'NY',
                zip: '10001',
                country: 'US'
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ messageId: '<abc123@smtp.brevo.com>' })
            });

            await service.sendAddressFixEmail(params);

            expect(mockFetch).toHaveBeenCalledWith('https://api.brevo.com/v3/smtp/email', expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'api-key': 'brevo-test-key',
                    'Content-Type': 'application/json',
                    'accept': 'application/json',
                })
            }));

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.templateId).toBe(123);
            expect(body.to[0].email).toBe('customer@example.com');
            expect(body.to[0].name).toBe('John Doe');
            expect(body.sender.email).toBe('noreply@orbitcheck.io');
            expect(body.sender.name).toBe('OrbitCheck');
            expect(body.params.FIX_URL).toBe('https://orbitcheck.io/fix');
            expect(body.params.FIRSTNAME).toBe('John');
            expect(body.params.LASTNAME).toBe('Doe');
            expect(body.params.ORDER_NAME).toBe('#123');
            expect(body.params.SHOP_NAME).toBe('test.myshopify.com');
            expect(body.params.SHIPPING_ADDRESS.address1).toBe('123 Main St');
        });

        it('should send email with inline HTML template when no template ID is set', async () => {
            process.env.BREVO_TEMPLATE_ID = '';
            const service = new BrevoEmailService(mockLogger);
            const params: AddressFixEmailParams = {
                shopDomain: 'test.myshopify.com',
                shopName: 'Test Shop',
                customerEmail: 'customer@example.com',
                customerName: 'John Doe',
                fixUrl: 'https://orbitcheck.io/fix?token=abc123',
                orderId: '123',
                orderGid: 'gid://shopify/Order/123',
                orderName: '#123',
                address1: '123 Main St',
                address2: 'Apt 4B',
                city: 'New York',
                province: 'NY',
                zip: '10001',
                country: 'US'
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ messageId: '<abc123@smtp.brevo.com>' })
            });

            await service.sendAddressFixEmail(params);

            expect(mockFetch).toHaveBeenCalled();

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            // Should NOT have templateId
            expect(body.templateId).toBeUndefined();
            // Should have htmlContent and subject
            expect(body.subject).toContain('Action Required');
            expect(body.subject).toContain('#123');
            expect(body.htmlContent).toContain('John Doe');
            expect(body.htmlContent).toContain('123 Main St');
            expect(body.htmlContent).toContain('Apt 4B');
            expect(body.htmlContent).toContain('New York');
            expect(body.htmlContent).toContain('https://orbitcheck.io/fix?token=abc123');
            expect(body.htmlContent).toContain('Test Shop');
            expect(body.htmlContent).toContain('Verify My Address');
        });

        it('should log warning if API key is missing', async () => {
            process.env.BREVO_API_KEY = '';
            const service = new BrevoEmailService(mockLogger);
            const params: AddressFixEmailParams = {
                shopDomain: 'test.myshopify.com',
                customerEmail: 'customer@example.com',
                fixUrl: 'https://orbitcheck.io/fix',
                orderId: '123',
                orderGid: 'gid://shopify/Order/123',
                orderName: '#123',
                address1: '123 Main St',
                city: 'New York',
                province: 'NY',
                zip: '10001',
                country: 'US'
            };

            await service.sendAddressFixEmail(params);

            expect(mockFetch).not.toHaveBeenCalled();
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ shop: 'test.myshopify.com' }), expect.stringContaining('Skipping Brevo email'));
        });

        it('should log warning if sender email is missing', async () => {
            process.env.BREVO_SENDER_EMAIL = '';
            const service = new BrevoEmailService(mockLogger);
            const params: AddressFixEmailParams = {
                shopDomain: 'test.myshopify.com',
                customerEmail: 'customer@example.com',
                fixUrl: 'https://orbitcheck.io/fix',
                orderId: '123',
                orderGid: 'gid://shopify/Order/123',
                orderName: '#123',
                address1: '123 Main St',
                city: 'New York',
                province: 'NY',
                zip: '10001',
                country: 'US'
            };

            await service.sendAddressFixEmail(params);

            expect(mockFetch).not.toHaveBeenCalled();
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ shop: 'test.myshopify.com' }), expect.stringContaining('Skipping Brevo email: Missing Sender Email'));
        });

        it('should handle API errors gracefully', async () => {
            const service = new BrevoEmailService(mockLogger);
            const params: AddressFixEmailParams = {
                shopDomain: 'test.myshopify.com',
                customerEmail: 'customer@example.com',
                fixUrl: 'https://orbitcheck.io/fix',
                orderId: '123',
                orderGid: 'gid://shopify/Order/123',
                orderName: '#123',
                address1: '123 Main St',
                city: 'New York',
                province: 'NY',
                zip: '10001',
                country: 'US'
            };

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                text: async () => '{"code":"invalid_parameter","message":"Invalid email"}'
            });

            // Should not throw
            await service.sendAddressFixEmail(params);

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({ shop: 'test.myshopify.com' }),
                'Failed to send Brevo email'
            );
        });

        it('should escape HTML special characters in template', async () => {
            process.env.BREVO_TEMPLATE_ID = '';
            const service = new BrevoEmailService(mockLogger);
            const params: AddressFixEmailParams = {
                shopDomain: 'test.myshopify.com',
                shopName: 'Test <Script> Shop',
                customerEmail: 'customer@example.com',
                customerName: 'John "Danger" Doe',
                fixUrl: 'https://orbitcheck.io/fix',
                orderId: '123',
                orderGid: 'gid://shopify/Order/123',
                orderName: '#123',
                address1: '123 Main & Oak St',
                city: 'New York',
                province: 'NY',
                zip: '10001',
                country: 'US'
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ messageId: '<abc123@smtp.brevo.com>' })
            });

            await service.sendAddressFixEmail(params);

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            // Should have escaped HTML entities
            expect(body.htmlContent).toContain('Test &lt;Script&gt; Shop');
            expect(body.htmlContent).toContain('John &quot;Danger&quot; Doe');
            expect(body.htmlContent).toContain('123 Main &amp; Oak St');
        });
    });

    describe('ShopifyFlowEmailService', () => {
        it('should log delegation to Shopify Flow', async () => {
            const service = new ShopifyFlowEmailService(mockLogger);
            const params: AddressFixEmailParams = {
                shopDomain: 'test.myshopify.com',
                customerEmail: 'customer@example.com',
                fixUrl: 'https://orbitcheck.io/fix',
                orderId: '123',
                orderGid: 'gid://shopify/Order/123',
                orderName: '#123',
                address1: '123 Main St',
                city: 'New York',
                province: 'NY',
                zip: '10001',
                country: 'US'
            };

            await service.sendAddressFixEmail(params);

            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.objectContaining({ shop: 'test.myshopify.com' }),
                expect.stringContaining('Address fix email delegated to Shopify Flow')
            );
        });
    });

    describe('CompositeEmailService', () => {
        it('should call all services', async () => {
            const service1 = { sendAddressFixEmail: jest.fn().mockResolvedValue(undefined) };
            const service2 = { sendAddressFixEmail: jest.fn().mockResolvedValue(undefined) };
            const composite = new CompositeEmailService([service1, service2]);

            const params: AddressFixEmailParams = {
                shopDomain: 'test.myshopify.com',
                customerEmail: 'customer@example.com',
                customerName: 'John Doe',
                fixUrl: 'https://orbitcheck.io/fix',
                orderId: '123',
                orderGid: 'gid://shopify/Order/123',
                orderName: '#123',
                address1: '123 Main St',
                city: 'New York',
                province: 'NY',
                zip: '10001',
                country: 'US'
            };

            await composite.sendAddressFixEmail(params);

            expect(service1.sendAddressFixEmail).toHaveBeenCalledWith(params);
            expect(service2.sendAddressFixEmail).toHaveBeenCalledWith(params);
        });
    });
});
