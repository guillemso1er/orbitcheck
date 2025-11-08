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
};

module.exports = { shorthands, up, down };