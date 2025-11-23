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
    // Create shopify_shops table
    pgm.sql(`
    CREATE TABLE shopify_shops (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_domain text UNIQUE NOT NULL,
      access_token text NOT NULL,
      scopes text[] NOT NULL DEFAULT '{}',
      installed_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

    // Create shopify_settings table
    pgm.sql(`
    CREATE TABLE shopify_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id uuid NOT NULL REFERENCES shopify_shops(id) ON DELETE CASCADE,
      mode text NOT NULL DEFAULT 'disabled' CHECK (mode IN ('disabled', 'notify', 'activated')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(shop_id)
    );
  `);

    // Create indexes
    pgm.sql(`CREATE INDEX idx_shopify_shops_domain ON shopify_shops(shop_domain);`);
    pgm.sql(`CREATE INDEX idx_shopify_settings_shop_id ON shopify_settings(shop_id);`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS shopify_settings;`);
    pgm.sql(`DROP TABLE IF EXISTS shopify_shops;`);
};
