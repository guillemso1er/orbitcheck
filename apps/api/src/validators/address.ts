import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

import crypto from "node:crypto";

import type { Redis } from "ioredis";
import type { Pool } from "pg";

import { environment } from "../environment.js";
import { ADDRESS_VALIDATION_TTL_DAYS, REASON_CODES } from "../validation.js";

// Cache TTL in seconds (7 days)
const CACHE_TTL_SECONDS = ADDRESS_VALIDATION_TTL_DAYS * 24 * 3600;

// Simple PO Box detector for multiple locales
/**
 * Detects if an address line contains a P.O. Box or equivalent in multiple languages/locales.
 * Uses regex to match common patterns like "PO Box", "Apartado Postal", etc.
 *
 * @param line - The address line to check (e.g., street address).
 * @returns {boolean} True if a P.O. Box is detected, false otherwise.
 */
export function detectPoBox(line: string): boolean {
    const s = (line || "").toLowerCase();
    return /\b(?:p\.?o\.?\s*box|apartado(?:\s+postal)?|caixa\s+postal|casilla|cas\.\s*b|box)\b/i.test(s);
}

// Use libpostal CLI (installed in image) to normalize; simple wrapper to avoid native bindings complexity
/**
 * Normalizes an address using libpostal CLI for parsing and standardization.
 * Joins address components and parses them into structured fields.
 * Falls back to input if parsing fails.
 *
 * @param addr - Input address object with line1, line2 (optional), city, state (optional), postal_code, country.
 * @returns {Promise<Object>} Normalized address object with structured fields.
 */
interface NormalizedAddress {
    line1: string;
    line2: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
}

export async function normalizeAddress(addr: { line1: string; line2?: string; city: string; state?: string; postal_code: string; country: string; }): Promise<NormalizedAddress> {
    // If it's a PO Box, don't normalize to avoid changing the line1
    if (detectPoBox(addr.line1) || detectPoBox(addr.line2 || "")) {
        return {
            line1: addr.line1,
            line2: addr.line2 || "",
            city: addr.city,
            state: addr.state || "",
            postal_code: addr.postal_code,
            country: addr.country.toUpperCase()
        } as NormalizedAddress;
    }

    // Build address string, filtering out empty components
    const components = [
        addr.line1,
        addr.line2,
        addr.city,
        addr.state,
        addr.postal_code,
        addr.country
    ].filter(Boolean);
    const joined = components.join(", ");

    try {
        const { stdout } = await exec("/usr/local/bin/parse-address", [joined]);
        const parts: Record<string, string> = {};
        for (const line of stdout.split("\n")) {
            const [k, v] = line.split(":").map(s => s?.trim());
            if (k && v) parts[k] = v;
        }
        return {
            line1: (parts.house_number && parts.road) ? `${parts.house_number} ${parts.road}` : addr.line1,
            line2: parts.unit || addr.line2 || "",
            city: parts.city || addr.city,
            state: parts.state || addr.state || "",
            postal_code: parts.postcode || addr.postal_code,
            country: (parts.country || addr.country).toUpperCase()
        } as NormalizedAddress;
    } catch {
        return {
            line1: addr.line1,
            line2: addr.line2 || "",
            city: addr.city,
            state: addr.state || "",
            postal_code: addr.postal_code,
            country: addr.country.toUpperCase()
        } as NormalizedAddress;
    }
}

/**
 * Validates an address comprehensively: normalizes, checks for P.O. Box, verifies postal-city match via GeoNames,
 * and attempts geocoding (LocationIQ/Nominatim primary, Google fallback).
 * Caches results in Redis (7 days TTL) using SHA-1 hash of input.
 *
 * @param addr - Input address object.
 * @param pool - PostgreSQL pool for GeoNames lookup.
 * @param redis - Optional Redis client for caching.
 * @returns {Promise<Object>} Validation result with normalized address, validity, geo coords, reason codes, etc.
 */
interface GeoLocation {
    lat: number;
    lng: number;
    confidence: number;
    source: string;
}

interface LocationResponse {
    lat: string;
    lon: string;
}

interface GoogleGeocodeResponse {
    status: string;
    results: Array<{
        geometry: {
            location: {
                lat: number;
                lng: number;
            };
        };
    }>;
}

