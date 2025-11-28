import crypto from 'node:crypto';
import { promisify } from 'node:util';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import { environment } from '../../../environment.js';

/**
 * Create OrbitCheck dashboard session for a Shopify merchant.
 * This endpoint bridges Shopify embedded app authentication to dashboard session cookies.
 * 
 * Flow:
 * 1. Shopify app calls this endpoint with session token (validated by shopifySessionToken guard)
 * 2. We resolve the user_id from shopify_shops
 * 3. We create an OrbitCheck session and set cookies
 * 4. Return success - client can then redirect to dashboard
 */
export async function createDashboardSession(
    request: FastifyRequest,
    reply: FastifyReply,
    pool: Pool,
    redis: Redis
): Promise<FastifyReply> {
    // shopDomain is attached by the shopifySessionToken guard
    const shopDomain = (request as any).shopDomain as string | undefined;

    if (!shopDomain) {
        request.log.warn('Missing shopDomain in dashboard session request');
        return reply.code(401).send({
            error: {
                code: 'UNAUTHORIZED',
                message: 'Invalid Shopify session',
            },
        });
    }

    // Resolve user_id from shopify_shops
    const shopResult = await pool.query(
        `SELECT user_id, onboarding_status, project_id 
     FROM shopify_shops 
     WHERE shop_domain = $1`,
        [shopDomain]
    );

    if (shopResult.rows.length === 0) {
        request.log.warn({ shopDomain }, 'Shop not found in database');
        return reply.code(404).send({
            error: {
                code: 'SHOP_NOT_FOUND',
                message: 'Shop installation not found. Please reinstall the app.',
            },
        });
    }

    const shop = shopResult.rows[0];

    if (!shop.user_id) {
        request.log.warn(
            { shopDomain, onboardingStatus: shop.onboarding_status },
            'Shop not yet onboarded to OrbitCheck'
        );
        return reply.code(503).send({
            error: {
                code: 'ONBOARDING_INCOMPLETE',
                message: 'Your account is still being set up. Please try again in a moment.',
            },
        });
    }

    // Verify user still exists
    const userResult = await pool.query(
        'SELECT id, email FROM users WHERE id = $1',
        [shop.user_id]
    );

    if (userResult.rows.length === 0) {
        request.log.error(
            { shopDomain, userId: shop.user_id },
            'User referenced by shop no longer exists'
        );
        return reply.code(500).send({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Account configuration error. Please contact support.',
            },
        });
    }

    const user = userResult.rows[0];

    // Generate a one-time token for cross-domain session establishment
    // This token will be exchanged for a session cookie on the dashboard domain
    const randomBytesAsync = promisify(crypto.randomBytes);
    const buffer = await randomBytesAsync(32);
    const oneTimeToken = buffer.toString('base64url');

    // Store the user_id associated with this token in Redis (TTL: 60 seconds)
    if (redis) {
        const redisKey = `shopify_sso:${oneTimeToken}`;
        const tokenData = JSON.stringify({ user_id: user.id, shop_domain: shopDomain });

        request.log.info({
            redisKey,
            tokenData,
            redisConnected: redis?.status === 'ready',
        }, 'Storing SSO token in Redis');

        await redis.setex(
            redisKey,
            60, // 60 seconds TTL
            tokenData
        );

        // Verify it was stored
        const verification = await redis.get(redisKey);
        request.log.info({
            redisKey,
            stored: !!verification,
            ttl: await redis.ttl(redisKey),
        }, 'Redis storage verification');
    } else {
        request.log.error('Redis not available for SSO token storage');
    }

    request.log.info(
        {
            shopDomain,
            userId: user.id,
            email: user.email,
            oneTimeToken: oneTimeToken.substring(0, 8) + '...',
        },
        'Created one-time token for Shopify SSO to dashboard'
    );

    // The SSO URL should point to the API's /auth/shopify-sso endpoint
    // which will validate the token, create the session, and redirect to the dashboard
    const apiUrl = environment.BASE_URL || 'http://localhost:8080';
    const ssoUrl = `${apiUrl}/auth/shopify-sso?token=${oneTimeToken}`;

    return reply.send({
        success: true,
        user: {
            id: user.id,
            email: user.email,
        },
        project_id: shop.project_id,
        dashboard_url: ssoUrl, // Return API SSO URL with token
    });
}
