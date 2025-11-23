import crypto from 'node:crypto';
import { promisify } from 'node:util';

import bcrypt from 'bcryptjs';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool, PoolClient } from 'pg';

import { BCRYPT_ROUNDS } from '../config.js';

export interface ShopMetadata {
    name: string;
    email: string;
    domain: string;
    myshopifyDomain: string;
    primaryDomain?: string;
    currencyCode?: string;
    ianaTimezone?: string;
    plan?: {
        displayName: string;
    };
}

export interface OnboardingResult {
    userId: string;
    accountId: string;
    storeId: string;
    projectId: string;
    shopId: string;
    isNewUser: boolean;
    isNewAccount: boolean;
}

/**
 * Service for onboarding Shopify merchants into OrbitCheck core data model.
 * Handles user/account/project/store creation and linking.
 */
export class ShopifyOnboardingService {
    constructor(
        private pool: Pool,
        private logger: FastifyBaseLogger
    ) { }

    /**
     * Onboard a Shopify shop by creating/linking user, account, store, and project.
     * This is idempotent - multiple calls with the same shop won't create duplicates.
     */
    async onboardShop(
        shopId: string,
        shopMetadata: ShopMetadata
    ): Promise<OnboardingResult> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            this.logger.info(
                { shopId, shopDomain: shopMetadata.myshopifyDomain },
                'Starting Shopify shop onboarding'
            );

            // 1. Upsert user by shop owner email
            const { userId, isNewUser } = await this.upsertUser(
                client,
                shopMetadata.email,
                shopMetadata.name
            );

            // 2. Create or get account for the user
            const { accountId, isNewAccount } = await this.upsertAccount(
                client,
                userId
            );

            // 3. Create store linked to account and shop
            const storeId = await this.upsertStore(
                client,
                accountId,
                shopId,
                shopMetadata.myshopifyDomain
            );

            // 4. Create project for the shop
            const projectId = await this.upsertProject(
                client,
                userId,
                shopMetadata.name
            );

            // 5. Update shopify_shops with all foreign keys
            await this.linkShopToCore(client, shopId, {
                userId,
                accountId,
                storeId,
                projectId,
            });

            await client.query('COMMIT');

            this.logger.info(
                {
                    shopId,
                    userId,
                    accountId,
                    storeId,
                    projectId,
                    isNewUser,
                    isNewAccount,
                },
                'Shopify shop onboarding completed'
            );

