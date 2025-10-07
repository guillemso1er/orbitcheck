import type { Pool } from 'pg';

import { environment } from '../environment.js';

export async function runLogRetention(pool: Pool): Promise<void> {
  try {
    const result = await pool.query(
      'DELETE FROM logs WHERE created_at < NOW() - INTERVAL $1',
      [environment.RETENTION_DAYS + ' days']
    );
    console.warn(`Retention job deleted ${result.rowCount} old log entries`);
  } catch (error) {
    console.error('Retention job failed:', error);
  }
}