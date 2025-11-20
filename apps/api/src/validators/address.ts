import console from "node:console";
import crypto from "node:crypto";

import type { Redis } from "ioredis";
import type { Pool } from "pg";

import { environment } from "../environment.js"; // Ensure RADAR_KEY and GEOAPIFY_KEY are here
import { ADDRESS_VALIDATION_TTL_DAYS, REASON_CODES } from "../validation.js";

// --- Configuration ---
const CACHE_TTL_SECONDS = ADDRESS_VALIDATION_TTL_DAYS * 24 * 3600;
const FUZZY_MATCH_THRESHOLD = 0.75; // 0.0 to 1.0 (75% similarity required)

// --- Interfaces ---
export interface NormalizedAddress {
    line1: string;
    line2: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
}

interface GeoLocation {
    lat: number;
    lng: number;
    confidence: number; // 0 to 1
    source: "radar" | "geoapify" | "nominatim" | "local_db";
}

interface ValidationResult {
    valid: boolean;
    score: number; // 0-100 Confidence Score
    normalized: NormalizedAddress;
    metadata: {
        is_residential: boolean | null;
        is_po_box: boolean;
        format_matched: boolean;
    };
    geo: GeoLocation | null;
    reason_codes: string[];
    request_id: string;
    source_used: string;
    po_box: boolean;
    postal_city_match: boolean;
    in_bounds: boolean;
    deliverable: boolean;
    debug_log: string[];
    ttl_seconds: number;
}

// --- Helper Functions ---

/**
 * Calculates string similarity (Levenshtein Distance).
 * Returns 0.0 (completely different) to 1.0 (exact match).
 */
function getSimilarity(s1: string, s2: string): number {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    if (longer.length === 0) return 1.0;

    const costs = new Array();
    for (let i = 0; i <= shorter.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= longer.length; j++) {
            if (i === 0) costs[j] = j;
            else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1))
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[longer.length] = lastValue;
    }
    return (longer.length - costs[longer.length]) / longer.length;
}

/**
 * Expands common abbreviations for better DB matching.
 * e.g. "St" -> "Street", "NY" -> "New York" (basic)
 */
function normalizeForSearch(text: string): string {
    if (!text) return "";
    const replacements: Record<string, string> = {
        "st": "street", "ave": "avenue", "rd": "road", "blvd": "boulevard",
        "ln": "lane", "dr": "drive", "ct": "court", "apt": "apartment",
        "n": "north", "s": "south", "e": "east", "w": "west"
    };
    return text.toLowerCase().replace(/[.,]/g, "").split(" ").map(w => replacements[w] || w).join(" ");
}

type RawAddressInput = {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postal_code: string;
    country: string;
};

export async function normalizeAddress(rawAddr: RawAddressInput): Promise<NormalizedAddress> {
    const cleaned: NormalizedAddress = {
        line1: (rawAddr.line1 || "").trim().replace(/\s+/g, " "),
        line2: (rawAddr.line2 || "").trim(),
        city: (rawAddr.city || "").trim(),
        state: (rawAddr.state || "").trim(),
        postal_code: (rawAddr.postal_code || "").trim(),
        country: (rawAddr.country || "").toUpperCase().trim(),
    };

    if (!cleaned.line1 || !cleaned.city || !cleaned.postal_code || !cleaned.country) {
        return cleaned;
    }

    const radarResult = await validateWithRadar(cleaned);
    if (radarResult?.normalized) {
        return {
            line1: radarResult.normalized.line1 || cleaned.line1,
            line2: radarResult.normalized.line2 ?? cleaned.line2,
            city: radarResult.normalized.city || cleaned.city,
            state: radarResult.normalized.state || cleaned.state,
            postal_code: radarResult.normalized.postal_code || cleaned.postal_code,
            country: radarResult.normalized.country || cleaned.country,
        };
    }

    return cleaned;
}

export function detectPoBox(line: string | null | undefined): boolean {
    const s = (line || "").toLowerCase().replace(/[.]/g, "");
    return /\b(?:po box|apartado|box|pob|post office box)\b/i.test(s);
}

