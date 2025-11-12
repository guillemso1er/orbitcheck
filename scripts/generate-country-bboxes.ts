import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

type Geometry = { type: 'Polygon' | 'MultiPolygon'; coordinates: any };
type Feature = {
    type: 'Feature';
    properties: Record<string, any>;
    geometry: Geometry;
};
type FC = { type: 'FeatureCollection'; features: Feature[] };

const SRC_CANDIDATES = [
    // 50m (preferred)
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson',
    // fallbacks if needed
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson',
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',
];

function fetchJson(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const doGet = (u: string, redirects = 0) => {
            https.get(u, res => {
                const { statusCode, headers } = res;
                if (statusCode && statusCode >= 300 && statusCode < 400 && headers.location && redirects < 5) {
                    doGet(headers.location.startsWith('http') ? headers.location : new URL(headers.location, u).toString(), redirects + 1);
                    return;
                }
                if (statusCode !== 200) {
                    reject(new Error(`HTTP ${statusCode} for ${u}`));
                    res.resume();
                    return;
                }
                const chunks: Buffer[] = [];
                res.on('data', d => chunks.push(d));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on('error', reject);
        };
        doGet(url);
    });
}

type BBox = { minLat: number; maxLat: number; minLng: number; maxLng: number; wraps: boolean };

function round(n: number, p = 5) {
    const f = Math.pow(10, p);
    return Math.round(n * f) / f;
}

function coordsIter(
    geom: Geometry,
    mapLng: (x: number) => number,
    cb: (lat: number, lng: number) => void
) {
    const push = (arr: any) => {
        for (const ring of arr) {
            for (const [lng, lat] of ring) cb(lat, mapLng(lng));
        }
    };
    if (geom.type === 'Polygon') push(geom.coordinates);
    else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates) push(poly);
}

function bboxFor(geom: Geometry): BBox {
    // Normal envelope in [-180, 180]
    let nMinLat = 90, nMaxLat = -90, nMinLng = 180, nMaxLng = -180;
    coordsIter(geom, x => x, (lat, lng) => {
        if (lat < nMinLat) nMinLat = lat;
        if (lat > nMaxLat) nMaxLat = lat;
        if (lng < nMinLng) nMinLng = lng;
        if (lng > nMaxLng) nMaxLng = lng;
    });
    const nWidth = nMaxLng - nMinLng;

    // Shift longitudes into [0, 360) to avoid antimeridian splits
    let sMinLat = 90, sMaxLat = -90, sMinLng = 360, sMaxLng = 0;
    coordsIter(geom, x => (x < 0 ? x + 360 : x), (lat, lng) => {
        if (lat < sMinLat) sMinLat = lat;
        if (lat > sMaxLat) sMaxLat = lat;
        if (lng < sMinLng) sMinLng = lng;
        if (lng > sMaxLng) sMaxLng = lng;
    });
    const sWidth = sMaxLng - sMinLng;

    if (sWidth < nWidth) {
        const to180 = (x: number) => (x > 180 ? x - 360 : x);
        const minLng180 = to180(sMinLng);
        const maxLng180 = to180(sMaxLng);
        const wraps = minLng180 > maxLng180; // antimeridian wrap
        return { minLat: sMinLat, maxLat: sMaxLat, minLng: round(minLng180), maxLng: round(maxLng180), wraps };
    }
    return { minLat: nMinLat, maxLat: nMaxLat, minLng: round(nMinLng), maxLng: round(nMaxLng), wraps: false };
}

// Best-effort ISO-3166-1 alpha-2 from Natural Earth fields
function getISO2(props: Record<string, any>): string | null {
    // Preferred field in NE v5
    const candidates = [
        'ISO_A2_EH', 'ISO_A2',
        'WB_A2', 'BRK_A3', // rarely helpful
        'POSTAL' // often equals ISO2, but verify downstream if needed
    ];
    for (const k of candidates) {
        const v = props[k];
        if (typeof v === 'string' && /^[A-Z]{2}$/.test(v.toUpperCase())) return v.toUpperCase();
    }
    return null;
}

(async () => {
    let fc: FC | null = null;
    let used: string | null = null;

    for (const url of SRC_CANDIDATES) {
        try {
            const j = await fetchJson(url);
            if (j && j.type === 'FeatureCollection' && Array.isArray(j.features)) {
                fc = j as FC;
                used = url;
                break;
            }
        } catch { /* try next */ }
    }

    if (!fc) {
        throw new Error('Failed to download Natural Earth GeoJSON from all candidates.');
    }

    const rows: { code: string; box: BBox }[] = [];
    for (const f of fc.features) {
        const code = getISO2(f.properties);
        if (!code) continue;           // skip features without ISO2
        if (code === 'TA') continue;    // not ISO 3166-1
        const box = bboxFor(f.geometry);
        box.minLat = round(box.minLat);
        box.maxLat = round(box.maxLat);
        rows.push({ code, box });
    }

    // Deduplicate by code (keep tightest box in case of duplicates)
    const byCode = new Map<string, BBox>();
    for (const r of rows) {
        const existing = byCode.get(r.code);
        const width = (b: BBox) =>
            b.wraps ? (360 - (b.minLng - b.maxLng)) : (b.maxLng - b.minLng);
        if (!existing || width(r.box) < width(existing)) byCode.set(r.code, r.box);
    }

    const out = Array.from(byCode.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, b]) => `('${code}', ${b.minLat}, ${b.maxLat}, ${b.minLng}, ${b.maxLng}, ${b.wraps})`)
        .join(',\n    ');

    const sql = `INSERT INTO countries_bounding_boxes (country_code, min_lat, max_lat, min_lng, max_lng, wraps_dateline) VALUES
    ${out}
ON CONFLICT (country_code) DO UPDATE
SET min_lat = excluded.min_lat,
    max_lat = excluded.max_lat,
    min_lng = excluded.min_lng,
    max_lng = excluded.max_lng,
    wraps_dateline = excluded.wraps_dateline;`;

    const outFile = path.resolve(process.cwd(), 'migrations/999_add_country_bboxes.sql');
    fs.writeFileSync(outFile, sql, 'utf8');
    console.log('Fetched:', used);
    console.log('Wrote', outFile, 'with', byCode.size, 'rows');
})().catch(err => {
    console.error(err);
    process.exit(1);
});