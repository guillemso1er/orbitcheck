/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

export const up = (pgm) => {
    pgm.sql(`
    CREATE TABLE shopify_gdpr_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id uuid NOT NULL REFERENCES shopify_shops(id) ON DELETE CASCADE,
      topic text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      received_at timestamptz NOT NULL DEFAULT now()
    );
  `);

    pgm.sql(`CREATE INDEX idx_shopify_gdpr_events_shop ON shopify_gdpr_events(shop_id);`);
};

export const down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS shopify_gdpr_events;`);
};