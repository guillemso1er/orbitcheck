import crypto from "node:crypto";

import type { Pool } from "pg";

import { buildFullName, normalizeEmail, normalizePhone } from "../../utils.js";
import {
  DEDUPE_ACTIONS,
  DEDUPE_FUZZY_LIMIT,
  MATCH_TYPES,
  SIMILARITY_EXACT,
  SIMILARITY_FUZZY_THRESHOLD
} from "../../validation.js";
import { validateAddress } from "../../validators/address.js";

export interface DedupeMatch {
  id: string;
  similarity_score: number;
  match_type: string;
  data: any;
}

export interface DedupeResult {
  matches: DedupeMatch[];
  suggested_action: 'create_new' | 'merge_with' | 'review';
  canonical_id: string | null;
}

export async function dedupeCustomer(
  customerData: { email?: string; phone?: string; first_name?: string; last_name?: string },
  project_id: string,
  pool: Pool
): Promise<DedupeResult> {
  const { email, phone, first_name, last_name } = customerData;
  const matches: DedupeMatch[] = [];

  // Deterministic matches using normalized fields
  const normEmail = normalizeEmail(email || null);
  const normPhone = normalizePhone(phone || null);

  if (normEmail) {
    const { rows: emailMatches } = await pool.query(
      'SELECT id, email, phone, first_name, last_name FROM customers WHERE project_id = $2 AND normalized_email = $1',
      [normEmail, project_id]
    );
    for (const row of emailMatches) {
      if (row.id) {
        matches.push({
          id: row.id,
          similarity_score: SIMILARITY_EXACT,
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
          similarity_score: SIMILARITY_EXACT,
          match_type: MATCH_TYPES.EXACT_PHONE,
          data: row
        });
      }
    }
  }

  // Fuzzy matches with threshold on name
  const full_name = buildFullName(first_name || null, last_name || null);
  if (full_name) {
    const { rows: nameMatches } = await pool.query(
      `SELECT id, email, phone, first_name, last_name,
        similarity((COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), $1) as name_score
        FROM customers
        WHERE project_id = $2
        AND similarity((COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), $1) > $3
        ORDER BY name_score DESC LIMIT $4`,
      [full_name, project_id, SIMILARITY_FUZZY_THRESHOLD, DEDUPE_FUZZY_LIMIT]
    );
    for (const row of nameMatches) {
      const score = row.name_score;
      if (score > SIMILARITY_FUZZY_THRESHOLD) {
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

  return calculateSuggestedAction(matches);
}

export async function dedupeAddress(
  addressData: { line1: string; line2?: string; city: string; state?: string; postal_code: string; country: string },
  project_id: string,
  pool: Pool
): Promise<DedupeResult> {
  const { line1, line2, city, state, postal_code, country } = addressData;
  const matches: DedupeMatch[] = [];

  // Normalize the input address
  const normAddr = await validateAddress({ line1, line2: line2 || '', city, state: state || '', postal_code, country }, pool);
  const addrHash = crypto.createHash('sha256').update(JSON.stringify(normAddr.normalized)).digest('hex');

  // Deterministic match: exact address_hash
  const { rows: hashMatches } = await pool.query(
    'SELECT id, line1, line2, city, state, postal_code, country, lat, lng FROM addresses WHERE project_id = $1 AND address_hash = $2',
    [project_id, addrHash]
  );
  for (const row of hashMatches) {
    if (row.id) {
      matches.push({
        id: row.id,
        similarity_score: SIMILARITY_EXACT,
        match_type: MATCH_TYPES.EXACT_ADDRESS,
        data: row
      });
    }
  }

  // Fallback deterministic: exact postal_code + city + country
  if (matches.length === 0) {
    const { rows: exactMatches } = await pool.query(
      'SELECT id, line1, line2, city, state, postal_code, country, lat, lng FROM addresses WHERE project_id = $1 AND postal_code = $2 AND lower(city) = lower($3) AND country = $4',
      [project_id, normAddr.normalized.postal_code, normAddr.normalized.city, normAddr.normalized.country]
    );
    for (const row of exactMatches) {
      if (row.id && !matches.some(m => m.id === row.id)) {
        matches.push({
          id: row.id,
          similarity_score: SIMILARITY_EXACT,
          match_type: MATCH_TYPES.EXACT_POSTAL,
          data: row
        });
      }
    }
  }

  // Fuzzy matches with threshold on line1, city
  const { rows: fuzzyMatches } = await pool.query(
    `SELECT id, line1, line2, city, state, postal_code, country, lat, lng,
      greatest(similarity(line1, $2), similarity(city, $3)) as score
      FROM addresses
      WHERE project_id = $1
      AND (similarity(line1, $2) > $4 OR similarity(city, $3) > $4)
      ORDER BY score DESC LIMIT $5`,
    [project_id, normAddr.normalized.line1, normAddr.normalized.city, SIMILARITY_FUZZY_THRESHOLD, DEDUPE_FUZZY_LIMIT]
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

  return calculateSuggestedAction(matches);
}

function calculateSuggestedAction(matches: DedupeMatch[]): DedupeResult {
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

  return { matches, suggested_action, canonical_id };
}