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
  await pgm.query(`
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
  await pgm.query(`CREATE INDEX ON webhooks(project_id);`);
  await pgm.query(`CREATE INDEX ON webhooks(status);`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.dropTable('webhooks');
};

module.exports = { shorthands, up, down };