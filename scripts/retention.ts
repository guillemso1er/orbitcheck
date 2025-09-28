#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { env } from '../apps/api/src/env';

async function runRetention() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const result = await pool.query(
      'DELETE FROM logs WHERE created_at < NOW() - INTERVAL \'90 days\''
    );
    console.log(`Deleted ${result.rowCount} old log entries`);
  } catch (error) {
    console.error('Retention job failed:', error);
  } finally {
    await pool.end();
  }
}

runRetention();