// --- Validator Providers ---

/**
 * TIER 1: Radar (Best Free Commercial Grade)
 * Limit: 100,000 requests / month free.
 */
async function validateWithRadar(addr: NormalizedAddress): Promise<Partial<ValidationResult> | null> {
    if (!environment.RADAR_KEY) return null;

    try {
        const params = new URLSearchParams({
            country: addr.country,
            state: addr.state,
            city: addr.city,
            postalCode: addr.postal_code,
            number: addr.line1.split(' ')[0],
            street: addr.line1
        });

        const res = await fetch(`${environment.RADAR_API_URL}/addresses/validate?${params}`, {
            headers: { "Authorization": environment.RADAR_KEY }
        });

        if (!res.ok) return null;
        const data = await res.json() as any;

        if (data.meta.code === 200 && data.address) {
            const a = data.address;
            const status = data.result.verificationStatus; // verified, partially verified, ambiguous, unverified

            const isValid = status === "verified" || status === "partially verified";
            const confidenceMap: any = { exact: 1.0, high: 0.9, medium: 0.7, low: 0.5 };
            const conf = confidenceMap[a.confidence] || 0.5;

            return {
                valid: isValid,
                score: isValid ? conf * 100 : 20,
                normalized: {
                    line1: `${a.number || ''} ${a.street || ''}`.trim() || addr.line1,
                    line2: addr.line2, // Radar doesn't handle secondary units well in free tier
                    city: a.city || addr.city,
                    state: a.stateCode || a.state || addr.state,
                    postal_code: a.postalCode || addr.postal_code,
                    country: a.countryCode || addr.country
                },
                metadata: {
                    is_residential: null,
                    is_po_box: detectPoBox(addr.line1),
                    format_matched: true
                },
                geo: {
                    lat: a.latitude,
                    lng: a.longitude,
                    confidence: conf,
                    source: "radar"
                },
                source_used: "radar",
                reason_codes: isValid ? [] : [REASON_CODES.ADDRESS_GEOCODE_FAILED]
            };
        }
    } catch (e) {
        console.error("Radar validation error:", e);
    }
    return null;
}

/**
 * TIER 2: Geoapify (Excellent Backup)
 * Limit: 3,000 requests / day free.
 */
