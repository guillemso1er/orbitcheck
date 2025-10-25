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
  pgm.sql(`
    CREATE TABLE personal_access_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_id text NOT NULL UNIQUE,
      hashed_secret text NOT NULL,
      name text NOT NULL,
      scopes text[] NOT NULL,
      ip_allowlist cidr[] DEFAULT '{}',
      project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
      env text NOT NULL CHECK (env IN ('test', 'live')),
      expires_at timestamptz,
      last_used_at timestamptz,
      last_used_ip inet,
      disabled boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`CREATE INDEX ON personal_access_tokens(user_id);`);
  pgm.sql(`CREATE INDEX ON personal_access_tokens(token_id);`);
  pgm.sql(`CREATE INDEX ON personal_access_tokens(hashed_secret);`);

  pgm.sql(`ALTER TABLE users ADD COLUMN role text DEFAULT 'developer';`);
  pgm.sql(`ALTER TABLE api_keys ADD COLUMN encrypted_key text;`);

  pgm.sql(`
    CREATE TABLE audit_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action text NOT NULL,
      resource text NOT NULL,
      details jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`CREATE INDEX ON audit_logs(user_id);`);
  pgm.sql(`CREATE INDEX ON audit_logs(created_at);`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TABLE audit_logs;`);
  pgm.sql(`ALTER TABLE users DROP COLUMN role;`);
  pgm.sql(`ALTER TABLE api_keys DROP COLUMN encrypted_key;`);
  pgm.sql(`DROP TABLE personal_access_tokens;`);
};

module.exports = { shorthands, up, down };