import crypto from "node:crypto";

import type { Redis } from "ioredis";

/**
 * Utility to extract only digits from a string, removing non-numeric characters.
 * Used for normalizing tax ID inputs before validation.
 *
 * @param s - Input string (e.g., "123.456.789-09").
 * @returns {string} String containing only digits.
 */
function onlyDigits(s: string): string { return (s || "").replaceAll(/\D/g, ""); }

/**
 * Computes mod 11 checksum for validation algorithms.
 * Sums weighted digits and returns modulus for check digit calculation.
 *
 * @param nums - Array of numeric digits.
 * @param weights - Array of weights corresponding to each digit position.
 * @returns {number} Modulus result for check digit computation.
 */

/**
 * Validates Brazilian CPF (Cadastro de Pessoas Físicas) using checksum algorithm.
 * Removes non-digits, checks length (11), rejects all-identical digits, computes check digits.
 *
 * @param value - The CPF value (e.g., "123.456.789-09").
 * @returns {Object} Validation result with valid flag and reason codes.
 */
/**
 * Validates Brazilian CPF (Cadastro de Pessoas Físicas) using the official checksum algorithm.
 * Removes non-digits, verifies 11-digit length, rejects sequences of identical digits,
 * computes first and second check digits using decreasing weights (10 to 2, then 11 to 2).
 *
 * @param value - The CPF string (e.g., "123.456.789-09" or "12345678909").
 * @returns {Object} Validation result with valid flag and reason codes (format or checksum errors).
 */
export function validateCPF(value: string): { valid: boolean; reason_codes: string[] } {
    const v = onlyDigits(value);
    if (v.length !== 11) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    if (/^(\d)\1+$/.test(v)) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    const n = [...v].map(Number);
    const d1 = (n.slice(0, 9).reduce((accumulator, current, index) => accumulator + current * (10 - index), 0) * 10) % 11 % 10;
    const d2 = (n.slice(0, 10).reduce((accumulator, current, index) => accumulator + current * (11 - index), 0) * 10) % 11 % 10;
    const ok = d1 === n[9] && d2 === n[10];
    return { valid: ok, reason_codes: ok ? [] : ["taxid.invalid_checksum"] };
}

// BR CNPJ: 14 digits, 2 check digits
/**
 * Validates Brazilian CNPJ (Cadastro Nacional da Pessoa Jurídica) using checksum.
 * Removes non-digits, checks length (14), rejects all-identical, computes check digits with weights.
 *
 * @param value - The CNPJ value (e.g., "12.345.678/0001-99").
 * @returns {Object} Validation result with valid flag and reason codes.
 */
/**
 * Validates Brazilian CNPJ (Cadastro Nacional da Pessoa Jurídica) using checksum with specific weights.
 * Removes non-digits, verifies 14-digit length, rejects identical digits, uses weights [5-2,9-2] for first check,
 * [6,5-2,9-2] for second, with 0 substitution for 10/11.
 *
 * @param value - The CNPJ string (e.g., "12.345.678/0001-99" or "12345678000199").
 * @returns {Object} Validation result with valid flag and reason codes (format or checksum errors).
 */
export function validateCNPJ(value: string): { valid: boolean; reason_codes: string[] } {
    const v = onlyDigits(value);
    if (v.length !== 14) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    if (/^(\d)\1+$/.test(v)) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    const n = [...v].map(Number);
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const w2 = [6, ...w1];
    const d1 = 11 - (n.slice(0, 12).reduce((accumulator, current, index) => accumulator + current * w1[index], 0) % 11); const cd1 = d1 > 9 ? 0 : d1;
    const d2 = 11 - (n.slice(0, 13).reduce((accumulator, current, index) => accumulator + current * w2[index], 0) % 11); const cd2 = d2 > 9 ? 0 : d2;
    const ok = cd1 === n[12] && cd2 === n[13];
    return { valid: ok, reason_codes: ok ? [] : ["taxid.invalid_checksum"] };
}

// MX RFC: 12 or 13 chars, mod 11 check digit with charset
/**
 * Validates Mexican RFC (Registro Federal de Contribuyentes) using mod 11 checksum with custom charset.
 * Supports 12/13 char formats, maps letters to numbers, computes check digit.
 *
 * @param value - The RFC value (e.g., "ABCD123456EFG").
 * @returns {Object} Validation result with valid flag and reason codes.
 */
