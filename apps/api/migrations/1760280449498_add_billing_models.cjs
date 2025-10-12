/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  // Create accounts table (orgs)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        stripe_customer_id text UNIQUE,
        stripe_subscription_id text UNIQUE,
        stripe_item_ids jsonb,
        plan_tier text NOT NULL,
        included_validations int NOT NULL DEFAULT 0,
        included_stores int NOT NULL DEFAULT 0,
        billing_status text NOT NULL DEFAULT 'active',
        trial_end timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Indexes for accounts
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_accounts_stripe_customer_id ON accounts(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_accounts_stripe_subscription_id ON accounts(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_accounts_plan_tier ON accounts(plan_tier);`);

  // Create stores table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS stores (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        platform text NOT NULL,
        domain text NOT NULL,
        status text NOT NULL DEFAULT 'sandbox',
        connected_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Indexes for stores
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_stores_account_id ON stores(account_id);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_stores_domain ON stores(domain);`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_account_domain ON stores(account_id, domain);`);

  // Alter api_keys table to add new columns
  pgm.sql(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;`);
  pgm.sql(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id) ON DELETE CASCADE;`);
  pgm.sql(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS env text NOT NULL DEFAULT 'test';`);
  pgm.sql(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_limit_cfg jsonb DEFAULT '{}';`);

  // Indexes for api_keys
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_api_keys_account_id ON api_keys(account_id) WHERE account_id IS NOT NULL;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_api_keys_store_id ON api_keys(store_id) WHERE store_id IS NOT NULL;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_api_keys_env ON api_keys(env);`);

  // Create validations table (events log for metrics/dedup)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS validations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
        checkout_id text,
        request_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        dedup_hash text,
        billable boolean NOT NULL DEFAULT false,
        cost_units int NOT NULL DEFAULT 0
    );
  `);

  // Indexes for validations
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_validations_account_id ON validations(account_id);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_validations_store_id ON validations(store_id) WHERE store_id IS NOT NULL;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_validations_created_at ON validations(created_at);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_validations_dedup_hash ON validations(dedup_hash) WHERE dedup_hash IS NOT NULL;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_validations_billable ON validations(billable);`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS validations;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_api_keys_env;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_api_keys_store_id;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_api_keys_account_id;`);
  pgm.sql(`ALTER TABLE api_keys DROP COLUMN IF EXISTS rate_limit_cfg;`);
  pgm.sql(`ALTER TABLE api_keys DROP COLUMN IF EXISTS env;`);
  pgm.sql(`ALTER TABLE api_keys DROP COLUMN IF EXISTS store_id;`);
  pgm.sql(`ALTER TABLE api_keys DROP COLUMN IF EXISTS account_id;`);
  pgm.sql(`DROP TABLE IF EXISTS stores;`);
  pgm.sql(`DROP TABLE IF EXISTS accounts;`);
};

module.exports = { shorthands, up, down };