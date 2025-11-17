/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Link Shopify shops to OrbitCheck core data model (users, accounts, stores, projects).
 * This migration enables automatic onboarding of Shopify merchants.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
    // 1. Add user_id to accounts if missing (should already exist but being defensive)
    pgm.sql(`
    ALTER TABLE accounts 
    ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
  `);

    pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_accounts_user_id 
    ON accounts(user_id) WHERE user_id IS NOT NULL;
  `);

    // 2. Add shop_id to stores to link to shopify_shops
    pgm.sql(`
    ALTER TABLE stores 
    ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES shopify_shops(id) ON DELETE CASCADE;
  `);

    pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_stores_shop_id 
    ON stores(shop_id) WHERE shop_id IS NOT NULL;
  `);

    // 3. Add foreign keys to shopify_shops to link to core model
    pgm.sql(`
    ALTER TABLE shopify_shops 
    ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
  `);

    // 4. Add audit/sync tracking columns to shopify_shops
    pgm.sql(`
    ALTER TABLE shopify_shops 
    ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
    ADD COLUMN IF NOT EXISTS onboarding_status text DEFAULT 'pending' 
      CHECK (onboarding_status IN ('pending', 'completed', 'failed'));
  `);

    // 5. Create indexes for shopify_shops foreign keys
    pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_shopify_shops_user_id 
    ON shopify_shops(user_id) WHERE user_id IS NOT NULL;
  `);

    pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_shopify_shops_account_id 
    ON shopify_shops(account_id) WHERE account_id IS NOT NULL;
  `);

    pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_shopify_shops_store_id 
    ON shopify_shops(store_id) WHERE store_id IS NOT NULL;
  `);

    pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_shopify_shops_project_id 
    ON shopify_shops(project_id) WHERE project_id IS NOT NULL;
  `);

    pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_shopify_shops_onboarding_status 
    ON shopify_shops(onboarding_status) WHERE onboarding_status = 'pending';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
    // Drop indexes first
    pgm.sql(`DROP INDEX IF EXISTS idx_shopify_shops_onboarding_status;`);
    pgm.sql(`DROP INDEX IF EXISTS idx_shopify_shops_project_id;`);
    pgm.sql(`DROP INDEX IF EXISTS idx_shopify_shops_store_id;`);
    pgm.sql(`DROP INDEX IF EXISTS idx_shopify_shops_account_id;`);
    pgm.sql(`DROP INDEX IF EXISTS idx_shopify_shops_user_id;`);
    pgm.sql(`DROP INDEX IF EXISTS idx_stores_shop_id;`);
    pgm.sql(`DROP INDEX IF EXISTS idx_accounts_user_id;`);

    // Drop columns from shopify_shops
    pgm.sql(`
    ALTER TABLE shopify_shops 
    DROP COLUMN IF EXISTS onboarding_status,
    DROP COLUMN IF EXISTS last_synced_at,
    DROP COLUMN IF EXISTS project_id,
    DROP COLUMN IF EXISTS store_id,
    DROP COLUMN IF EXISTS account_id,
    DROP COLUMN IF EXISTS user_id;
  `);

    // Drop columns from stores
    pgm.sql(`ALTER TABLE stores DROP COLUMN IF EXISTS shop_id;`);

    // Drop columns from accounts
    pgm.sql(`ALTER TABLE accounts DROP COLUMN IF EXISTS user_id;`);
};
