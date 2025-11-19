import type { Redis } from "ioredis";
import crypto from "node:crypto";
import type { Pool } from "pg";

// Adjust these import paths to match your project structure
import { environment } from "../environment.js";
import { ADDRESS_VALIDATION_TTL_DAYS, REASON_CODES } from "../validation.js";

// --- Configuration ---
const CACHE_TTL_SECONDS = ADDRESS_VALIDATION_TTL_DAYS * 24 * 3600;

// --- Interfaces ---

interface NormalizedAddress {
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
    source: "locationiq" | "nominatim" | "google";
}

interface ValidationResult {
    valid: boolean;
    normalized: NormalizedAddress;
    po_box: boolean;
    postal_city_match: boolean;
    in_bounds: boolean;
    geo: GeoLocation | null;
    reason_codes: string[];
    request_id: string;
    ttl_seconds: number;
    deliverable: boolean;
}

// Geocoding API Response Interfaces
interface NominatimResponse {
    lat: string;
    lon: string;
    importance?: number;
}

interface GoogleGeocodeResponse {
    status: string;
    results: Array<{
        geometry: {
            location: { lat: number; lng: number };
        };
        types: string[];
    }>;
}

// --- Helper Functions ---

/**
 * Detects if an address line contains a P.O. Box.
 */
export function detectPoBox(line: string | null | undefined): boolean {
    const s = (line || "").toLowerCase();
    return /\b(?:p\.?o\.?\s*box|apartado(?:\s+postal)?|caixa\s+postal|casilla|cas\.\s*b|box)\b/i.test(s);
}

/**
 * Normalizes an address using native libpostal bindings.
 */
