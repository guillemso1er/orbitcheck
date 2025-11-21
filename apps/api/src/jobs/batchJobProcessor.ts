import type { Job } from "bullmq";
import type { Redis } from 'ioredis';
import type { Pool } from "pg";

export interface BatchJobInput {
  data: any[];
}

export interface BatchJobResult {
  index: number;
  input: any;
  result?: any;
  error?: string;
}

export interface BatchJobProcessor<TInput extends BatchJobInput, TResult extends BatchJobResult> {
  (
    job: Job<TInput & { project_id: string }>,
    pool: Pool,
    redis?: Redis
  ): Promise<TResult[]>;
}

/**
 * Generic batch job processor that handles the common pattern of:
 * - Updating job status to processing
 * - Processing each item in the data array
 * - Updating progress
 * - Storing results and marking as completed
 * - Handling errors and marking as failed
 *
 * @param job - The BullMQ job
 * @param pool - PostgreSQL connection pool
 * @param itemProcessor - Function to process each individual item
 * @returns Promise resolving to array of results
 */
export async function processBatchJob<TInput extends BatchJobInput, TResult extends BatchJobResult>(
  job: Job<TInput & { project_id: string }>,
  pool: Pool,
  redis: Redis | undefined,
  itemProcessor: (item: any, project_id: string, pool: Pool, redis?: Redis) => Promise<any>
): Promise<TResult[]> {
  const { data, project_id } = job.data;
  const results: TResult[] = [];

  // Update job status to processing
  await pool.query(
    'UPDATE jobs SET status = $1, total_items = $2 WHERE id = $3',
    ['processing', data.length, job.id]
  );

  try {
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await itemProcessor(item, project_id, pool, redis);
        results.push({
          index: i,
          input: item,
          ...result
        } as TResult);
      } catch (error) {
        console.error(`Error processing item ${i}:`, error);
        results.push({
          index: i,
          input: item,
          result: null,
          error: error instanceof Error ? error.message : 'Unknown error'
        } as TResult);
      }

      // Update progress
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        'UPDATE jobs SET processed_items = $1 WHERE id = $2',
        [i + 1, job.id]
      );

      // Update job progress for BullMQ
      void job.updateProgress(Math.round(((i + 1) / data.length) * 100));
    }

    // Store results and mark as completed
    await pool.query(
      'UPDATE jobs SET status = $1, result_data = $2, completed_at = now() WHERE id = $3',
      ['completed', JSON.stringify(results), job.id]
    );

    return results;
  } catch (error) {
    console.error('Batch job failed:', error);
    await pool.query(
      'UPDATE jobs SET status = $1, error_message = $2 WHERE id = $3',
      ['failed', error instanceof Error ? error.message : 'Unknown error', job.id]
    );
    throw error;
  }
}