async function validateWithGeoapify(addr: NormalizedAddress): Promise<Partial<ValidationResult> | null> {
    if (!environment.GEOAPIFY_KEY) return null;

    try {
        const text = `${addr.line1}, ${addr.city}, ${addr.state} ${addr.postal_code}, ${addr.country}`;
        const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(text)}&apiKey=${environment.GEOAPIFY_KEY}&limit=1`;

        const res = await fetch(url);
        if (!res.ok) return null;

        const data = await res.json() as any;
        if (data.features && data.features.length > 0) {
            const f = data.features[0].properties;

            // Geoapify returns a "rank" confidence. We check if it matched the street.
            const matchType = f.rank.match_type; // full_match, match_by_street, match_by_city, etc.
            const isValid = ["full_match", "match_by_street"].includes(matchType);

            return {
                valid: isValid,
                score: f.rank.confidence * 100,
                normalized: {
                    line1: f.address_line1 || addr.line1,
                    line2: addr.line2,
                    city: f.city || addr.city,
                    state: f.state_code || f.state || addr.state,
                    postal_code: f.postcode || addr.postal_code,
                    country: f.country_code ? f.country_code.toUpperCase() : addr.country
                },
                metadata: {
                    is_residential: null,
                    is_po_box: false,
                    format_matched: true
                },
                geo: {
                    lat: data.features[0].geometry.coordinates[1],
                    lng: data.features[0].geometry.coordinates[0],
                    confidence: f.rank.confidence,
                    source: "geoapify"
                },
                source_used: "geoapify",
                reason_codes: isValid ? [] : ["ADDRESS_PARTIAL_MATCH"]
            };
        }
    } catch (e) {
        console.error("Geoapify validation error:", e);
    }
    return null;
}

/**
 * TIER 3: Nominatim (OpenStreetMap)
 * Limit: Rate limited (1 req/sec), but free.
 */
async function validateWithNominatim(addr: NormalizedAddress): Promise<Partial<ValidationResult> | null> {
    try {
        await new Promise(r => { setTimeout(r, 500); }); // Throttle slightly
        const q = encodeURIComponent(`${addr.line1}, ${addr.city}, ${addr.state}, ${addr.postal_code}, ${addr.country}`);

        const res = await fetch(`${environment.NOMINATIM_URL}/search?format=json&addressdetails=1&limit=1&q=${q}`, {
            headers: { "User-Agent": "OrbitCheck/2.0 (Internal Tool)" }
        });

        if (res.ok) {
            const data = await res.json() as any[];
            if (data[0]) {
                const d = data[0];
                // Check strictness: Did the postal code actually match?
                const returnedZip = d.address.postcode;
                const strictMatch = returnedZip && returnedZip.replace(/\s/g, '') === addr.postal_code.replace(/\s/g, '');

                return {
                    valid: true, // If OSM found it, it's usually physically there
                    score: strictMatch ? 80 : 50,
                    normalized: {
                        line1: addr.line1, // OSM formatting is often too verbose
                        line2: addr.line2,
                        city: d.address.city || d.address.town || d.address.village || addr.city,
                        state: d.address.state || addr.state,
                        postal_code: d.address.postcode || addr.postal_code,
                        country: (d.address.country_code || addr.country).toUpperCase()
                    },
                    metadata: { is_residential: null, is_po_box: false, format_matched: false },
                    geo: {
                        lat: parseFloat(d.lat),
                        lng: parseFloat(d.lon),
                        confidence: 0.6,
                        source: "nominatim"
                    },
                    source_used: "nominatim",
                    reason_codes: strictMatch ? [] : ["ADDRESS_ZIP_MISMATCH_BUT_GEO_FOUND"]
                };
            }
        }
    } catch (e) {
        console.error("Nominatim error:", e);
    }
    return null;
}

// --- Main Logic ---

export async function validateAddress(
    rawAddr: RawAddressInput,
    pool: Pool,
    redis?: Redis
): Promise<ValidationResult> {

    // 1. Clean Input
    const input: NormalizedAddress = {
        line1: (rawAddr.line1 || "").trim(),
        line2: (rawAddr.line2 || "").trim(),
        city: (rawAddr.city || "").trim(),
        state: (rawAddr.state || "").trim(),
        postal_code: (rawAddr.postal_code || "").trim(),
        country: (rawAddr.country || "").toUpperCase().trim(),
    };

    const hash = crypto.createHash("sha1").update(JSON.stringify(input)).digest("hex");
    const cacheKey = `val:addr:v3:${hash}`;

    // 2. Check Cache
    if (redis) {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
    }

    // 3. Fail Fast
    if (!input.line1 || !input.city || !input.country) {
        return formatResult({
            valid: false, score: 0, normalized: input,
            metadata: { is_residential: null, is_po_box: false, format_matched: false },
            geo: null, reason_codes: [REASON_CODES.MISSING_REQUIRED_FIELDS], source_used: "logic"
        }, cacheKey, input, redis);
    }

    let result: Partial<ValidationResult> | null = null;

    // --- PROVIDER CHAIN ---

    // Step A: Radar (High Quality, Free)
    result = await validateWithRadar(input);

    // Step B: Geoapify (If Radar failed or unverified)
    if (!result || !result.valid) {
        const geoRes = await validateWithGeoapify(input);
        // If Geoapify found a strong match, use it. 
        if (geoRes && geoRes.valid) {
            result = geoRes;
        }
    }

    // Step C: Nominatim (Last Resort for API)
    if (!result || (!result.valid && !result.geo)) {
        const nomRes = await validateWithNominatim(input);
        if (nomRes) result = nomRes;
    }

    // Step D: Local DB Fallback (The Failsafe)
    // If APIs failed, or we just want to cross-reference city/zip validity
    if (!result || !result.valid) {
        const { rows } = await pool.query(
            `SELECT place_name, admin_name1, postal_code, country_code 
             FROM geonames_postal 
             WHERE country_code = $1 AND postal_code = $2 
             LIMIT 10`,
            [input.country, input.postal_code]
        );

        if (rows.length > 0) {
            // Fuzzy match the City name
            const bestMatch = rows.find(r =>
                getSimilarity(normalizeForSearch(r.place_name), normalizeForSearch(input.city)) > FUZZY_MATCH_THRESHOLD
            );

            if (bestMatch) {
                result = {
                    valid: true, // "Valid" enough for the DB (Zip/City match)
                    score: 60,   // Lower score because we didn't verify the street
                    normalized: {
                        ...input,
                        city: bestMatch.place_name, // Auto-correct city spelling
                        state: bestMatch.admin_name1 || input.state
                    },
                    metadata: { is_residential: null, is_po_box: detectPoBox(input.line1), format_matched: true },
                    geo: { lat: 0, lng: 0, confidence: 0.5, source: "local_db" }, // No coords usually
                    source_used: "local_db_fuzzy",
                    reason_codes: ["STREET_NOT_VERIFIED"]
                };
            } else {
                // Zip exists, but city is wrong
                result = {
                    valid: false,
                    score: 30,
                    normalized: input,
                    metadata: { is_residential: null, is_po_box: false, format_matched: false },
                    geo: null,
                    source_used: "local_db_mismatch",
                    reason_codes: [REASON_CODES.ADDRESS_POSTAL_CITY_MISMATCH]
                };
            }
        }
    }

    // Default failure state
    if (!result) {
        result = {
            valid: false, score: 0, normalized: input,
            metadata: { is_residential: null, is_po_box: detectPoBox(input.line1), format_matched: false },
            geo: null, reason_codes: [REASON_CODES.ADDRESS_NOT_FOUND], source_used: "none"
        };
    }

    return formatResult(result!, cacheKey, input, redis);
}

async function formatResult(data: Partial<ValidationResult>, key: string, input: NormalizedAddress, redis?: Redis): Promise<ValidationResult> {
    const normalized = data.normalized ?? input;
    const metadata = data.metadata ?? {
        is_residential: null,
        is_po_box: detectPoBox(normalized.line1),
        format_matched: false
    };
    const reasonCodes = data.reason_codes ?? [];
    const poBox = data.po_box ?? metadata.is_po_box ?? detectPoBox(normalized.line1);
    const hasPostalMismatch = reasonCodes.includes(REASON_CODES.ADDRESS_POSTAL_CITY_MISMATCH);
    const postalCityMatch = data.postal_city_match ?? !hasPostalMismatch;
    const isOutOfBounds = reasonCodes.includes(REASON_CODES.ADDRESS_GEO_OUT_OF_BOUNDS);
    const inBounds = data.in_bounds ?? !isOutOfBounds;
    const finalReasonCodes = poBox && !reasonCodes.includes(REASON_CODES.ADDRESS_PO_BOX)
        ? [...reasonCodes, REASON_CODES.ADDRESS_PO_BOX]
        : reasonCodes;
    const deliverable = data.deliverable ?? (!!data.valid && !poBox && postalCityMatch);
    const ttlSeconds = data.ttl_seconds ?? CACHE_TTL_SECONDS;
    const debugLog = data.debug_log ?? [];

    const final: ValidationResult = {
        valid: data.valid ?? false,
        score: data.score ?? 0,
        normalized,
        metadata: { ...metadata, is_po_box: poBox },
        geo: data.geo ?? null,
        reason_codes: finalReasonCodes,
        request_id: crypto.randomUUID(),
        source_used: data.source_used ?? "logic",
        po_box: poBox,
        postal_city_match: postalCityMatch,
        in_bounds: inBounds,
        deliverable,
        debug_log: debugLog,
        ttl_seconds: ttlSeconds
    };

    if (redis) await redis.set(key, JSON.stringify(final), "EX", CACHE_TTL_SECONDS);
    return final;
}