import crypto from "node:crypto";

import type { Job } from "bullmq";
import type { Pool } from "pg";

import { DEDUPE_ACTIONS, MATCH_TYPES, MESSAGES,SIMILARITY_EXACT, SIMILARITY_FUZZY_THRESHOLD } from "../constants.js";
import { normalizeAddress } from "../validators/address.js";
import { processBatchJob } from "./batchJobProcessor.js";

export interface BatchDedupeInput {
  type: 'customers' | 'addresses';
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

   const itemProcessor = async (item: any, project_id: string, pool: Pool): Promise<DedupeResult> => {
     let matches: any[] = [];

     if (type === 'customers') {
       matches = await dedupeCustomer(item, project_id, pool);
     } else if (type === 'addresses') {
       matches = await dedupeAddress(item, project_id, pool);
     } else {
       throw new Error(MESSAGES.UNSUPPORTED_DEDUPE_TYPE(type));
     }

     // Determine suggested action
     let suggested_action: 'create_new' | 'merge_with' | 'review' = DEDUPE_ACTIONS.CREATE_NEW;
     let canonical_id: string | null = null;

     if (matches.length > 0) {
       const bestMatch = matches[0];
       if (bestMatch.similarity_score === SIMILARITY_EXACT) {
         suggested_action = DEDUPE_ACTIONS.MERGE_WITH;
         canonical_id = bestMatch.id;
       } else if (bestMatch.similarity_score > SIMILARITY_FUZZY_THRESHOLD) {
         suggested_action = DEDUPE_ACTIONS.REVIEW;
         canonical_id = bestMatch.id;
       }
     }

     return {
       matches,
       suggested_action,
       canonical_id
     };
   };

   return processBatchJob(job, pool, undefined, itemProcessor) as DedupeResult[];
};

async function dedupeCustomer(customerData: any, project_id: string, pool: Pool): Promise<any[]> {
  const { email, phone, first_name, last_name } = customerData;
  const matches: any[] = [];

  // Deterministic matches using normalized fields
  const normEmail = email ? email.trim().toLowerCase() : null;
  const normPhone = phone ? phone.replaceAll(/[^\d+]/g, '') : null;

  if (normEmail) {
    const { rows: emailMatches } = await pool.query(
      'SELECT id, email, phone, first_name, last_name FROM customers WHERE project_id = $2 AND normalized_email = $1',
      [normEmail, project_id]
    );
    for (const row of emailMatches) {
      if (row.id) {
        matches.push({
          id: row.id,
          similarity_score: 1,
          match_type: MATCH_TYPES.EXACT_EMAIL,
          data: row
        });
      }
    }
  }

  if (normPhone) {
    const { rows: phoneMatches } = await pool.query(
      'SELECT id, email, phone, first_name, last_name FROM customers WHERE project_id = $2 AND normalized_phone = $1',
      [normPhone, project_id]
    );
    for (const row of phoneMatches) {
      if (row.id) {
        matches.push({
          id: row.id,
          similarity_score: 1,
          match_type: MATCH_TYPES.EXACT_PHONE,
          data: row
        });
      }
    }
  }

  // Fuzzy matches with 0.85 threshold on name
  const full_name = `${first_name || ''} ${last_name || ''}`.trim();
  if (full_name) {
    const { rows: nameMatches } = await pool.query(
      `SELECT id, email, phone, first_name, last_name,
       similarity((first_name || ' ' || last_name), $1) as name_score
       FROM customers
       WHERE project_id = $2
       AND similarity((first_name || ' ' || last_name), $1) > 0.85
       ORDER BY name_score DESC LIMIT 5`,
      [full_name, project_id]
    );
    for (const row of nameMatches) {
      const score = row.name_score;
      if (score > 0.85) {
        matches.push({
          id: row.id,
          similarity_score: score,
          match_type: MATCH_TYPES.FUZZY_NAME,
          data: row
        });
      }
    }
  }

  // Sort matches by score descending
  matches.sort((a, b) => b.similarity_score - a.similarity_score);

  return matches;
}

async function dedupeAddress(addressData: any, project_id: string, pool: Pool): Promise<any[]> {
  const { line1, line2, city, state, postal_code, country } = addressData;
  const matches: any[] = [];

  // Normalize the input address
  const normAddr = await normalizeAddress({ line1, line2: line2 || '', city, state: state || '', postal_code, country });
  const addrHash = crypto.createHash('sha256').update(JSON.stringify(normAddr)).digest('hex');

  // Deterministic match: exact address_hash
  const { rows: hashMatches } = await pool.query(
    'SELECT id, line1, line2, city, state, postal_code, country, lat, lng FROM addresses WHERE project_id = $1 AND address_hash = $2',
    [project_id, addrHash]
  );
  for (const row of hashMatches) {
    if (row.id) {
      matches.push({
        id: row.id,
        similarity_score: 1,
        match_type: MATCH_TYPES.EXACT_ADDRESS,
        data: row
      });
    }
  }

  // Fallback deterministic: exact postal_code + city + country
  if (matches.length === 0) {
    const { rows: exactMatches } = await pool.query(
      'SELECT id, line1, line2, city, state, postal_code, country, lat, lng FROM addresses WHERE project_id = $1 AND postal_code = $2 AND lower(city) = lower($3) AND country = $4',
      [project_id, normAddr.postal_code, normAddr.city, normAddr.country]
    );
    for (const row of exactMatches) {
      if (row.id && !matches.some(m => m.id === row.id)) {
        matches.push({
          id: row.id,
          similarity_score: 1,
          match_type: MATCH_TYPES.EXACT_POSTAL,
          data: row
        });
      }
    }
  }

  // Fuzzy matches with 0.85 threshold on line1, city
  const { rows: fuzzyMatches } = await pool.query(
    `SELECT id, line1, line2, city, state, postal_code, country, lat, lng,
     greatest(similarity(line1, $2), similarity(city, $3)) as score
     FROM addresses
     WHERE project_id = $1
     AND (similarity(line1, $2) > 0.85 OR similarity(city, $3) > 0.85)
     ORDER BY score DESC LIMIT 5`,
    [project_id, normAddr.line1, normAddr.city]
  );
  for (const row of fuzzyMatches) {
    if (row.id && !matches.some(m => m.id === row.id)) {
      matches.push({
        id: row.id,
        similarity_score: row.score,
        match_type: MATCH_TYPES.FUZZY_ADDRESS,
        data: row
      });
    }
  }

  // Sort matches by score descending
  matches.sort((a, b) => b.similarity_score - a.similarity_score);

  return matches;
}