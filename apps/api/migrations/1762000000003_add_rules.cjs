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
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS rules;`);
};

module.exports = { shorthands, up, down };