import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

import crypto from "crypto";
import type { Redis } from "ioredis";
import fetch from "node-fetch";
import type { Pool } from "pg";
import { env } from "../env";

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
    return /\b(?:po\s*box|p\.?o\.?\s*box|apartado(?:\s+postal)?|caixa\s+postal|casilla|cas\.\s*b|box)\b/i.test(s);
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
export async function normalizeAddress(addr: { line1: string; line2?: string; city: string; state?: string; postal_code: string; country: string; }): Promise<any> {
    const joined = `${addr.line1}, ${addr.line2 || ""}, ${addr.city}, ${addr.state || ""}, ${addr.postal_code}, ${addr.country}`;
    try {
        const { stdout } = await exec("/usr/local/bin/parse-address", [joined]);
        const parts: any = {};
        stdout.split("\n").forEach(line => {
            const [k, v] = line.split(":").map(s => s?.trim());
            if (k && v) parts[k] = v;
        });
        return {
            line1: (parts.house_number && parts.road) ? `${parts.house_number} ${parts.road}` : addr.line1,
            line2: parts.unit || addr.line2 || "",
            city: parts.city || addr.city,
            state: parts.state || addr.state || "",
            postal_code: parts.postcode || addr.postal_code,
            country: (parts.country || addr.country).toUpperCase()
        };
    } catch {
        return {
            line1: addr.line1,
            line2: addr.line2 || "",
            city: addr.city,
            state: addr.state || "",
            postal_code: addr.postal_code,
            country: addr.country.toUpperCase()
        };
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
export async function validateAddress(
    addr: { line1: string; line2?: string; city: string; state?: string; postal_code: string; country: string; },
    pool: Pool,
    redis?: Redis
): Promise<{
    valid: boolean;
    normalized: any;
    po_box: boolean;
    postal_city_match: boolean;
    geo: any;
    reason_codes: string[];
    request_id: string;
    ttl_seconds: number;
}> {
    const input = JSON.stringify(addr);
    const hash = crypto.createHash('sha1').update(input).digest('hex');
    const cacheKey = `validator:address:${hash}`;

    let result: any;

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
        reason_codes.push("address.po_box");
    }

    const { rows } = await pool.query(
        "select 1 from geonames_postal where country_code=$1 and postal_code=$2 and (lower(place_name)=lower($3) or lower(admin_name1)=lower($3)) limit 1",
        [norm.country.toUpperCase(), norm.postal_code, norm.city]
    );
    const postal_city_match = rows.length > 0;
    if (!postal_city_match) {
        reason_codes.push("address.postal_city_mismatch");
    }

    let geo: any = null;
    try {
        const q = encodeURIComponent(`${norm.line1} ${norm.city} ${norm.state || ""} ${norm.postal_code} ${norm.country}`);
        let primarySuccess = false;

        if (env.LOCATIONIQ_KEY) {
            const url = `https://us1.locationiq.com/search.php?key=${env.LOCATIONIQ_KEY}&q=${q}&format=json&addressdetails=1`;
            const r = await fetch(url, { headers: { "User-Agent": "Orbicheck/0.1" } });
            const j = await r.json();
            if (Array.isArray(j) && j[0]) {
                geo = { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), confidence: 0.9, source: 'locationiq' };
                primarySuccess = true;
            }
        } else {
            const url = `${env.NOMINATIM_URL}/search?format=json&limit=1&q=${q}`;
            const r = await fetch(url, { headers: { "User-Agent": "Orbicheck/0.1" } });
            const j = await r.json();
            if (Array.isArray(j) && j[0]) {
                geo = { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), confidence: 0.7, source: 'nominatim' };
                primarySuccess = true;
            }
        }

        // Google fallback if primary failed and enabled
        if (!primarySuccess && env.USE_GOOGLE_FALLBACK && env.GOOGLE_GEOCODING_KEY) {
            const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${q}&key=${env.GOOGLE_GEOCODING_KEY}`;
            const gr = await fetch(googleUrl, { headers: { "User-Agent": "Orbicheck/0.1" } });
            const gj = await gr.json();
            if (gj.status === 'OK' && gj.results && gj.results[0]) {
                const loc = gj.results[0].geometry.location;
                geo = { lat: loc.lat, lng: loc.lng, confidence: 0.8, source: 'google' };
            }
        }
    } catch {
        // ignore geocoding errors
    }

    const valid = postal_city_match && !po_box;
    result = {
        valid,
        normalized: norm,
        po_box,
        postal_city_match,
        geo,
        reason_codes,
        request_id: crypto.randomUUID(),
        ttl_seconds: 7 * 24 * 3600
    };

    if (redis) {
        await redis.set(cacheKey, JSON.stringify(result), 'EX', 7 * 24 * 3600);
    }

    return result;
}