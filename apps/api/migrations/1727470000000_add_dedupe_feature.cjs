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
  // Enable extensions for fuzzy matching
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

  // Customers table for deduplication
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS customers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        email text,
        phone text,
        first_name text,
        last_name text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_customers_project ON customers(project_id);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_customers_email_gin ON customers USING gin(email gin_trgm_ops);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_customers_phone_gin ON customers USING gin(phone gin_trgm_ops);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_customers_name_gin ON customers USING gin((first_name || ' ' || last_name) gin_trgm_ops);`);

  // Addresses table for deduplication
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS addresses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        line1 text NOT NULL,
        line2 text,
        city text NOT NULL,
        state text,
        postal_code text NOT NULL,
        country text NOT NULL,
        lat double precision,
        lng double precision,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_addresses_project ON addresses(project_id);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_addresses_normalized_gin ON addresses USING gin((line1 || ' ' || city || ' ' || postal_code || ' ' || country) gin_trgm_ops);`);

  // Orders table for deduplication
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        order_id text NOT NULL UNIQUE,
        customer_email text,
        customer_phone text,
        shipping_address jsonb,
        billing_address jsonb,
        total_amount numeric,
        currency text,
        status text DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_orders_project ON orders(project_id);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_orders_customer_gin ON orders USING gin((customer_email || ' ' || customer_phone) gin_trgm_ops);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);`);

  // Add normalized fields and hashes for deterministic deduplication
  pgm.sql(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS normalized_email text;`);
  pgm.sql(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS normalized_phone text;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_customers_normalized_email ON customers(normalized_email) WHERE normalized_email IS NOT NULL;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_customers_normalized_phone ON customers(normalized_phone) WHERE normalized_phone IS NOT NULL;`);

  pgm.sql(`ALTER TABLE addresses ADD COLUMN IF NOT EXISTS address_hash text;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_addresses_address_hash ON addresses(address_hash) WHERE address_hash IS NOT NULL;`);

  // For fuzzy, ensure GIN indexes on specific fields
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin((first_name || ' ' || last_name) gin_trgm_ops);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_addresses_line1_trgm ON addresses USING gin(line1 gin_trgm_ops);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_addresses_city_trgm ON addresses USING gin(city gin_trgm_ops);`);

  pgm.sql(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS merged_to uuid REFERENCES customers(id);`);
  pgm.sql(`ALTER TABLE addresses ADD COLUMN IF NOT EXISTS merged_to uuid REFERENCES addresses(id);`);

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
  pgm.sql(`ALTER TABLE customers DROP COLUMN IF EXISTS merged_to;`);
  pgm.sql(`ALTER TABLE addresses DROP COLUMN IF EXISTS merged_to;`);
  pgm.sql(`ALTER TABLE customers DROP COLUMN IF EXISTS normalized_phone;`);
  pgm.sql(`ALTER TABLE customers DROP COLUMN IF EXISTS normalized_email;`);
  pgm.sql(`ALTER TABLE addresses DROP COLUMN IF EXISTS address_hash;`);
  pgm.sql(`DROP TABLE IF EXISTS orders;`);
  pgm.sql(`DROP TABLE IF EXISTS addresses;`);
  pgm.sql(`DROP TABLE IF EXISTS customers;`);
};

module.exports = { shorthands, up, down };