/**
 * Validates Mexican RFC (Registro Federal de Contribuyentes) using mod 11 checksum with alphanumeric mapping.
 * Supports 12/13 character formats (personas morales/físicas), maps letters/symbols to numbers via charset,
 * pads shorter body, applies weights [13-2], computes check digit (0-9,A for 10, space for 11 but simplified).
 *
 * @param value - The RFC string (e.g., "ABCD123456EFG" or "GABC123456789").
 * @returns {Object} Validation result with valid flag and reason codes (format or checksum errors).
 */
const RFC_CHARS = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ&Ñ";
const RFC_MAP: Record<string, number> = Object.fromEntries([...RFC_CHARS].map((c, index) => [c, index]));
export function validateRFC(value: string): { valid: boolean; reason_codes: string[] } {
    const v = value.trim().toUpperCase();
    if (!/^[&A-ZÑ]{3,4}\d{6}[\d&A-ZÑ]{3}$/.test(v)) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    if (v.length !== 12 && v.length !== 13) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    const body = v.length === 13 ? v.slice(0, 12) : v.slice(0, 11);
    const check = v.slice(-1);
    let sum = 0;
    const weights = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    const pad = 12 - body.length;
    const padded = " ".repeat(pad) + body;
    for (let index = 0; index < 12; index++) { sum += (RFC_MAP[padded[index]] || 0) * weights[index]; }
    const dg = 11 - (sum % 11);
    const cd = dg === 11 ? "0" : dg === 10 ? "A" : String(dg);
    const ok = cd === check;
    return { valid: ok, reason_codes: ok ? [] : ["taxid.invalid_checksum"] };
}

// AR CUIT: 11 digits
/**
 * Validates Argentine CUIT (Clave Única de Identificación Tributaria) using mod 11 checksum.
 * Removes non-digits, checks length (11), computes check digit with weights.
 *
 * @param value - The CUIT value (e.g., "20-12345678-9").
 * @returns {Object} Validation result with valid flag and reason codes.
 */
/**
 * Validates Argentine CUIT (Clave Única de Identificación Tributaria) using mod 11 checksum.
 * Removes non-digits, verifies 11-digit length, applies weights [5,4,3,2,7,6,5,4,3,2] to first 10 digits,
 * computes check digit (0 for 11, 9 for 10, else mod).
 *
 * @param value - The CUIT string (e.g., "20-12345678-9" or "20123456789").
 * @returns {Object} Validation result with valid flag and reason codes (format or checksum errors).
 */
export function validateCUIT(value: string): { valid: boolean; reason_codes: string[] } {
    const v = onlyDigits(value);
    if (v.length !== 11) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const nums = [...v].map(Number);
    const s = nums.slice(0, 10).reduce((accumulator, current, index) => accumulator + current * w[index], 0);
    const module_ = 11 - (s % 11);
    const cd = module_ === 11 ? 0 : module_ === 10 ? 9 : module_;
    const ok = cd === nums[10];
    return { valid: ok, reason_codes: ok ? [] : ["taxid.invalid_checksum"] };
}

// CL RUT: digits + K check
/**
 * Validates Chilean RUT (Rol Único Tributario) using mod 11 with verifier digit (0-9 or K).
 * Removes dots/dashes, checks body digits, computes verifier with incremental multiplier.
 *
 * @param value - The RUT value (e.g., "12345678-9" or "1234567-K").
 * @returns {Object} Validation result with valid flag and reason codes.
 */
/**
 * Validates Chilean RUT (Rol Único Tributario) using mod 11 with incremental multiplier and verifier 'K'.
 * Removes dots/dashes, extracts body digits and verifier (0-9 or K), multiplies from right with 2-7 cycle,
 * computes verifier (0 for 11, K for 10, else res).
 *
 * @param value - The RUT string (e.g., "12.345.678-9" or "12345678-K").
 * @returns {Object} Validation result with valid flag and reason codes (format or checksum errors).
 */
export function validateRUT(value: string): { valid: boolean; reason_codes: string[] } {
    const v = value.replaceAll('.', "").replaceAll('-', "").toUpperCase();
    const body = v.slice(0, -1); const dv = v.slice(-1);
    if (!/^\d+$/.test(body)) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    let sum = 0, mul = 2;
    for (let index = body.length - 1; index >= 0; index--) {
        sum += Number.parseInt(body[index], 10) * mul;
        mul = (mul === 7) ? 2 : (mul + 1);
    }
    const result = 11 - (sum % 11);
    const cd = result === 11 ? "0" : result === 10 ? "K" : String(result);
    const ok = cd === dv;
    return { valid: ok, reason_codes: ok ? [] : ["taxid.invalid_checksum"] };
}