            return {
                userId,
                accountId,
                storeId,
                projectId,
                shopId,
                isNewUser,
                isNewAccount,
            };
        } catch (error) {
            await client.query('ROLLBACK');
            this.logger.error(
                { error, shopId, shopDomain: shopMetadata.myshopifyDomain },
                'Shopify shop onboarding failed'
            );
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Upsert user by email. For new users, generates a random password and sets up
     * password reset token (merchant will use magic link or Shopify session auth).
     */
    private async upsertUser(
        client: PoolClient,
        email: string,
        shopName: string
    ): Promise<{ userId: string; isNewUser: boolean }> {
        // Check if user exists
        const existingUser = await client.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            return { userId: existingUser.rows[0].id, isNewUser: false };
        }

        // Generate random password for new user
        const randomBytesAsync = promisify(crypto.randomBytes);
        const randomPassword = (await randomBytesAsync(32)).toString('hex');
        const hashedPassword = await bcrypt.hash(randomPassword, BCRYPT_ROUNDS);

        // Extract first/last name from shop name (fallback)
        const nameParts = shopName.split(' ');
        const firstName = nameParts[0] || shopName;
        const lastName = nameParts.slice(1).join(' ') || '';

        const result = await client.query(
            `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
            [email, hashedPassword, firstName, lastName]
        );

        this.logger.info(
            { userId: result.rows[0].id, email },
            'Created new user for Shopify shop'
        );

        return { userId: result.rows[0].id, isNewUser: true };
    }

    /**
     * Upsert account for the user. Assigns free plan by default.
     */
    private async upsertAccount(
        client: PoolClient,
        userId: string
    ): Promise<{ accountId: string; isNewAccount: boolean }> {
        // Check if user already has an account
        const existingAccount = await client.query(
            'SELECT id FROM accounts WHERE user_id = $1',
            [userId]
        );

        if (existingAccount.rows.length > 0) {
            return {
                accountId: existingAccount.rows[0].id,
                isNewAccount: false,
            };
        }

        // Create new account with free plan
        const result = await client.query(
            `INSERT INTO accounts (user_id, plan_tier, billing_status)
       VALUES ($1, 'free', 'active')
       RETURNING id`,
            [userId]
        );

        this.logger.info(
            { accountId: result.rows[0].id, userId },
            'Created new account for Shopify user'
        );

        return { accountId: result.rows[0].id, isNewAccount: true };
    }

    /**
     * Upsert store linked to account and shopify_shops.
     */
    private async upsertStore(
        client: PoolClient,
        accountId: string,
        shopId: string,
        shopDomain: string
    ): Promise<string> {
        // Check if store exists for this shop_id
        const existingStore = await client.query(
            'SELECT id FROM stores WHERE shop_id = $1',
            [shopId]
        );

        if (existingStore.rows.length > 0) {
            return existingStore.rows[0].id;
        }

        // Create new store
        const result = await client.query(
            `INSERT INTO stores (account_id, shop_id, platform, domain, status, connected_at)
       VALUES ($1, $2, 'shopify', $3, 'active', now())
       RETURNING id`,
            [accountId, shopId, shopDomain]
        );

        this.logger.info(
            { storeId: result.rows[0].id, accountId, shopId, shopDomain },
            'Created new store for Shopify shop'
        );

        return result.rows[0].id;
    }

    /**
     * Upsert project for the user named after the shop.
     */
    private async upsertProject(
        client: PoolClient,
        userId: string,
        shopName: string
    ): Promise<string> {
        // Use shop name as project name, truncate if too long
        const projectName = shopName.substring(0, 100);

        // Check if user already has a project with this name
        const existingProject = await client.query(
            'SELECT id FROM projects WHERE user_id = $1 AND name = $2',
            [userId, projectName]
        );

        if (existingProject.rows.length > 0) {
            return existingProject.rows[0].id;
        }

        // Create new project
        const result = await client.query(
            `INSERT INTO projects (name, user_id, plan)
       VALUES ($1, $2, 'dev')
       RETURNING id`,
            [projectName, userId]
        );

        this.logger.info(
            { projectId: result.rows[0].id, userId, projectName },
            'Created new project for Shopify shop'
        );

        return result.rows[0].id;
    }

    /**
     * Link shopify_shops row to all core entities.
     */
    private async linkShopToCore(
        client: PoolClient,
        shopId: string,
        links: {
            userId: string;
            accountId: string;
            storeId: string;
            projectId: string;
        }
    ): Promise<void> {
        await client.query(
            `UPDATE shopify_shops 
       SET user_id = $1, 
           account_id = $2, 
           store_id = $3, 
           project_id = $4,
           onboarding_status = 'completed',
           last_synced_at = now()
       WHERE id = $5`,
            [links.userId, links.accountId, links.storeId, links.projectId, shopId]
        );

        this.logger.debug(
            { shopId, ...links },
            'Linked shopify_shops to core entities'
        );
    }

    /**
     * Mark onboarding as failed for a shop.
     */
    async markOnboardingFailed(shopId: string, error: string): Promise<void> {
        await this.pool.query(
            `UPDATE shopify_shops 
       SET onboarding_status = 'failed',
           last_synced_at = now()
       WHERE id = $1`,
            [shopId]
        );

        this.logger.error(
            { shopId, error },
            'Marked Shopify shop onboarding as failed'
        );
    }

    /**
     * Get onboarding status for a shop.
     */
    async getOnboardingStatus(
        shopDomain: string
    ): Promise<{
        status: 'pending' | 'completed' | 'failed';
        userId?: string;
        projectId?: string;
    } | null> {
        const result = await this.pool.query(
            `SELECT onboarding_status, user_id, project_id 
       FROM shopify_shops 
       WHERE shop_domain = $1`,
            [shopDomain]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return {
            status: result.rows[0].onboarding_status || 'pending',
            userId: result.rows[0].user_id,
            projectId: result.rows[0].project_id,
        };
    }
}

export function createShopifyOnboardingService(
    pool: Pool,
    logger: FastifyBaseLogger
): ShopifyOnboardingService {
    return new ShopifyOnboardingService(pool, logger);
}
