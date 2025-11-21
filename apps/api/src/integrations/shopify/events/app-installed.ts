import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { createShopifyOnboardingService } from '../../../services/shopify-onboarding.js';
import { createShopifyService } from '../../../services/shopify.js';
import { shopifyGraphql } from '../lib/graphql.js';
import { missingScopes, parseScopes } from '../lib/scopes.js';
import { captureShopifyEvent } from '../lib/telemetry.js';

type AppInstalledPayload = {
    shop: string;
    accessToken: string;
    grantedScopes: string[] | string;
};

const QUERY_SHOP_METADATA = `
  query getShop {
    shop {
      name
      email
      myshopifyDomain
      primaryDomain {
        url
      }
      currencyCode
      ianaTimezone
      plan {
        displayName
      }
    }
  }
`;

export async function appInstalled(request: FastifyRequest, reply: FastifyReply, pool: Pool): Promise<FastifyReply> {
    const { shop, accessToken, grantedScopes } = request.body as AppInstalledPayload;

    if (!shop || typeof shop !== 'string' || !accessToken || typeof accessToken !== 'string') {
        request.log.warn({ body: request.body }, 'Invalid Shopify app installed payload');
        return reply.code(400).send({
            error: {
                code: 'INVALID_INSTALL_PAYLOAD',
                message: 'The Shopify installation payload is missing the shop or access token.',
            },
        });
    }

    const normalizedScopes = parseScopes(grantedScopes);
    const missing = missingScopes(normalizedScopes);
    if (missing.length > 0) {
        request.log.warn({ shop, missing }, 'Shopify installation missing required scopes');
        return reply.code(400).send({
            error: {
                code: 'MISSING_REQUIRED_SCOPES',
                message: `Missing required scopes: ${missing.join(', ')}`,
            },
        });
    }

    request.log.debug({ shop, scopes: normalizedScopes }, 'Persisting Shopify installation token');

    const shopifyService = createShopifyService(pool);
    await shopifyService.storeShopToken(shop, accessToken, normalizedScopes);

    // Get the shop_id from the database after storing token
    const shopResult = await pool.query(
        'SELECT id FROM shopify_shops WHERE shop_domain = $1',
        [shop]
    );

    if (shopResult.rows.length === 0) {
        request.log.error({ shop }, 'Failed to retrieve shop_id after storing token');
        return reply.code(500).send({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Failed to complete installation.',
            },
        });
    }

    const shopId = shopResult.rows[0].id;

    // Fetch shop metadata from Shopify Admin API
    let shopMetadata;
    try {
        request.log.debug({ shop }, 'Fetching shop metadata from Shopify Admin API');
        const client = await shopifyGraphql(shop, accessToken, process.env.SHOPIFY_API_VERSION || '2024-01');
        const response = await client.query(QUERY_SHOP_METADATA, {});
        shopMetadata = response.data?.shop;

        if (!shopMetadata) {
            throw new Error('No shop data returned from Shopify API');
        }

        request.log.debug({ shop, shopMetadata }, 'Successfully fetched shop metadata');
    } catch (error) {
        request.log.error(
            { shop, error: error instanceof Error ? error.message : 'Unknown error' },
            'Failed to fetch shop metadata from Shopify'
        );
        // Continue with default metadata rather than failing the install
        shopMetadata = {
            name: shop.replace('.myshopify.com', ''),
            email: `admin@${shop}`, // Fallback email
            myshopifyDomain: shop,
            domain: shop,
        };
    }

    // Run onboarding asynchronously after responding to avoid timeout
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    queueMicrotask(async () => {
        const onboardingService = createShopifyOnboardingService(pool, request.log);
        try {
            const result = await onboardingService.onboardShop(shopId, {
                name: shopMetadata.name,
                email: shopMetadata.email,
                domain: shopMetadata.primaryDomain?.url || shopMetadata.myshopifyDomain,
                myshopifyDomain: shopMetadata.myshopifyDomain,
                currencyCode: shopMetadata.currencyCode,
                ianaTimezone: shopMetadata.ianaTimezone,
                plan: shopMetadata.plan,
            });

            request.log.info(
                {
                    shop,
                    userId: result.userId,
                    accountId: result.accountId,
                    projectId: result.projectId,
                    isNewUser: result.isNewUser,
                },
                'Shopify merchant onboarded successfully'
            );

            captureShopifyEvent(shop, 'signup', {
                scopes: normalizedScopes,
                user_id: result.userId,
                project_id: result.projectId,
                is_new_user: result.isNewUser,
            });
        } catch (error) {
            request.log.error(
                { shop, error: error instanceof Error ? error.message : 'Unknown error' },
                'Failed to onboard Shopify merchant'
            );
            await onboardingService.markOnboardingFailed(
                shopId,
                error instanceof Error ? error.message : 'Unknown error'
            );
        }
    });

    request.log.info({ shop }, 'Registered Shopify installation from app-installed event');

    return reply.code(200).send({ status: 'ok' });
}
