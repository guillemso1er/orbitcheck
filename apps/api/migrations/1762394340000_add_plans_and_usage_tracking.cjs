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
  // Ensure pgcrypto extension is available
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // Create plans table
  pgm.sql(`
    CREATE TABLE plans (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      price numeric(10,2) DEFAULT 0,
      validations_limit integer NOT NULL DEFAULT 1000,
      projects_limit integer NOT NULL DEFAULT 2,
      logs_retention_days integer NOT NULL DEFAULT 7,
      features jsonb DEFAULT '{}',
      overage_rate numeric(6,4) DEFAULT 0.0100,
      max_overage integer DEFAULT 2000,
      sla text DEFAULT 'none',
      is_custom boolean DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Create indexes for plans
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_plans_slug ON plans(slug);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_plans_name ON plans(name);`);

  // Seed default plans first
  pgm.sql(`
    INSERT INTO plans (name, slug, price, validations_limit, projects_limit, logs_retention_days, features, overage_rate, max_overage, sla)
    VALUES
      ('Free (Developer)', 'free', 0.00, 1000, 2, 7, '{"basic_rules": true, "dedupe": "basic", "support": "community"}', 0.0100, 2000, 'none'),
      ('Starter', 'starter', 49.00, 10000, 5, 90, '{"basic_rules": true, "dedupe": "basic", "support": "standard", "validations": ["email", "phone", "address", "vat", "id"]}', 0.0060, 10000, 'none'),
      ('Growth', 'growth', 149.00, 50000, 15, 180, '{"all_v1_features": true, "webhooks": true, "support": "priority"}', 0.0040, 50000, 'none'),
      ('Scale', 'scale', 399.00, 200000, 40, 365, '{"all_v1_features": true, "review_queues": true, "bi_export": true, "sla": "99.9"}', 0.0025, 200000, '99.9'),
      ('Enterprise', 'enterprise', 1500.00, -1, -1, 365, '{"all_features": true, "sso": true, "custom_limits": true, "dedicated_support": true, "sla": "99.95"}', 0.0000, -1, '99.95')
    ON CONFLICT (slug) DO NOTHING;
  `);

  // Add plan_id to users table (nullable initially)
  pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_id uuid;`);

  // Add usage tracking columns to users
  pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_validations_used integer DEFAULT 0 NOT NULL;`);
  pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'active' NOT NULL;`);
  pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_end_date timestamptz;`);

  // Add indexes for user plan fields
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_users_plan_id ON users(plan_id);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_users_monthly_validations_used ON users(monthly_validations_used);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);`);

  // Set default plan for all existing users to free plan
  pgm.sql(`
    UPDATE users
    SET plan_id = (SELECT id FROM plans WHERE slug = 'free')
    WHERE plan_id IS NULL;
  `);

  // Create a function to set default plan for new users
  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_default_user_plan()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.plan_id IS NULL THEN
        SELECT id INTO NEW.plan_id FROM plans WHERE slug = 'free' LIMIT 1;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Create trigger to set default plan for new users
  pgm.sql(`
    DROP TRIGGER IF EXISTS set_default_plan_on_user_insert ON users;
    CREATE TRIGGER set_default_plan_on_user_insert
      BEFORE INSERT ON users
      FOR EACH ROW
      EXECUTE FUNCTION set_default_user_plan();
  `);

  // Update the column definition to set NOT NULL
  pgm.sql(`ALTER TABLE users ALTER COLUMN plan_id SET NOT NULL;`);

  // Add foreign key constraint separately after plans table exists
  pgm.sql(`ALTER TABLE users ADD CONSTRAINT fk_users_plan_id FOREIGN KEY (plan_id) REFERENCES plans(id);`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  // Drop foreign key constraint first
  pgm.sql(`ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_plan_id;`);

  // Drop trigger and function
  pgm.sql(`DROP TRIGGER IF EXISTS set_default_plan_on_user_insert ON users;`);
  pgm.sql(`DROP FUNCTION IF EXISTS set_default_user_plan();`);

  // Drop usage tracking columns
  pgm.dropColumn('users', 'monthly_validations_used');
  pgm.dropColumn('users', 'subscription_status');
  pgm.dropColumn('users', 'trial_end_date');

  // Drop plan_id column
  pgm.dropColumn('users', 'plan_id');

  // Drop indexes
  pgm.dropIndex('users', ['plan_id']);
  pgm.dropIndex('users', ['monthly_validations_used']);
  pgm.dropIndex('users', ['subscription_status']);

  // Drop plans table
  pgm.dropTable('plans');
};

module.exports = { shorthands, up, down };
