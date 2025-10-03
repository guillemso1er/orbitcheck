import type { Pool } from 'pg';

import { environment } from '../env.js';

export async function runLogRetention(pool: Pool) {
  try {
    const result = await pool.query(
      'DELETE FROM logs WHERE created_at < NOW() - INTERVAL $1',
      [environment.RETENTION_DAYS + ' days']
    );
    console.log(`Retention job deleted ${result.rowCount} old log entries`);
  } catch (error) {
    console.error('Retention job failed:', error);
  }
}