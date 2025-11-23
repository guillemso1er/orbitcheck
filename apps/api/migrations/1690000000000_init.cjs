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
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  pgm.sql(`
    CREATE TABLE projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    plan text NOT NULL DEFAULT 'dev',
    created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TABLE api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    prefix text NOT NULL,
    hash text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
    );
  `);

  pgm.sql(`
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
  `);

  pgm.sql(`
    CREATE TABLE usage_daily (
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    date date NOT NULL,
    validations int NOT NULL DEFAULT 0,
    orders int NOT NULL DEFAULT 0,
    PRIMARY KEY(project_id, date)
    );
  `);

  // GeoNames postal table (load later)
  pgm.sql(`
    CREATE TABLE geonames_postal (
    country_code text,
    postal_code text,
    place_name text,
    admin_name1 text, 
    admin_code1 text,
    admin_name2 text, 
    admin_code2 text, 
    latitude double precision,
    longitude double precision
    );
  `);
  pgm.sql(`CREATE INDEX ON geonames_postal(country_code, postal_code);`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS geonames_postal;`);
  pgm.sql(`DROP TABLE IF EXISTS usage_daily;`);
  pgm.sql(`DROP TABLE IF EXISTS logs;`);
  pgm.sql(`DROP TABLE IF EXISTS api_keys;`);
  pgm.sql(`DROP TABLE IF EXISTS projects;`);
};

module.exports = { shorthands, up, down };