export async function normalizeAddress(addr: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postal_code: string;
    country: string;
}): Promise<NormalizedAddress> {
    // 1. Don't normalize PO Boxes to prevent data loss
    if (detectPoBox(addr.line1) || detectPoBox(addr.line2)) {
        return {
            line1: (addr.line1 || "").trim(),
            line2: (addr.line2 || "").trim(),
            city: (addr.city || "").trim(),
            state: (addr.state || "").trim(),
            postal_code: (addr.postal_code || "").trim(),
            country: (addr.country || "").toUpperCase().trim(),
        };
    }

    // 2. Construct the full string for the parser
    const inputString = [
        addr.line1,
        addr.line2,
        addr.city,
        addr.state,
        addr.postal_code,
        addr.country
    ].filter(Boolean).join(", ");

    try {
        const response = await fetch(`${environment.ADDRESS_SERVICE_URL}/parse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: inputString })
        });

        if (!response.ok) throw new Error("Parser service failed");

        const parts = await response.json();



        // Reconstruct
        // Note: libpostal returns lowercase. We capitalize only Country usually.
        const house = parts.house_number ? `${parts.house_number} ` : "";
        const road = parts.road || "";
        const newLine1 = (house + road).trim() || addr.line1; // Fallback to original if parser completely failed

        return {
            line1: newLine1,
            line2: (parts.unit || addr.line2 || "").trim(),
            city: (parts.city || parts.suburb || addr.city || "").trim(),
            state: (parts.state || addr.state || "").trim(),
            postal_code: (parts.postcode || addr.postal_code || "").trim(),
            country: (parts.country || addr.country || "").toUpperCase().trim(),
        };
    } catch (e) {
        // Fallback if native binding fails (rare)
        console.error("Libpostal parse error:", e);
        return {
            line1: (addr.line1 || "").trim(),
            line2: (addr.line2 || "").trim(),
            city: (addr.city || "").trim(),
            state: (addr.state || "").trim(),
            postal_code: (addr.postal_code || "").trim(),
            country: (addr.country || "").toUpperCase().trim(),
        };
    }
}

// --- Main Validator ---

export async function validateAddress(
    addr: { line1: string; line2?: string; city: string; state?: string; postal_code: string; country: string },
    pool: Pool,
    redis?: Redis
): Promise<ValidationResult> {
    // 1. Input Sanitization & Hashing
    const input = JSON.stringify(addr);
    const hash = crypto.createHash("sha1").update(input).digest("hex");
    const cacheKey = `validator:address:${hash}`;

    // 2. Check Cache
    if (redis) {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
    }

    // 3. Fail Fast on Missing Data
    if (!addr.line1?.trim() || !addr.city?.trim() || !addr.postal_code?.trim() || !addr.country?.trim()) {
        const norm = await normalizeAddress(addr);
        return formatAndCacheResult(
            {
                valid: false,
                normalized: norm,
                po_box: false,
                postal_city_match: false,
                in_bounds: true,
                geo: null,
                reason_codes: [REASON_CODES.ADDRESS_POSTAL_CITY_MISMATCH], // Generic error for missing data
                deliverable: false
            },
            cacheKey,
            redis
        );
    }

    const reason_codes: string[] = [];

    // 4. Normalize
    const norm = await normalizeAddress(addr);

    // 5. Check PO Box
    const po_box = detectPoBox(norm.line1) || detectPoBox(norm.line2);
    if (po_box) reason_codes.push(REASON_CODES.ADDRESS_PO_BOX);

    // 6. Database Check (GeoNames)
    // We check city, admin1 (state), and admin2 (county/district) for the postal code
    const { rows } = await pool.query(
        `SELECT 1 FROM geonames_postal 
         WHERE country_code = $1 
         AND postal_code = $2 
         AND (
             lower(place_name) = lower($3) 
             OR lower(admin_name1) = lower($3) 
             OR lower(admin_name2) = lower($3)
         ) LIMIT 1`,
        [norm.country, norm.postal_code, norm.city]
    );

    const postal_city_match = rows.length > 0;
    if (!postal_city_match) {
        reason_codes.push(REASON_CODES.ADDRESS_POSTAL_CITY_MISMATCH);
    }

    // 7. Geocoding
    let geo: GeoLocation | null = null;
    let in_bounds = true;

    try {
        const queryParts = [norm.line1, norm.city, norm.state, norm.postal_code, norm.country].filter(Boolean);
        const q = encodeURIComponent(queryParts.join(" "));
        const headers = { "User-Agent": "Orbitcheck/1.0 (Foundry)" };

        let primarySuccess = false;

        // A) LocationIQ
        if (environment.LOCATIONIQ_KEY) {
            const r = await fetch(
                `https://us1.locationiq.com/search.php?key=${environment.LOCATIONIQ_KEY}&q=${q}&format=json&addressdetails=1`,
                { headers }
            );
            if (r.ok) {
                const data = await r.json() as NominatimResponse[];
                if (data[0]) {
                    geo = {
                        lat: Number(data[0].lat),
                        lng: Number(data[0].lon),
                        confidence: 0.9,
                        source: "locationiq",
                    };
                    primarySuccess = true;
                }
            }
        }
        // B) Nominatim (Fallback 1)
        else {
            const r = await fetch(`${environment.NOMINATIM_URL}/search?format=json&limit=1&q=${q}`, { headers });
            if (r.ok) {
                const data = await r.json() as NominatimResponse[];
                if (data[0]) {
                    geo = {
                        lat: Number(data[0].lat),
                        lng: Number(data[0].lon),
                        confidence: 0.7, // Nominatim is usually less precise than paid APIs
                        source: "nominatim",
                    };
                    primarySuccess = true;
                }
            }
        }

        // C) Google (Fallback 2)
        if (!primarySuccess && environment.USE_GOOGLE_FALLBACK && environment.GOOGLE_GEOCODING_KEY) {
            const gr = await fetch(
                `https://maps.googleapis.com/maps/api/geocode/json?address=${q}&key=${environment.GOOGLE_GEOCODING_KEY}`,
                { headers }
            );
            if (gr.ok) {
                const gj = await gr.json() as GoogleGeocodeResponse;
                if (gj.status === "OK" && gj.results?.[0]) {
                    const loc = gj.results[0].geometry.location;
                    const type = gj.results[0].types[0];
                    // "rooftop" or "street_address" implies high confidence
                    const isHighPrecision = type === "rooftop" || type === "street_address" || type === "premise";

                    geo = {
                        lat: loc.lat,
                        lng: loc.lng,
                        confidence: isHighPrecision ? 0.95 : 0.8,
                        source: "google",
                    };
                }
            }
        }
    } catch (err) {
        console.error("Geocoding failed:", err);
        reason_codes.push(REASON_CODES.ADDRESS_GEOCODE_FAILED);
    }

    // 8. Bounds Checking
    if (geo) {
        const inBoundsSql = `
            SELECT 1 FROM countries_bounding_boxes
            WHERE country_code = $1
            AND $2 BETWEEN min_lat AND max_lat
            AND (
                (wraps_dateline = false AND $3 BETWEEN min_lng AND max_lng)
                OR 
                (wraps_dateline = true  AND ($3 >= min_lng OR $3 <= max_lng))
            ) LIMIT 1;`;

        const { rows: bboxRows } = await pool.query(inBoundsSql, [norm.country, geo.lat, geo.lng]);
        in_bounds = bboxRows.length > 0;

        if (!in_bounds) {
            reason_codes.push(REASON_CODES.ADDRESS_GEO_OUT_OF_BOUNDS);
        }
    } else {
        // If no geocode result found at all, we flag it but don't necessarily invalidate if the DB check passed
        reason_codes.push(REASON_CODES.ADDRESS_GEOCODE_FAILED);
    }

    // 9. Decision Matrix

    // If we have a high confidence Geocode (e.g. found the roof), we accept the address 
    // even if the City/Zip combo isn't in our local GeoNames SQL (which is often outdated).
    const isHighConfidenceGeo = geo !== null && geo.confidence >= 0.85;

    // Valid = (Database Says Yes OR Geocoder Says "Definitely Here") AND (Inside Country)
    const valid = (postal_city_match || isHighConfidenceGeo) && in_bounds;

    // Deliverable = Valid AND Not a PO Box (assuming physical goods)
    const deliverable = valid && !po_box;

    return formatAndCacheResult(
        {
            valid,
            normalized: norm,
            po_box,
            postal_city_match,
            in_bounds,
            geo,
            reason_codes,
            deliverable
        },
        cacheKey,
        redis
    );
}

/**
 * Helper to format response, generate IDs, and save to Redis
 */
async function formatAndCacheResult(
    partial: Omit<ValidationResult, "request_id" | "ttl_seconds">,
    key: string,
    redis?: Redis
): Promise<ValidationResult> {
    const result: ValidationResult = {
        ...partial,
        request_id: crypto.randomUUID(),
        ttl_seconds: CACHE_TTL_SECONDS,
    };

    if (redis) {
        // Fire and forget the cache set
        redis.set(key, JSON.stringify(result), "EX", CACHE_TTL_SECONDS).catch(err =>
            console.warn("Redis cache set failed", err)
        );
    }
    return result;
}