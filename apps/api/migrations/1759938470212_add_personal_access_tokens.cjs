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

  pgm.addColumn('users', {
    role: { type: 'text', default: 'developer' }
  });

  pgm.addColumn('api_keys', {
    encrypted_key: { type: 'text' }
  });

  pgm.createTable('audit_logs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    action: { type: 'text', notNull: true },
    resource: { type: 'text', notNull: true },
    details: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('audit_logs', 'user_id');
  pgm.createIndex('audit_logs', 'created_at');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.dropTable('audit_logs');
  pgm.dropColumn('personal_access_tokens', 'scopes');
  pgm.dropColumn('users', 'role');
  pgm.dropColumn('api_keys', 'encrypted_key');
  pgm.dropTable('personal_access_tokens');
};

module.exports = { shorthands, up, down };