export async function validateAddress(
    addr: { line1: string; line2?: string; city: string; state?: string; postal_code: string; country: string; },
    pool: Pool,
    redis?: Redis
): Promise<{
    valid: boolean;
    normalized: NormalizedAddress;
    po_box: boolean;
    postal_city_match: boolean;
    in_bounds: boolean;
    geo: GeoLocation | null;
    reason_codes: string[];
    request_id: string;
    ttl_seconds: number;
    deliverable: boolean; // New field to indicate if address is suitable for physical delivery
}> {
    const input = JSON.stringify(addr);
    const hash = crypto.createHash('sha1').update(input).digest('hex');
    const cacheKey = `validator:address:${hash}`;

    if (redis) {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
    }

    const reason_codes: string[] = [];
    const norm = await normalizeAddress(addr);
    const po_box = detectPoBox(norm.line1) || detectPoBox(norm.line2 || "");
    if (po_box) {
        reason_codes.push(REASON_CODES.ADDRESS_PO_BOX);
    }

    const { rows } = await pool.query(
        "select 1 from geonames_postal where country_code=$1 and postal_code=$2 and (lower(place_name)=lower($3) or lower(admin_name1)=lower($3)) limit 1",
        [norm.country.toUpperCase(), norm.postal_code, norm.city]
    );
    const postal_city_match = rows.length > 0;
    if (!postal_city_match) {
        reason_codes.push(REASON_CODES.ADDRESS_POSTAL_CITY_MISMATCH);
    }

    let geo: GeoLocation | null = null;
    let in_bounds = true;
    try {
        // Build query string, filtering empty components
        const queryComponents = [
            norm.line1,
            norm.city,
            norm.state,
            norm.postal_code,
            norm.country
        ].filter(Boolean);
        const q = encodeURIComponent(queryComponents.join(" "));

        let primarySuccess = false;

        if (environment.LOCATIONIQ_KEY) {
            const url = `https://us1.locationiq.com/search.php?key=${environment.LOCATIONIQ_KEY}&q=${q}&format=json&addressdetails=1`;
            const r = await fetch(url, { headers: { "User-Agent": "Orbitcheck/0.1" } });
            if (r.ok) {
                const data = await r.json();
                if (Array.isArray(data) && data[0]) {
                    const index = data as LocationResponse[];
                    geo = { lat: Number.parseFloat(index[0].lat), lng: Number.parseFloat(index[0].lon), confidence: 0.9, source: 'locationiq' as const };
                    primarySuccess = true;
                }
            }
        } else {
            const url = `${environment.NOMINATIM_URL}/search?format=json&limit=1&q=${q}`;
            const r = await fetch(url, { headers: { "User-Agent": "Orbitcheck/0.1" } });
            if (r.ok) {
                const data = await r.json();
                if (Array.isArray(data) && data[0]) {
                    const index = data as LocationResponse[];
                    geo = { lat: Number.parseFloat(index[0].lat), lng: Number.parseFloat(index[0].lon), confidence: 0.7, source: 'nominatim' as const };
                    primarySuccess = true;
                }
            }
        }

        // Google fallback if primary failed and enabled
        if (!primarySuccess && environment.USE_GOOGLE_FALLBACK && environment.GOOGLE_GEOCODING_KEY) {
            const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${q}&key=${environment.GOOGLE_GEOCODING_KEY}`;
            const gr = await fetch(googleUrl, { headers: { "User-Agent": "Orbitcheck/0.1" } });
            if (gr.ok) {
                const gj: GoogleGeocodeResponse = await gr.json();
                if (gj.status === 'OK' && gj.results && gj.results[0]) {
                    const loc = gj.results[0].geometry.location;
                    geo = { lat: loc.lat, lng: loc.lng, confidence: 0.8, source: 'google' as const };
                }
            }
        }

        // Geo-validation: check if lat/lng in country bounding box
        if (geo) {
            const { rows: bboxRows } = await pool.query(
                "SELECT 1 FROM countries_bounding_boxes WHERE country_code = $1 AND $2 >= min_lat AND $2 <= max_lat AND $3 >= min_lng AND $3 <= max_lng LIMIT 1",
                [norm.country.toUpperCase(), geo.lat, geo.lng]
            );
            in_bounds = bboxRows.length > 0;
            if (!in_bounds) {
                reason_codes.push(REASON_CODES.ADDRESS_GEO_OUT_OF_BOUNDS);
            }
        } else {
            reason_codes.push(REASON_CODES.ADDRESS_GEOCODE_FAILED);
        }
    } catch {
        // ignore geocoding errors but log them
        reason_codes.push(REASON_CODES.ADDRESS_GEOCODE_FAILED);
    }

    // An address is valid if postal code matches city
    // PO Boxes are valid addresses but not deliverable for physical goods
    const valid = postal_city_match;
    const deliverable = valid && !po_box && in_bounds;

    const result = {
        valid,
        normalized: norm,
        po_box,
        postal_city_match,
        in_bounds,
        geo,
        reason_codes,
        request_id: crypto.randomUUID(),
        ttl_seconds: CACHE_TTL_SECONDS,
        deliverable
    };

    if (redis) {
        await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
    }

    return result;
}