-- Add normalized fields and hashes for deterministic deduplication
ALTER TABLE customers ADD COLUMN IF NOT EXISTS normalized_email text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS normalized_phone text;
CREATE INDEX IF NOT EXISTS idx_customers_normalized_email ON customers(normalized_email) WHERE normalized_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_normalized_phone ON customers(normalized_phone) WHERE normalized_phone IS NOT NULL;

ALTER TABLE addresses ADD COLUMN IF NOT EXISTS address_hash text;
CREATE INDEX IF NOT EXISTS idx_addresses_address_hash ON addresses(address_hash) WHERE address_hash IS NOT NULL;

-- For fuzzy, ensure GIN indexes on specific fields
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin((first_name || ' ' || last_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_addresses_line1_trgm ON addresses USING gin(line1 gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_addresses_city_trgm ON addresses USING gin(city gin_trgm_ops);