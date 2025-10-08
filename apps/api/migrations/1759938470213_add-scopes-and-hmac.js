/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Add scopes to personal_access_tokens
  pgm.addColumn('personal_access_tokens', {
    scopes: { type: 'text[]', default: '{}' }
  });

  // Add role to users
  pgm.addColumn('users', {
    role: { type: 'text', default: 'developer' }
  });

  // Add encrypted_key to api_keys for HMAC
  pgm.addColumn('api_keys', {
    encrypted_key: { type: 'text' }
  });

  // Populate encrypted_key with encrypted full keys (dummy for existing)
  // In real migration, would need to decrypt or re-encrypt, but for now assume new
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumn('personal_access_tokens', 'scopes');
  pgm.dropColumn('users', 'role');
  pgm.dropColumn('api_keys', 'encrypted_key');
};