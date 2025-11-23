import type { FastifyBaseLogger } from 'fastify';

import type { AddressFixEmailParams} from './email-service.js';
import { CompositeEmailService, KlaviyoEmailService, ShopifyFlowEmailService } from './email-service.js';

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
