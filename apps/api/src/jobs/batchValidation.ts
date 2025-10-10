import type { Job } from "bullmq";
import { Redis } from 'ioredis';
import { Pool } from "pg";

import { validateAddress } from "../validators/address.js";
import { validateEmail } from "../validators/email.js";
import { validatePhone } from "../validators/phone.js";
import { validateTaxId } from "../validators/taxid.js";

export interface BatchValidationInput {
  type: 'email' | 'phone' | 'address' | 'tax-id';
  data: any[];
}

export interface ValidationResult {
  index: number;
  input: any;
  result: any;
  error?: string;
}

export const batchValidationProcessor = async (job: Job<BatchValidationInput & { project_id: string }>, pool: Pool, redis: Redis): Promise<ValidationResult[]> => {
   const { type, data, project_id } = job.data;
  const results: ValidationResult[] = [];

  // Update job status to processing
  await pool.query(
    'UPDATE jobs SET status = $1, total_items = $2 WHERE id = $3',
    ['processing', data.length, job.id]
  );

  try {
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      try {
        let result: any;

        switch (type) {
          case 'email':
            result = await validateEmail(item.email, redis);
            break;
          case 'phone':
            result = await validatePhone(item.phone, item.country, redis);
            break;
          case 'address':
            result = await validateAddress(item, pool, redis);
            break;
          case 'tax-id':
            result = await validateTaxId({ type: item.type, value: item.value, country: item.country || '', redis });
            break;
          default:
            throw new Error(`Unsupported validation type: ${type}`);
        }

        results.push({
          index: i,
          input: item,
          result
        });
      } catch (error) {
        console.error(`Error validating item ${i}:`, error);
        results.push({
          index: i,
          input: item,
          result: null,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // Update progress
      await pool.query(
        'UPDATE jobs SET processed_items = $1 WHERE id = $2',
        [i + 1, job.id]
      );

      // Update job progress for BullMQ
      job.updateProgress(Math.round(((i + 1) / data.length) * 100));
    }

    // Store results and mark as completed
    await pool.query(
      'UPDATE jobs SET status = $1, result_data = $2, completed_at = now() WHERE id = $3',
      ['completed', JSON.stringify(results), job.id]
    );

    return results;
  } catch (error) {
    console.error('Batch validation job failed:', error);
    await pool.query(
      'UPDATE jobs SET status = $1, error_message = $2 WHERE id = $3',
      ['failed', error instanceof Error ? error.message : 'Unknown error', job.id]
    );
    throw error;
  }
};