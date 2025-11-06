import cron from 'node-cron';
import type { Pool } from 'pg';

export function setupCronJobs(pool: Pool): void {
  // Daily cleanup of old logs based on retention_days
  cron.schedule('0 2 * * *', async () => {
    try {
      // Get all users with their plans and retention days
      const result = await pool.query(`
        SELECT 
          u.id as user_id,
          p.logs_retention_days
        FROM users u
        JOIN plans p ON u.plan_id = p.id
        WHERE p.logs_retention_days IS NOT NULL AND p.logs_retention_days > 0
      `);

      for (const user of result.rows) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - user.logs_retention_days);

        // Delete old logs for this user
        await pool.query(
          'DELETE FROM logs WHERE user_id = $1 AND created_at < $2',
          [user.user_id, cutoffDate.toISOString()]
        );

        console.log(`Cleaned up logs for user ${user.user_id} older than ${user.logs_retention_days} days`);
      }

      console.log('Daily logs retention cleanup completed');
    } catch (error) {
      console.error('Logs retention cleanup failed:', error);
    }
  });

  // Monthly usage reset (1st of every month at 3 AM)
  cron.schedule('0 3 1 * *', async () => {
    try {
      // Reset monthly validation counters
      await pool.query('UPDATE users SET monthly_validations_used = 0 WHERE monthly_validations_used > 0');
      
      // Log the reset
      console.log('Monthly validation usage counters reset');
    } catch (error) {
      console.error('Monthly usage reset failed:', error);
    }
  });

  // Weekly cleanup of completed jobs (older than 30 days)
  cron.schedule('0 1 * * 0', async () => {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);

      const deletedJobs = await pool.query(
        'DELETE FROM jobs WHERE status = $1 AND updated_at < $2 RETURNING id',
        ['completed', cutoffDate.toISOString()]
      );

      console.log(`Cleaned up ${deletedJobs.rowCount} completed jobs older than 30 days`);
    } catch (error) {
      console.error('Weekly jobs cleanup failed:', error);
    }
  });

  console.log('Cron jobs scheduled: logs retention, monthly reset, weekly cleanup');
}