// PE RUC: 11 digits with known prefixes, checksum
/**
 * Validates Peruvian RUC (Registro Único de Contribuyentes) using mod 11 checksum.
 * Removes non-digits, checks length (11), computes check digit with specific weights.
 *
 * @param value - The RUC value (e.g., "12345678901").
 * @returns {Object} Validation result with valid flag and reason codes.
 */
/**
 * Validates Peruvian RUC (Registro Único de Contribuyentes) using mod 11 checksum.
 * Removes non-digits, verifies 11-digit length, applies weights [5,4,3,2,7,6,5,4,3,2] to first 10 digits,
 * check digit 1 for mod 11, 2 for 10, else mod.
 *
 * @param value - The RUC string (e.g., "12345678901").
 * @returns {Object} Validation result with valid flag and reason codes (format or checksum errors).
 */
export function validateRUC(value: string): { valid: boolean; reason_codes: string[] } {
    const v = onlyDigits(value);
    if (v.length !== 11) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const nums = [...v].map(Number);
    const s = nums.slice(0, 10).reduce((accumulator, current, index) => accumulator + current * weights[index], 0);
    const module_ = 11 - (s % 11);
    const cd = (module_ === 11) ? 1 : (module_ === 10) ? 2 : module_;
    const ok = cd === nums[10];
    return { valid: ok, reason_codes: ok ? [] : ["taxid.invalid_checksum"] };
}

// CO NIT: mod 11
/**
 * Validates Colombian NIT (Número de Identificación Tributaria) using mod 11.
 * Removes non-digits, uses specific weights (repeating after 10), computes check digit.
 *
 * @param value - The NIT value (e.g., "1234567890").
 * @returns {Object} Validation result with valid flag and reason codes.
 */
/**
 * Validates Colombian NIT (Número de Identificación Tributaria) using mod 11 with repeating weights.
 * Removes non-digits, reverses first n-1 digits, applies weights [3,7,13,17,19,23,29,37,41,43] cycling from 3,
 * check digit 0 if mod <=1, else 11-mod.
 *
 * @param value - The NIT string (e.g., "890123456-7" or "8901234567").
 * @returns {Object} Validation result with valid flag and reason codes (format or checksum errors).
 */
export function validateNIT(value: string): { valid: boolean; reason_codes: string[] } {
    const v = onlyDigits(value);
    const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43];
    const nums = [...v.slice(0, -1)].reverse().map(Number);
    let sum = 0;
    for (const [index, number_] of nums.entries()) { sum += number_ * (weights[index] || 3); }
    const module_ = sum % 11;
    const cd = (module_ > 1) ? (11 - module_) : 0;
    const ok = cd === Number(v.slice(-1));
    return { valid: ok, reason_codes: ok ? [] : ["taxid.invalid_checksum"] };
}

// ES NIF/NIE/CIF (simplified formats, checksum)
/**
 * Validates Spanish NIF/NIE/CIF (Número de Identificación Fiscal) using letter-based checksum.
 * Handles NIE (X/Y/Z prefix), NIF (digits + letter), simplified CIF.
 *
 * @param value - The NIF/NIE/CIF value (e.g., "12345678Z" or "X1234567Z").
 * @returns {Object} Validation result with valid flag and reason codes.
 */
/**
 * Validates Spanish NIF/NIE/CIF (Número de Identificación Fiscal) using letter-based mod 23 checksum.
 * Handles NIE (X/Y/Z prefix + 7 digits + letter), NIF (8 digits + letter), simplified CIF (letter + 7 digits + control).
 * Maps NIE prefix to digits, computes position in TRWAGMYFPDXBNJZSQVHLCKE table.
 *
 * @param value - The NIF/NIE/CIF string (e.g., "12345678Z", "X1234567Z", or "A1234567X").
 * @returns {Object} Validation result with valid flag and reason codes (format or checksum errors).
 */
