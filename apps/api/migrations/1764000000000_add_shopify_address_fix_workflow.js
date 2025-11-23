/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
    // Create enum for fix status
    pgm.sql(`
    CREATE TYPE shopify_address_fix_status AS ENUM ('pending', 'confirmed', 'cancelled');
  `);

    // Create shopify_order_address_fixes table
    pgm.sql(`
    CREATE TABLE shopify_order_address_fixes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_domain text NOT NULL,
      order_id bigint NOT NULL,
      order_gid text NOT NULL,
      customer_email text,
      original_address jsonb NOT NULL,
      normalized_address jsonb NOT NULL,
      token_hash text NOT NULL,
      token_expires_at timestamptz NOT NULL,
      fix_status shopify_address_fix_status NOT NULL DEFAULT 'pending',
      fulfillment_hold_ids text[] DEFAULT '{}',
      sent_to_flow_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_shop_domain FOREIGN KEY (shop_domain) 
        REFERENCES shopify_shops(shop_domain) ON DELETE CASCADE
    );
  `);

    // Create indexes for efficient querying
    pgm.sql(`CREATE INDEX idx_shopify_address_fixes_shop_order ON shopify_order_address_fixes(shop_domain, order_id);`);
    pgm.sql(`CREATE UNIQUE INDEX idx_shopify_address_fixes_token_hash ON shopify_order_address_fixes(token_hash);`);
    pgm.sql(`CREATE INDEX idx_shopify_address_fixes_status ON shopify_order_address_fixes(fix_status) WHERE fix_status = 'pending';`);
    pgm.sql(`CREATE INDEX idx_shopify_address_fixes_expires ON shopify_order_address_fixes(token_expires_at) WHERE fix_status = 'pending';`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS shopify_order_address_fixes;`);
    pgm.sql(`DROP TYPE IF EXISTS shopify_address_fix_status;`);
};
