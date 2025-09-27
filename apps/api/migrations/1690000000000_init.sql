CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE projects (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
name text NOT NULL,
plan text NOT NULL DEFAULT 'dev',
created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
prefix text NOT NULL,
hash text NOT NULL,
status text NOT NULL DEFAULT 'active',
created_at timestamptz NOT NULL DEFAULT now(),
last_used_at timestamptz
);

CREATE TABLE logs (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
type text NOT NULL,
endpoint text NOT NULL,
reason_codes text[] NOT NULL DEFAULT '{}',
status int NOT NULL,
meta jsonb NOT NULL DEFAULT '{}',
created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usage_daily (
project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
date date NOT NULL,
validations int NOT NULL DEFAULT 0,
orders int NOT NULL DEFAULT 0,
PRIMARY KEY(project_id, date)
);

-- GeoNames postal table (load later)
CREATE TABLE geonames_postal (
country_code text,
postal_code text,
place_name text,
admin_name1 text,
admin_code1 text,
latitude double precision,
longitude double precision
);
CREATE INDEX ON geonames_postal(country_code, postal_code);