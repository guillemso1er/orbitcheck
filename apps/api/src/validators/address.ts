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
        match_type?: string;
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
async function validateWithRadar(addr: NormalizedAddress, debugLog: string[] = []): Promise<Partial<ValidationResult> | null> {
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

        if (!res.ok) {
            debugLog.push(`Radar API error: ${res.status} ${res.statusText}`);
            return null;
        }
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
async function validateWithGeoapify(
    addr: NormalizedAddress,
    debugLog: string[] = []
): Promise<Partial<ValidationResult> | null> {
    const API_KEY = environment.GEOAPIFY_KEY;
    if (!API_KEY) {
        debugLog.push("Geoapify key not configured");
        return null; // keep 'null' to let the pipeline try other providers
    }

    // ---------- Helpers ----------
    const PO_BOX_REGEX =
        /\b(p(?:ost(?:al)?)?\.?\s*o(?:ffice)?\.?\s*box|apo|fpo|dpo|bo[íi]te\s*postale|gpo\s*box|apartado|casilla)\b/i;

    const DISALLOWED_CATEGORY_PREFIXES = [
        "entertainment.museum",
        "airport",
        "memorial",
        "religion.place_of_worship",
        "public_transport",
        "office.diplomatic",
        "office.government",
        "education"
    ];

    // Minimal “unique ZIP” hook; replace with USPS dataset lookup in production
    const UNIQUE_ZIPS_US = new Set<string>(["20500"]); // White House
    function isUniqueZipUS(zip?: string) {
        return !!zip && UNIQUE_ZIPS_US.has(zip);
    }

    function isMilitaryAddress(a: { city?: string; state?: string }) {
        const city = (a.city || "").toUpperCase();
        const state = (a.state || "").toUpperCase();
        return ["APO", "FPO", "DPO"].includes(city) && ["AA", "AE", "AP"].includes(state);
    }

    function parseLine1(line1: string | undefined): { housenumber?: string; street?: string } {
        if (!line1) return {};
        // Handles "221B Baker Street", "1600 Pennsylvania Ave NW", "10 Downing St"
        const m = line1.trim().match(/^(\d+\w*)\s+(.+)$/);
        if (!m) return {};
        return { housenumber: m[1], street: m[2] };
    }

    function startsWithAny(cat: string | undefined, prefixes: string[]) {
        if (!cat) return false;
        return prefixes.some((p) => cat === p || cat.startsWith(p + "."));
    }

    type GeoFeature = {
        properties: any;
        geometry: { coordinates: [number, number] };
    };

    // Prefer full_match > match_by_building > match_by_street > inner_part > match_by_postcode > match_by_city(_or_district) > match_by_country_or_state
    const MATCH_TYPE_SCORE: Record<string, number> = {
        full_match: 100,
        match_by_building: 95,
        match_by_street: 80,
        inner_part: 70,
        match_by_postcode: 40,
        match_by_city_or_district: 30,
        match_by_city_or_disrict: 30, // some payloads miss the 't'
        match_by_country_or_state: 10
    };

    function pickBestFeature(features: GeoFeature[]): GeoFeature | undefined {
        if (!features?.length) return undefined;
        // Score by: result_type (building first), building confidence, match_type, overall confidence
        return [...features].sort((a, b) => {
            const pa = a.properties ?? {};
            const pb = b.properties ?? {};
            const ra = pa.rank ?? {};
            const rb = pb.rank ?? {};
            const aBuilding = pa.result_type === "building" ? 1 : 0;
            const bBuilding = pb.result_type === "building" ? 1 : 0;
            if (bBuilding !== aBuilding) return bBuilding - aBuilding;

            const aBC = typeof ra.confidence_building_level === "number" ? ra.confidence_building_level : -1;
            const bBC = typeof rb.confidence_building_level === "number" ? rb.confidence_building_level : -1;
            if (bBC !== aBC) return bBC - aBC;

            const aMatch = MATCH_TYPE_SCORE[ra.match_type] ?? 0;
            const bMatch = MATCH_TYPE_SCORE[rb.match_type] ?? 0;
            if (bMatch !== aMatch) return bMatch - aMatch;

            const aConf = typeof ra.confidence === "number" ? ra.confidence : -1;
            const bConf = typeof rb.confidence === "number" ? rb.confidence : -1;
            return bConf - aConf;
        })[0];
    }

    function classify(properties: any, inputText: string) {
        const rank = properties?.rank ?? {};
        const resultType = properties?.result_type;
        const hasHouseNumber = !!properties?.housenumber;
        const matchType: string = rank?.match_type || "unknown";
        const buildingConf: number =
            typeof rank?.confidence_building_level === "number" ? rank.confidence_building_level : 0;
        const overallConf: number = typeof rank?.confidence === "number" ? rank.confidence : 0;

        const reasons: string[] = [];
        let needsReview = false;

        // Postal-only checks (input-based)
        const isPOBox = PO_BOX_REGEX.test(inputText);
        if (isPOBox) reasons.push("PO_BOX");

        // Geo hard fails
        if (resultType !== "building") reasons.push("NON_BUILDING_RESULT");
        if (!hasHouseNumber) reasons.push("MISSING_HOUSENUMBER");
        if (["match_by_country_or_state", "match_by_postcode", "match_by_city_or_disrict", "match_by_city_or_district"].includes(matchType)) {
            reasons.push("GEO_MATCH_TOO_BROAD");
        }
        if (buildingConf === 0) reasons.push("GEO_BUILDING_CONFIDENCE_ZERO");

        // Soft fails (review)
        if (["inner_part", "match_by_street"].includes(matchType)) {
            reasons.push("GEO_PARTIAL_MATCH_TYPE");
            needsReview = true;
        }
        if (buildingConf < 0.9) {
            reasons.push("GEO_BUILDING_CONFIDENCE_LOW");
            needsReview = true;
        }

        // Category-based review
        const category: string | undefined = properties?.category;
        if (startsWithAny(category, DISALLOWED_CATEGORY_PREFIXES)) {
            reasons.push("INSTITUTION_OR_LANDMARK");
            needsReview = true;
        }

        // Military & unique ZIPs
        const stateLike = properties?.state_code || properties?.state;
        const cityLike = properties?.city;
        if (isMilitaryAddress({ city: cityLike, state: stateLike })) {
            reasons.push("MILITARY_ADDRESS");
            needsReview = true;
        }
        if (isUniqueZipUS(properties?.postcode)) {
            reasons.push("UNIQUE_ZIP_ORGANIZATION");
            needsReview = true;
        }

        const hardFail =
            reasons.includes("PO_BOX") ||
            reasons.includes("NON_BUILDING_RESULT") ||
            reasons.includes("MISSING_HOUSENUMBER") ||
            reasons.includes("GEO_MATCH_TOO_BROAD") ||
            reasons.includes("GEO_BUILDING_CONFIDENCE_ZERO");

        const deliverable =
            !hardFail &&
            !needsReview &&
            (matchType === "full_match" || matchType === "match_by_building") &&
            buildingConf >= 0.9;

        return {
            deliverable,
            needsReview,
            reasons,
            buildingConf,
            overallConf,
            category
        };
    }

    function toNormalized(properties: any, fallback: NormalizedAddress): NormalizedAddress {
        return {
            line1: properties?.address_line1 || fallback.line1,
            line2: fallback.line2,
            city: properties?.city || fallback.city,
            state: properties?.state_code || properties?.state || fallback.state,
            postal_code: properties?.postcode || fallback.postal_code,
            country: (properties?.country_code || fallback.country || "").toString().toUpperCase()
        };
    }

    function buildResult({
        valid,
        score,
        normalized,
        geo,
        reason_codes,
        extra
    }: {
        valid: boolean;
        score: number;
        normalized: NormalizedAddress;
        geo?: { lat: number; lng: number; confidence: number; source: "radar" | "geoapify" | "nominatim" | "local_db" };
        reason_codes: string[];
        extra?: Partial<ValidationResult["metadata"]> & { category?: string; needs_review?: boolean };
    }): Partial<ValidationResult> {
        return {
            valid,
            score,
            normalized,
            metadata: {
                is_residential: null,
                is_po_box: reason_codes.includes("PO_BOX"),
                format_matched: true,
                ...(extra?.needs_review !== undefined ? { needs_review: extra.needs_review } : {}),
                ...(extra?.category ? { category: extra.category } : {}),
                ...extra
            },
            ...(geo ? { geo } : {}),
            source_used: "geoapify",
            reason_codes
        };
    }

    // ---------- Fetch candidates (structured first, then text) ----------
    const { housenumber, street } = parseLine1(addr.line1);
    const qs = (o: Record<string, string | number | undefined>) =>
        Object.entries(o)
            .filter(([, v]) => v !== undefined && v !== "")
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join("&");

    const inputText = `${addr.line1}, ${addr.city}, ${addr.state} ${addr.postal_code}, ${addr.country}`;
    const urls: string[] = [];

    if (housenumber && street) {
        urls.push(
            `https://api.geoapify.com/v1/geocode/search?${qs({
                housenumber,
                street,
                city: addr.city,
                state: addr.state,
                postcode: addr.postal_code,
                country: addr.country,
                limit: 3,
                apiKey: API_KEY
            })}`
        );
    }

    // Always have a text fallback
    urls.push(
        `https://api.geoapify.com/v1/geocode/search?${qs({
            text: inputText,
            limit: 3,
            apiKey: API_KEY
        })}`
    );

    let allFeatures: GeoFeature[] = [];
    let apiError: { status: number; statusText: string } | null = null;

    try {
        for (const url of urls) {
            try {
                const res = await fetch(url);
                if (!res.ok) {
                    apiError = { status: res.status, statusText: res.statusText };
                    debugLog.push(`Geoapify API error: ${res.status} ${res.statusText}`);
                    continue;
                }
                const data = (await res.json()) as { features?: GeoFeature[] };
                const feats = Array.isArray(data?.features) ? data.features : [];

                if (feats.length) {
                    allFeatures = allFeatures.concat(feats);

                    // --- NEW OPTIMIZATION ---
                    // If we found a High Confidence match, stop asking!
                    // Don't burn credits on the text fallback.
                    const bestSoFar = pickBestFeature(feats);
                    const conf = bestSoFar?.properties?.rank?.confidence ?? 0;
                    if (conf >= 0.95) {
                        debugLog.push("Geoapify: High confidence match found in structured search, skipping fallback.");
                        break;
                    }
                }
            } catch (inner) {
                debugLog.push(`Geoapify fetch/parse error: ${String(inner)}`);
            }
        }
    } catch (outer) {
        debugLog.push(`Geoapify unexpected error: ${String(outer)}`);
    }

    if (allFeatures.length === 0 && apiError) {
        debugLog.push(`Geoapify failed critically: ${apiError.status}`);
        return null; // Allow fallback to Nominatim
    }

    if (!allFeatures.length) {
        // The API worked, but the address doesn't exist.
        // We return a RESULT (valid: false), which stops the chain.
        const normalized = {
            line1: addr.line1,
            line2: addr.line2,
            city: addr.city,
            state: addr.state,
            postal_code: addr.postal_code,
            country: addr.country
        };

        return buildResult({
            valid: false,
            score: 0,
            normalized,
            reason_codes: ["ADDRESS_NOT_FOUND", ...(PO_BOX_REGEX.test(inputText) ? ["PO_BOX"] : [])]
        });
    }

    // ---------- Pick and classify best candidate ----------
    const best = pickBestFeature(allFeatures);
    const f = best!.properties;
    const { deliverable, needsReview, reasons, buildingConf, overallConf, category } = classify(f, inputText);

    // Prepare the return payload
    const normalized = toNormalized(f, addr);
    const lat = best!.geometry?.coordinates?.[1];
    const lng = best!.geometry?.coordinates?.[0];

    // Add helpful logging
    debugLog.push(
        `Geoapify: result_type=${f.result_type}, match_type=${f?.rank?.match_type}, ` +
        `conf_building=${buildingConf ?? "n/a"}, conf_overall=${overallConf ?? "n/a"}, category=${category ?? "n/a"}`
    );

    // Decide final validity
    const valid = !!deliverable;
    const reason_codes = reasons.length ? reasons : [];

    return buildResult({
        valid,
        score: Math.round(((buildingConf || overallConf || 0) as number) * 100),
        normalized,
        geo:
            typeof lat === "number" && typeof lng === "number"
                ? { lat, lng, confidence: overallConf || 0, source: "geoapify" }
                : undefined,
        reason_codes,
        extra: {
            needs_review: !!needsReview,
            category
        }
    });
}

/**
 * TIER 3: Nominatim (OpenStreetMap)
 * Limit: Rate limited (1 req/sec), but free.
 */
async function validateWithNominatim(addr: NormalizedAddress, debugLog: string[] = []): Promise<Partial<ValidationResult> | null> {
    try {
        await new Promise(r => { setTimeout(r, 500); });

        // ENCODE:
        const q = encodeURIComponent(`${addr.line1}, ${addr.city}, ${addr.state}, ${addr.postal_code}, ${addr.country}`);

        const res = await fetch(`${environment.NOMINATIM_URL}/search?format=json&addressdetails=1&limit=1&q=${q}`, {
            headers: { "User-Agent": "OrbitCheck/2.0 (Internal Tool)" }
        });

        if (!res.ok) {
            debugLog.push(`Nominatim API error: ${res.status} ${res.statusText}`);
            return null;
        }

        if (res.ok) {
            const data = await res.json() as any[];
            if (data[0]) {
                const d = data[0];
                const resultAddr = d.address;

                // --- FIXED LOGIC HERE ---

                // 1. Determine match precision
                // We REMOVED the "string" check here. If line1 is "string", hasStreetInInput is TRUE.
                const hasStreetInInput = addr.line1 && addr.line1.trim().length > 0;

                // Check if Nominatim returned a specific street/building
                const hasStreetInResult = !!(resultAddr.road || resultAddr.pedestrian || resultAddr.cycleway || resultAddr.footway || resultAddr.house_number);

                // 2. REJECTION LOGIC
                // If we sent "string" (hasStreetInInput=true), but Nominatim returned a State/City (hasStreetInResult=false),
                // THIS will now catch it and return valid: false.
                if (hasStreetInInput && !hasStreetInResult) {
                    return {
                        valid: false,
                        score: 10,
                        source_used: "nominatim",
                        reason_codes: ["GEO_FOUND_BUT_PRECISION_LOW", "MISSING_STREET_MATCH"],
                        geo: {
                            lat: parseFloat(d.lat),
                            lng: parseFloat(d.lon),
                            confidence: 0.1,
                            source: "nominatim"
                        }
                    };
                }

                // --- EXISTING LOGIC ---

                const returnedZip = resultAddr.postcode;
                const strictMatch = returnedZip && returnedZip.replace(/\s/g, '') === addr.postal_code.replace(/\s/g, '');
                const hasHouseNumber = !!resultAddr.house_number;

                let score = 50;
                if (strictMatch) score += 20;
                if (hasHouseNumber) score += 20;

                return {
                    valid: true,
                    score: score,
                    normalized: {
                        line1: resultAddr.house_number
                            ? `${resultAddr.house_number} ${resultAddr.road}`
                            : resultAddr.road || addr.line1,
                        line2: addr.line2,
                        city: resultAddr.city || resultAddr.town || resultAddr.village || addr.city,
                        state: resultAddr.state || addr.state,
                        postal_code: resultAddr.postcode || addr.postal_code,
                        country: (resultAddr.country_code || addr.country).toUpperCase()
                    },
                    metadata: {
                        is_residential: null,
                        is_po_box: false,
                        format_matched: true,
                        match_type: d.type
                    },
                    geo: {
                        lat: parseFloat(d.lat),
                        lng: parseFloat(d.lon),
                        confidence: hasHouseNumber ? 1.0 : 0.7,
                        source: "nominatim"
                    },
                    source_used: "nominatim",
                    reason_codes: strictMatch ? [] : ["ADDRESS_ZIP_MISMATCH_BUT_GEO_FOUND"]
                };
            }
        }
    } catch (e) {
        debugLog.push(`Nominatim error: ${e}`);
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

    // 3. Fail Fast: Block Placeholder/Junk Data
    // This prevents Swagger defaults ("string") from passing as valid City/State matches
    const placeholders = ["string", "test", "n/a", "null", "undefined", "sample"];
    const isPlaceholder = (val: string) => placeholders.includes(val.toLowerCase());

    if (isPlaceholder(input.line1) || isPlaceholder(input.city) || isPlaceholder(input.postal_code)) {
        return formatResult({
            valid: false,
            score: 0,
            normalized: input,
            metadata: { is_residential: null, is_po_box: false, format_matched: false },
            geo: null,
            reason_codes: ["INVALID_INPUT_DATA"], // Specific error for junk data
            source_used: "logic_validation"
        }, cacheKey, input, redis);
    }

    // 4. Fail Fast: Missing Required Fields
    if (!input.line1 || !input.city || !input.country) {
        return formatResult({
            valid: false,
            score: 0,
            normalized: input,
            metadata: { is_residential: null, is_po_box: false, format_matched: false },
            geo: null,
            reason_codes: [REASON_CODES.MISSING_REQUIRED_FIELDS],
            source_used: "logic"
        }, cacheKey, input, redis);
    }

    let result: Partial<ValidationResult> | null = null;

    let debugLog: string[] = [];

    // --- PROVIDER CHAIN ---

    // Step A: Radar (Best Commercial Grade)
    // If Radar works (returns object), we accept its verdict (valid or invalid).
    // If Radar errors (returns null, e.g. 402 Payment), we proceed.
    result = await validateWithRadar(input, debugLog);

    // Step B: Geoapify (Backup)
    // Only run if Radar returned NULL (system error/no key)
    if (!result) {
        result = await validateWithGeoapify(input, debugLog);
    }

    // Step C: Nominatim (Open Source Fallback)
    // Only run if both Radar AND Geoapify returned NULL (system errors)
    if (!result) {
        result = await validateWithNominatim(input, debugLog);
    }

    // Step D: Local DB Fallback
    // Only run if ALL APIs failed to return a result object
    if (!result) {
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

    result = { ...result, debug_log: debugLog };

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