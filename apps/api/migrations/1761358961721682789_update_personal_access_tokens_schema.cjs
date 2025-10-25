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
  // Drop existing personal_access_tokens table
  pgm.dropTable('personal_access_tokens');

  // Create new personal_access_tokens table according to requirements
  pgm.createTable('personal_access_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    token_id: { type: 'text', notNull: true, unique: true },
    hashed_secret: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    scopes: { type: 'text[]', notNull: true },
    ip_allowlist: { type: 'cidr[]', default: '{}' },
    project_id: { type: 'uuid', references: 'projects(id)', onDelete: 'SET NULL' },
    env: { type: 'text', notNull: true, check: pgm.func("(env in ('test','live'))") },
    expires_at: { type: 'timestamptz' },
    last_used_at: { type: 'timestamptz' },
    last_used_ip: { type: 'inet' },
    disabled: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('personal_access_tokens', 'org_id');
  pgm.createIndex('personal_access_tokens', 'user_id');
  pgm.createIndex('personal_access_tokens', 'token_id');
  pgm.createIndex('personal_access_tokens', 'hashed_secret');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  // Drop new table
  pgm.dropTable('personal_access_tokens');

  // Recreate old table structure
  pgm.createTable('personal_access_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    token_hash: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_used_at: { type: 'timestamptz' },
  });
  pgm.createIndex('personal_access_tokens', 'user_id');
  pgm.createIndex('personal_access_tokens', 'token_hash');

  pgm.addColumn('personal_access_tokens', {
    scopes: { type: 'text[]', default: '{}' }
  });
};

module.exports = { shorthands, up, down };