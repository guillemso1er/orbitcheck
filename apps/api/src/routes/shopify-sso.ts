import { randomBytes } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

interface ShopifySSOQuery {
    token?: string;
}

/**
 * Shopify SSO endpoint - exchanges a one-time token for a session cookie.
 * This enables cross-domain authentication from Shopify app to Dashboard.
 * 
 * Flow:
 * 1. User clicks "Open Dashboard" in Shopify app
 * 2. Shopify app calls /api/shopify/dashboard-session which generates a one-time token
 * 3. User is redirected to /auth/shopify-sso?token=xxx
 * 4. This endpoint validates the token, creates a session, and redirects to dashboard home
 */
export async function shopifySSOHandler(
    request: FastifyRequest<{ Querystring: ShopifySSOQuery }>,
    reply: FastifyReply,
    pool: Pool,
    redis: any
): Promise<void> {
    const { token } = request.query;

    if (!token || typeof token !== 'string') {
        return reply.code(400).send({
            error: {
                code: 'INVALID_REQUEST',
                message: 'Missing or invalid token parameter',
            },
        });
    }

    // Retrieve user_id from Redis using the token
    const redisKey = `shopify_sso:${token}`;

    request.log.info({
        token: token.substring(0, 8) + '...',
        redisKey,
        redisConnected: redis?.status === 'ready',
    }, 'Attempting to retrieve SSO token from Redis');

    const data = await redis.get(redisKey);

    request.log.info({
        token: token.substring(0, 8) + '...',
        dataFound: !!data,
        data: data ? data.substring(0, 50) + '...' : null,
    }, 'Redis lookup result');

    if (!data) {
        request.log.warn({ token: token.substring(0, 8) + '...' }, 'Invalid or expired SSO token');
        return reply.code(401).send({
            error: {
                code: 'INVALID_TOKEN',
                message: 'This link has expired or is invalid. Please try again from the Shopify app.',
            },
        });
    }

    // Delete the token immediately (one-time use)
    await redis.del(redisKey);

    const { user_id, shop_domain } = JSON.parse(data);

    // Verify user still exists
    const userResult = await pool.query(
        'SELECT id, email FROM users WHERE id = $1',
        [user_id]
    );

    if (userResult.rows.length === 0) {
        request.log.error({ userId: user_id }, 'User from SSO token no longer exists');
        return reply.code(500).send({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Account not found. Please contact support.',
            },
        });
    }

    const user = userResult.rows[0];

    // Create session (same pattern as loginUser)
    const sessionMaxAge = 2592000000; // 30 days

    if ((request as any).session?.set) {
        (request as any).session.set('user_id', user.id);
        (request as any).session.set('maxAge', sessionMaxAge);
    } else {
        (request as any).session.user_id = user.id;
        (request as any).session.maxAge = sessionMaxAge;
    }

    // Generate CSRF token
    const csrf = randomBytes(32).toString('base64url');

    // Set CSRF cookies
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax' as const,
        path: '/',
        domain: isProduction ? 'orbitcheck.io' : undefined,
        maxAge: sessionMaxAge / 1000,
    };

    reply.setCookie('csrf_token', csrf, cookieOptions);
    reply.setCookie('csrf_token_client', csrf, {
        ...cookieOptions,
        httpOnly: false,
    });

    request.log.info(
        { userId: user.id, email: user.email, shopDomain: shop_domain },
        'Shopify SSO successful - session created'
    );

    // Redirect to dashboard home
    const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:5173';
    return reply.redirect(dashboardUrl);
}

