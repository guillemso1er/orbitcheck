import { FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import type { Pool } from 'pg';

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
    pool: Pool
) {
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

    // Create OrbitCheck session (using existing session infrastructure)
    const sessionMaxAge = 2592000000; // 30 days in ms (same as "remember me")

    if ((request as any).session?.set) {
        (request as any).session.set('user_id', user.id);
        (request as any).session.set('maxAge', sessionMaxAge);
    } else {
        (request as any).session.user_id = user.id;
        (request as any).session.maxAge = sessionMaxAge;
    }

    // Generate CSRF token
    const csrf = crypto.randomBytes(32).toString('base64url');

    // Set cookies (same pattern as loginUser in auth.ts)
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax' as const,
        path: '/',
        domain: isProduction ? 'orbitcheck.io' : undefined,
        maxAge: sessionMaxAge / 1000, // Convert to seconds
    };

    // Set CSRF token as HttpOnly cookie for server-side verification
    reply.setCookie('csrf_token', csrf, cookieOptions);

    // Set CSRF token as non-HttpOnly cookie for client to read
    reply.setCookie('csrf_token_client', csrf, {
        ...cookieOptions,
        httpOnly: false,
    });

    // Set session cookie
    reply.setCookie('orbitcheck_session', (request as any).session.id, cookieOptions);

    request.log.info(
        { shopDomain, userId: user.id, email: user.email },
        'Created dashboard session for Shopify merchant'
    );

    return reply.send({
        success: true,
        user: {
            id: user.id,
            email: user.email,
        },
        project_id: shop.project_id,
        dashboard_url: process.env.DASHBOARD_URL || 'https://dashboard.orbitcheck.io',
    });
}
