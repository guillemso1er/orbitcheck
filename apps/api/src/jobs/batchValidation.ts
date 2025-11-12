import type { Job } from "bullmq";
import type { Redis } from 'ioredis';
import type { Pool } from "pg";

import { MESSAGES } from "../config.js";
import { validateAddress } from "../validators/address.js";
import { validateEmail } from "../validators/email.js";
import { validatePhone } from "../validators/phone.js";
import { validateTaxId } from "../validators/taxid.js";
import { processBatchJob } from "./batchJobProcessor.js";

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
  const { type } = job.data;

  const itemProcessor = async (item: any, _project_id: string, pool: Pool, redis?: Redis): Promise<any> => {
    switch (type) {
      case 'email':
        // Extract email string from item object
        return await validateEmail(String(item.email || ''), redis!);
      case 'phone':
        return await validatePhone(item.phone, item.country, redis!);
      case 'address':
        return await validateAddress(item, pool, redis!);
      case 'tax-id':
        return await validateTaxId({ type: item.type, value: item.value, country: item.country || '', redis: redis! });
      default:
        throw new Error(MESSAGES.UNSUPPORTED_VALIDATION_TYPE(type));
    }
  };

  return processBatchJob(job, pool, redis, itemProcessor);
};