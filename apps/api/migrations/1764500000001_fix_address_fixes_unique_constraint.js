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
    // Drop the old non-unique index
    pgm.sql(`DROP INDEX IF EXISTS idx_shopify_address_fixes_shop_order;`);

    // Create the new unique index required for ON CONFLICT
    pgm.sql(`
    CREATE UNIQUE INDEX idx_shopify_address_fixes_shop_order_unique 
    ON shopify_order_address_fixes(shop_domain, order_id);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
    // Revert back to non-unique index
    pgm.sql(`DROP INDEX IF EXISTS idx_shopify_address_fixes_shop_order_unique;`);

    pgm.sql(`
    CREATE INDEX idx_shopify_address_fixes_shop_order 
    ON shopify_order_address_fixes(shop_domain, order_id);
  `);
};
