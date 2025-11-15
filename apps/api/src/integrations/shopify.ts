import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { getAccessScopes } from './shopify/api/access-scopes.js';
import { getShopSettings, updateShopSettings } from './shopify/api/shop-settings.js';
import { callback } from './shopify/auth/callback.js';
import { install } from './shopify/auth/install.js';
import { setCsp } from './shopify/lib/csp.js';
import { rawBody, verifyHmac } from './shopify/lib/hmac.js';
import { preventDuplicates } from './shopify/lib/idempotency.js';
import { verifyShopifySessionToken } from './shopify/lib/jwt.js';
import { appUninstalled } from './shopify/webhooks/app-uninstalled.js';
import { customersDataRequest, customersRedact, shopRedact } from './shopify/webhooks/gdpr.js';
import { ordersCreate } from './shopify/webhooks/orders-create.js';

async function shopifyIntegration(app: FastifyInstance) {
    const appKey = process.env.SHOPIFY_API_KEY!;
    const appSecret = process.env.SHOPIFY_API_SECRET!;

    // Auth routes
    app.get('/integrations/shopify/auth/install', install);
    app.get('/integrations/shopify/auth/callback', callback);

    // API routes with session token verification
    app.addHook('preHandler', async (request, reply) => {
        if (request.url.startsWith('/integrations/shopify/api/')) {
            await verifyShopifySessionToken(appKey, appSecret)(request, reply);
        }
    });
    app.get('/integrations/shopify/api/shop-settings', getShopSettings);
    app.post('/integrations/shopify/api/shop-settings', updateShopSettings);
    app.get('/integrations/shopify/api/access-scopes', getAccessScopes);

    // Webhook routes with HMAC and idempotency
    app.addHook('preHandler', async (request, reply) => {
        if (request.url.startsWith('/integrations/shopify/webhooks/')) {
            await rawBody()(request, reply);
            await verifyHmac(appSecret)(request, reply);
            await preventDuplicates()(request, reply);
        }
    });
    app.post('/integrations/shopify/webhooks/orders-create', ordersCreate);
    app.post('/integrations/shopify/webhooks/app-uninstalled', appUninstalled);
    app.post('/integrations/shopify/webhooks/gdpr/customers-data-request', customersDataRequest);
    app.post('/integrations/shopify/webhooks/gdpr/customers-redact', customersRedact);
    app.post('/integrations/shopify/webhooks/gdpr/shop-redact', shopRedact);

    // CSP for embedded app
    app.addHook('preHandler', setCsp());
}

export default fp(shopifyIntegration, { name: 'shopify-integration' });