const NIF_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
export function validateES(value: string): { valid: boolean; reason_codes: string[] } {
    let v = value.trim().toUpperCase();
    v = v.replaceAll(/\s/g, "");

    // NIE: X/Y/Z + 7 digits + letter
    if (/^[X-Z]\d{7}[A-Z]$/.test(v)) {
        const map: Record<string, string> = { X: "0", Y: "1", Z: "2" };
        const number_ = map[v[0]] + v.slice(1, 8);
        const letter = NIF_LETTERS[Number.parseInt(number_, 10) % 23];
        return {
            valid: letter === v[8],
            reason_codes: letter === v[8] ? [] : ["taxid.invalid_checksum"],
        };
    }

    // NIF: 8 digits + letter
    if (/\d{8}[A-Z]/.test(v)) {
        const number_ = Number.parseInt(v.slice(0, 8), 10);
        const letter = NIF_LETTERS[number_ % 23];
        return {
            valid: letter === v[8],
            reason_codes: letter === v[8] ? [] : ["taxid.invalid_checksum"],
        };
    }

    // CIF simplified: letter + 7 digits + control
    if (/^[A-HJ-NP-SU-W]\d{7}[\dA-J]$/.test(v)) {
        // Simplified acceptance (full CIF rules are longer)
        return { valid: true, reason_codes: [] };
    }

    return { valid: false, reason_codes: ["taxid.invalid_format"] };
}

// US EIN: format only
/**
 * Validates US EIN (Employer Identification Number) by format (9 digits only).
 * No checksum; just length check after removing non-digits.
 *
 * @param value - The EIN value (e.g., "12-3456789").
 * @returns {Object} Validation result with valid flag and reason codes.
 */
/**
 * Validates US EIN (Employer Identification Number) by format only (9 digits).
 * Removes non-digits, checks exact length; no checksum validation as per IRS rules.
 *
 * @param value - The EIN string (e.g., "12-3456789" or "123456789").
 * @returns {Object} Validation result with valid flag and reason codes (format errors only).
 */
export function validateEIN(value: string): { valid: boolean; reason_codes: string[] } {
    const v = onlyDigits(value);
    return { valid: v.length === 9, reason_codes: v.length === 9 ? [] : ["taxid.invalid_format"] };
}

// VIES SOAP
/**
 * Validates EU VAT number via VIES SOAP service.
 * Simulates outages if VIES_DOWN env var is true; catches errors as unavailable.
 *
 * @param country - Two-letter country code (e.g., "DE").
 * @param vatNumber - The VAT number without country prefix.
 * @returns {Promise<Object>} Validation result with valid flag, reason codes, and source ('vies').
 */
/**
 * Validates EU VAT number via official VIES SOAP web service.
 * Simulates outages if VIES_DOWN env var is set; handles connection errors gracefully.
 * Extracts country code and number, calls checkVat service, returns validity and source.
 *
 * @param country - Two-letter ISO country code (e.g., "DE" for Germany).
 * @param vatNumber - VAT number without country prefix (e.g., "123456789").
 * @returns {Promise<Object>} Validation result with valid flag, reason codes, and source ('vies').
 */
import soap from "soap";
export async function validateVATViaVIES(country: string, vatNumber: string): Promise<{ valid: boolean; reason_codes: string[]; source: string }> {
    // VIES outage simulation for testing
    if (process.env.VIES_DOWN === "true") {
        return { valid: false, reason_codes: ["taxid.vies_unavailable"], source: "vies" };
    }

    try {
        const client = await soap.createClientAsync(process.env.VIES_WSDL_URL || "https://ec.europa.eu/taxation_customs/vies/checkVatService.wsdl");
        const [result] = await client.checkVatAsync({ countryCode: country, vatNumber }) as [{ valid: boolean }];
        if (result.valid) return { valid: true, reason_codes: [], source: "vies" };
        return { valid: false, reason_codes: ["taxid.vies_invalid"], source: "vies" };
    } catch {
        return { valid: false, reason_codes: ["taxid.vies_unavailable"], source: "vies" };
    }
}

/**
 * Main entry for tax ID validation: dispatches to type-specific validators (CPF, CNPJ, etc.) or VIES for VAT.
 * Normalizes input, caches in Redis (24h TTL) using SHA-1 hash.
 * Supports LATAM, ES, US EIN, EU VAT types.
 *
 * @param params - Object with type (e.g., 'cpf', 'vat'), value, country (optional), redis (optional).
 * @returns {Promise<Object>} Validation result with valid flag, normalized value, reason codes, source.
 */
