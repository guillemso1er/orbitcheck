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
  // Create function to normalize email and phone
  pgm.sql(`
    CREATE OR REPLACE FUNCTION normalize_customer_fields() RETURNS trigger AS $$
    BEGIN
      NEW.normalized_email = lower(trim(NEW.email));
      NEW.normalized_phone = regexp_replace(NEW.phone, '[^0-9+]', '', 'g');
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Create trigger
  pgm.sql(`
    CREATE TRIGGER normalize_customer_trigger BEFORE INSERT OR UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION normalize_customer_fields();
  `);

  // Update existing customers
  pgm.sql(`
    UPDATE customers SET email = email WHERE normalized_email IS NULL;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TRIGGER IF EXISTS normalize_customer_trigger ON customers;`);
  pgm.sql(`DROP FUNCTION IF EXISTS normalize_customer_fields();`);
};

module.exports = { shorthands, up, down };