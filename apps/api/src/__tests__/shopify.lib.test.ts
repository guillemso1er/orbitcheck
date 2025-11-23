import nodeCrypto from 'node:crypto';

import jwt from 'jsonwebtoken';

import { decryptShopifyToken, encryptShopifyToken } from '../integrations/shopify/lib/crypto.js';
import { verifyHmac } from '../integrations/shopify/lib/hmac.js';
import { verifyShopifySessionToken } from '../integrations/shopify/lib/jwt.js';
import { missingScopes, parseScopes } from '../integrations/shopify/lib/scopes.js';

describe('Shopify scope helpers', () => {
    it('parses comma-separated scopes and normalizes casing', () => {
        expect(parseScopes('read_orders,WRITE_ORDERS,write_customers')).toEqual([
            'read_orders',
            'write_orders',
            'write_customers',
        ]);
    });

    it('reports which required scopes are missing', () => {
        expect(missingScopes(['read_orders', 'read_customers'])).toEqual(['write_orders', 'write_customers']);
    });
});

describe('Shopify crypto helpers', () => {
    it('encrypts and decrypts Shopify tokens', async () => {
        const secret = 'final_secret';
        const encrypted = await encryptShopifyToken(secret);
        expect(decryptShopifyToken(encrypted)).toBe(secret);
    });

    it('throws when decrypt payload is invalid', () => {
        expect(() => decryptShopifyToken('bad')).toThrow('Invalid encrypted Shopify token');
    });
});

describe('Shopify session token middleware', () => {
    it('rejects requests without a bearer token', async () => {
        const handler = verifyShopifySessionToken('key', 'secret');
        const request = { headers: {}, log: { warn: jest.fn() } } as any;
        const reply = { header: jest.fn().mockReturnThis(), code: jest.fn().mockReturnThis(), send: jest.fn() } as any;
        await handler(request, reply);
        expect(reply.header).toHaveBeenCalledWith('X-Shopify-Retry-Invalid-Session-Request', '1');
        expect(reply.code).toHaveBeenCalledWith(401);
    });

    it('attaches the shop domain when the token is valid', async () => {
        const handler = verifyShopifySessionToken('key', 'secret');
        const token = jwt.sign({ aud: 'key', dest: 'https://test-store.myshopify.com' }, 'secret', { algorithm: 'HS256' });
        const request = { headers: { authorization: `Bearer ${token}` }, log: { warn: jest.fn() } } as any;
        const reply = { header: jest.fn().mockReturnThis(), code: jest.fn().mockReturnThis(), send: jest.fn() } as any;
        await handler(request, reply);
        expect(request.shopDomain).toBe('test-store.myshopify.com');
        expect(reply.code).not.toHaveBeenCalled();
    });
});

describe('Shopify HMAC helper', () => {
    it('rejects invalid signatures', async () => {
        const handler = verifyHmac('secret');
        const request: any = {
            headers: {
                'x-shopify-hmac-sha256': 'bad',
                'x-shopify-topic': 'orders/create',
                'x-shopify-shop-domain': 'test-shop.myshopify.com',
            },
            rawBody: Buffer.from('payload'),
            log: {
                warn: jest.fn(),
            },
        };
        const reply = { code: jest.fn().mockReturnThis(), send: jest.fn() } as any;
        await handler(request, reply);
        expect(reply.code).toHaveBeenCalledWith(401);
        expect(request.log.warn).toHaveBeenCalled();
    });

    it('logs debug info when signatures validate', async () => {
        const handler = verifyHmac('secret');
        const body = Buffer.from('payload');
        const digest = nodeCrypto.createHmac('sha256', 'secret').update(body).digest('base64');
        const request: any = {
            headers: {
                'x-shopify-hmac-sha256': digest,
                'x-shopify-topic': 'orders/create',
                'x-shopify-shop-domain': 'test-shop.myshopify.com',
            },
            rawBody: body,
            log: {
                debug: jest.fn(),
                warn: jest.fn(),
            },
        };
        const reply = { code: jest.fn(), send: jest.fn() } as any;
        await handler(request, reply);
        expect(reply.code).not.toHaveBeenCalled();
        expect(request.log.debug).toHaveBeenCalled();
    });
});