import type { Job } from "bullmq";
import type { Pool } from "pg";

import { DEDUPE_TYPES, MESSAGES } from "../constants.js";
import { dedupeAddress, dedupeCustomer } from "../dedupe.js";
import { processBatchJob } from "./batchJobProcessor.js";

export interface BatchDedupeInput {
  type: typeof DEDUPE_TYPES.CUSTOMERS | typeof DEDUPE_TYPES.ADDRESSES;
  data: any[];
}

export interface DedupeResult {
  index: number;
  input: any;
  matches?: any[];
  suggested_action?: 'create_new' | 'merge_with' | 'review';
  canonical_id?: string | null;
  error?: string;
}

export const batchDedupeProcessor = async (job: Job<BatchDedupeInput & { project_id: string }>, pool: Pool): Promise<DedupeResult[]> => {
    const { type } = job.data;

    const itemProcessor = async (item: any, project_id: string, pool: Pool): Promise<any> => {
      let result;

      if (type === DEDUPE_TYPES.CUSTOMERS) {
        result = await dedupeCustomer(item, project_id, pool);
      } else if (type === DEDUPE_TYPES.ADDRESSES) {
        result = await dedupeAddress(item, project_id, pool);
      } else {
        throw new Error(MESSAGES.UNSUPPORTED_DEDUPE_TYPE(type));
      }

      return { ...result, error: undefined };
    };

    return await processBatchJob(job, pool, undefined, itemProcessor) as DedupeResult[];
};
