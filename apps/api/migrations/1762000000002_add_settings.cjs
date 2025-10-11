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
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS settings;`);
};

module.exports = { shorthands, up, down };