/**
 * Main dispatcher for tax ID validation based on type (e.g., 'cpf', 'vat', 'ein').
 * Normalizes input by removing whitespace, dispatches to country-specific validators or VIES for EU VAT.
 * Caches results in Redis (24 hours TTL) using SHA-1 hash of normalized input for repeated queries.
 * Supports Brazilian CPF/CNPJ, Mexican RFC, Argentine CUIT, Chilean RUT, Peruvian RUC, Colombian NIT,
 * Spanish NIF/NIE/CIF, US EIN, and EU VAT via VIES.
 *
 * @param params - Validation parameters: type (e.g., 'cpf', 'vat'), value (tax ID string), country (ISO code), redis (optional client).
 * @returns {Promise<Object>} Comprehensive result with validity, normalized value, reason codes, source (format/vies), request ID, and TTL.
 */
async function getCachedResult(redis: Redis | undefined, cacheKey: string): Promise<any> {
  if (!redis) return null;
  const cached = await redis.get(cacheKey);
  return cached ? JSON.parse(cached) : null;
}

async function setCachedResult(redis: Redis | undefined, cacheKey: string, result: { valid: boolean; normalized: string; reason_codes: string[]; source: string; request_id: string; ttl?: number }) : Promise<void> {
  if (!redis) return;
  await redis.set(cacheKey, JSON.stringify(result), 'EX', 24 * 3600);
}

function createBaseResult(normalizedValue: string): { valid: boolean; reason_codes: string[]; request_id: string; source: string; normalized: string } {
  return {
    valid: false,
    reason_codes: [] as string[],
    request_id: crypto.randomUUID(),
    source: "format",
    normalized: normalizedValue
  };
}

async function dispatchValidation(
  t: string,
  value: string,
  country: string
): Promise<{ valid: boolean; reason_codes: string[]; source?: string }> {
  switch (t) {
  case "CPF": {
    const result = validateCPF(value);
    return { valid: result.valid, reason_codes: result.reason_codes };
  }
  case "CNPJ": {
    const result = validateCNPJ(value);
    return { valid: result.valid, reason_codes: result.reason_codes };
  }
  case "RFC": {
    const result = validateRFC(value);
    return { valid: result.valid, reason_codes: result.reason_codes };
  }
  case "CUIT": {
    const result = validateCUIT(value);
    return { valid: result.valid, reason_codes: result.reason_codes };
  }
  case "RUT": {
    const result = validateRUT(value);
    return { valid: result.valid, reason_codes: result.reason_codes };
  }
  case "RUC": {
    const result = validateRUC(value);
    return { valid: result.valid, reason_codes: result.reason_codes };
  }
  case "NIT": {
    const result = validateNIT(value);
    return { valid: result.valid, reason_codes: result.reason_codes };
  }
  case "NIF": 
  case "NIE": 
  case "CIF": {
    const result = validateES(value);
    return { valid: result.valid, reason_codes: result.reason_codes };
  }
  case "EIN": {
    const result = validateEIN(value);
    return { valid: result.valid, reason_codes: result.reason_codes };
  }
  case "VAT": {
    const cc = country?.toUpperCase() || value.slice(0, 2);
    const vn = value.replace(/^[A-Z]{2}/, "");
    const result = await validateVATViaVIES(cc, vn);
    return { valid: result.valid, reason_codes: result.reason_codes, source: result.source };
  }
  default: {
    return { valid: false, reason_codes: ["taxid.invalid_format"] };
  }
  }
}

export async function validateTaxId({ type, value, country, redis }: { type: string, value: string, country: string, redis?: Redis }): Promise<{ valid: boolean; normalized: string; reason_codes: string[]; source: string; request_id: string; ttl?: number }> {
  const t = type.toUpperCase();
  const normalizedValue = value.replaceAll(/\s/g, "");
  const input = { type: t, value: normalizedValue, country: country || "" };
  const keyString = JSON.stringify(input);
  const hash = crypto.createHash('sha1').update(keyString).digest('hex');
  const cacheKey = `validator:taxid:${hash}`;

  const cached = await getCachedResult(redis, cacheKey);
  if (cached) {
    return cached;
  }

  const base = createBaseResult(normalizedValue);
  const validationResult = await dispatchValidation(t, value, country);

  const result = {
    ...base,
    valid: validationResult.valid,
    reason_codes: validationResult.reason_codes,
    ...(validationResult.source && { source: validationResult.source })
  };

  await setCachedResult(redis, cacheKey, result);

  return result;
}