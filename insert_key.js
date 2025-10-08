import { createHash } from 'crypto';
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const KEY = 'ok_test_a450e23f007460bc2a01e5ec715a12a76952';
const hash = createHash('sha256').update(KEY).digest('hex');

(async () => {
  await pool.query('INSERT INTO api_keys(project_id, prefix, hash, status) VALUES ((SELECT id FROM projects LIMIT 1), $1, $2, $3) ON CONFLICT DO NOTHING', [KEY.slice(0,6), hash, 'active']);
  console.log('Inserted key');
  await pool.end();
})();