ALTER TABLE customers ADD COLUMN IF NOT EXISTS merged_to uuid REFERENCES customers(id);
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS merged_to uuid REFERENCES addresses(id);