-- Enable extensions for fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Customers table for deduplication
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

CREATE INDEX IF NOT EXISTS idx_customers_project ON customers(project_id);
CREATE INDEX IF NOT EXISTS idx_customers_email_gin ON customers USING gin(email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_phone_gin ON customers USING gin(phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_name_gin ON customers USING gin((first_name || ' ' || last_name) gin_trgm_ops);

-- Addresses table for deduplication
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

CREATE INDEX IF NOT EXISTS idx_addresses_project ON addresses(project_id);
CREATE INDEX IF NOT EXISTS idx_addresses_normalized_gin ON addresses USING gin((line1 || ' ' || city || ' ' || postal_code || ' ' || country) gin_trgm_ops);

-- Orders table for deduplication
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

CREATE INDEX IF NOT EXISTS idx_orders_project ON orders(project_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_gin ON orders USING gin((customer_email || ' ' || customer_phone) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);