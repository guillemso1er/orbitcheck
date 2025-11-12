/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const up = async (pgm) => {
  pgm.sql(`
    CREATE TABLE webhooks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      url text NOT NULL,
      events text[] NOT NULL DEFAULT '{}',
      secret text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      last_fired_at timestamptz
    );
  `);
  pgm.sql(`CREATE INDEX ON webhooks(project_id);`);
  pgm.sql(`CREATE INDEX ON webhooks(status);`);

  pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS data_residency text CHECK (data_residency IN ('eu', 'us'));`);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      country_defaults jsonb NOT NULL DEFAULT '{}',
      formatting jsonb NOT NULL DEFAULT '{}',
      risk_thresholds jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_project_id ON settings(project_id);`);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name text NOT NULL,
      description text NOT NULL,
      logic text NOT NULL,
      severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
      action text NOT NULL DEFAULT 'hold' CHECK (action IN ('approve', 'hold', 'block')),
      priority integer NOT NULL DEFAULT 0,
      metadata jsonb,
      enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_rules_project_id ON rules(project_id);`);

  // Add unique constraint for rule names within a project
  pgm.sql(`
    ALTER TABLE rules 
    ADD CONSTRAINT rules_project_name_unique 
    UNIQUE (project_id, name);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE rules 
    DROP CONSTRAINT IF EXISTS rules_project_name_unique;
  `);
  pgm.sql(`DROP TABLE IF EXISTS rules;`);
  pgm.sql(`DROP TABLE IF EXISTS settings;`);
  pgm.sql(`ALTER TABLE users DROP COLUMN IF EXISTS data_residency;`);
  pgm.dropTable('webhooks');
};

module.exports = { shorthands, up, down };