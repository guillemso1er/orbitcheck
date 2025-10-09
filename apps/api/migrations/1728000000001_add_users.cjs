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
  // Add users table for dashboard authentication
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text UNIQUE NOT NULL,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Add user_id to projects
  pgm.sql(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`);

  // Create index on user_id
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);`);

  // Create index on users email
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_users_email;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_projects_user_id;`);
  pgm.sql(`ALTER TABLE projects DROP COLUMN IF EXISTS user_id;`);
  pgm.sql(`DROP TABLE IF EXISTS users;`);
};

module.exports = { shorthands, up, down };