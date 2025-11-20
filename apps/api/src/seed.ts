import { createHash } from "node:crypto";
import { promises as fs } from 'node:fs';
import path from 'node:path';

import AdmZip from 'adm-zip';
import { Pool } from "pg";

import { BATCH_SIZE_GEONAMES, GEO_NAMES_BASE_URL, SEED_API_KEY_PREFIX, SEED_PROJECT_NAME } from "./config.js";

const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL || process.env.DATABASE_URL });

async function randomBytesAsync(size: number): Promise<Buffer> {
    const { randomBytes } = await import('node:crypto');
    return randomBytes(size);
}

async function processCountry(country: string, temporaryDirectory: string, geonamesBaseUrl: string): Promise<number> {
    const zipPath = path.join(temporaryDirectory, `${country}.zip`);
    const tsvPath = path.join(temporaryDirectory, `${country}.txt`);

    console.warn(`Downloading GeoNames postal codes for ${country}...`);
    const url = `${geonamesBaseUrl}/${country}.zip`;
    const response = await fetch(url);
    if (!response.ok) {
        console.warn(`Download failed for ${country}: ${response.status}. Skipping.`);
        return 0;
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(zipPath, buffer);

    console.warn(`Extracting ZIP for ${country}...`);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(temporaryDirectory, true);

    // Handle fallback filename (some zips contain ISO.txt, others ISO_postal_...txt)
    let finalTsvPath = tsvPath;
    try {
        await fs.access(tsvPath);
    } catch {
        const files = await fs.readdir(temporaryDirectory);
        // Find the text file that isn't the readme
        const textFile = files.find(f => f.endsWith('.txt') && !f.toLowerCase().includes('readme') && !f.toLowerCase().includes('license'));
        if (textFile) {
            finalTsvPath = path.join(temporaryDirectory, textFile);
        } else {
            console.warn(`TSV file not found for ${country}. Skipping.`);
            return 0;
        }
    }

    console.warn(`Parsing and importing data for ${country}...`);
    const data = await fs.readFile(finalTsvPath, 'utf8');

    // GeoNames files usually DO NOT have a header row, so we do NOT slice(1).
    // However, check the first char. If it starts with "country code", it's a header.
    let lines = data.trim().split('\n');
    if (lines[0] && lines[0].toLowerCase().startsWith('country')) {
        lines = lines.slice(1);
    }

    const batchSize = BATCH_SIZE_GEONAMES;
    const allBatches: (string | number)[][][] = [];
    let currentBatch: (string | number)[][] = [];
    let countryCount = 0;

    for (const line of lines) {
        if (!line.trim()) continue;

        const parts = line.split('\t');

        // GeoNames Postal Format:
        // 0: country code      (e.g. US)
        // 1: postal code       (e.g. 90210)
        // 2: place name        (e.g. Beverly Hills)
        // 3: admin name1       (e.g. California)
        // 4: admin code1       (e.g. CA)
        // 5: admin name2       (e.g. Los Angeles) - County/District
        // 6: admin code2       (e.g. 037)
        // 7: admin name3       (Community)
        // 8: admin code3
        // 9: latitude
        // 10: longitude
        // 11: accuracy

        // Safety check: ensure we have enough columns
        if (parts.length < 3) continue;

        const rowCountry = parts[0]; // Sometimes the file has the country code, sometimes specific files might not. usually they do.
        const postalCode = parts[1];
        const placeName = parts[2];
        const adminName1 = parts[3] || '';
        const adminCode1 = parts[4] || '';
        const adminName2 = parts[5] || '';
        const adminCode2 = parts[6] || '';
        const lat = parseFloat(parts[9]);
        const lng = parseFloat(parts[10]);

        // Only insert if we have a valid number for lat/lng
        const validLat = isNaN(lat) ? 0 : lat;
        const validLng = isNaN(lng) ? 0 : lng;

        // Use the 'country' arg as fallback if the row's country code is empty
        const finalCountry = rowCountry || country;

        currentBatch.push([
            finalCountry,
            postalCode,
            placeName,
            adminName1,
            adminCode1,
            adminName2,
            adminCode2,
            validLat,
            validLng
        ]);

        if (currentBatch.length >= batchSize) {
            allBatches.push(currentBatch);
            countryCount += currentBatch.length;
            currentBatch = [];
        }
    }

    if (currentBatch.length > 0) {
        allBatches.push(currentBatch);
        countryCount += currentBatch.length;
    }

    await Promise.all(allBatches.map(batch => insertBatch(pool, batch)));
    console.warn(`Successfully imported ${countryCount} records for ${country}.`);

    // Cleanup
    try {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
    } catch { } // Ignore cleanup errors

    return countryCount;
}

async function downloadAndImport(): Promise<void> {
    const temporaryDirectory = '/tmp/geonames';
    // Replaced 'AR' with a comprehensive list of ISO 3166-1 alpha-2 country codes.
    const countries = [
        'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU',
        'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL',
        'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC',
        'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV',
        'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG',
        'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD',
        'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT',
        'GU', 'GW', 'GY', 'HK', 'HM', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM',
        'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH',
        'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK',
        'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH',
        'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW',
        'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR',
        'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR',
        'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC',
        'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
        'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL',
        'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY',
        'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA',
        'ZM', 'ZW'
    ];

    try {
        // Create temp dir
        try {
            await fs.mkdir(temporaryDirectory, { recursive: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }

        // Process countries in parallel
        const counts = await Promise.all(
            countries.map(country => processCountry(country, temporaryDirectory, GEO_NAMES_BASE_URL))
        );
        const totalCount = counts.reduce((sum, count) => sum + count, 0);

        console.warn(`Total postal code records imported: ${totalCount}.`);
    } catch (error) {
        console.error('Import failed:', error);
        // Don't exit on import failure, as seed can continue
    } finally {
        // Clean up temporary directory
        try {
            await fs.rm(temporaryDirectory, { recursive: true, force: true });
            console.warn('Cleaned up temporary directory:', temporaryDirectory);
        } catch (cleanupError) {
            console.warn('Failed to clean up temporary directory:', cleanupError);
        }
    }
}

async function insertBatch(_pool: Pool, batch: (string | number)[][]): Promise<void> {
    const client = await _pool.connect();
    try {
        // We now insert 9 values per row
        const placeholders = batch.map((_, index) =>
            `($${index * 9 + 1}, $${index * 9 + 2}, $${index * 9 + 3}, $${index * 9 + 4}, $${index * 9 + 5}, $${index * 9 + 6}, $${index * 9 + 7}, $${index * 9 + 8}, $${index * 9 + 9})`
        ).join(', ');

        const query = `
            INSERT INTO geonames_postal (
                country_code, postal_code, place_name, 
                admin_name1, admin_code1, 
                admin_name2, admin_code2, 
                latitude, longitude
            )
            VALUES ${placeholders}
            ON CONFLICT DO NOTHING
        `;

        const flatValues = batch.flat();
        await client.query(query, flatValues);
    } finally {
        client.release();
    }
}


export async function main(endPool: boolean = true): Promise<void> {
    try {
        // Check if seed project already exists
        const { rows: existingProjects } = await pool.query("SELECT id FROM projects WHERE name = $1", [SEED_PROJECT_NAME]);

        let project_id: number;
        if (existingProjects.length > 0) {
            project_id = existingProjects[0].id;
            console.warn(`Seed project "${SEED_PROJECT_NAME}" already exists with ID: ${project_id}`);
        } else {
            const { rows } = await pool.query("INSERT INTO projects (name, plan) VALUES ($1, $2) RETURNING id", [SEED_PROJECT_NAME, "dev"]);
            project_id = rows[0].id;
            console.warn(`Created seed project "${SEED_PROJECT_NAME}" with ID: ${project_id}`);
        }

        // Check if API key already exists for this project
        const { rows: existingKeys } = await pool.query("SELECT prefix FROM api_keys WHERE project_id = $1", [project_id]);

        if (existingKeys.length > 0) {
            console.warn(`API key already exists for project ${project_id} with prefix: ${existingKeys[0].prefix}`);
        } else {
            const buf = await randomBytesAsync(18);
            const raw = SEED_API_KEY_PREFIX + buf.toString("hex");

            // Use the same hashing mechanism as the auth function
            const hash = createHash('sha256').update(raw).digest('hex');

            // The hash column in your DB should be a simple TEXT or VARCHAR
            await pool.query(
                "INSERT INTO api_keys(project_id, prefix, hash, status) VALUES ($1, $2, $3, $4)",
                [project_id, raw.slice(0, 6), hash, 'active']
            );

            console.warn("PROJECT_ID=", project_id);
            console.warn("API_KEY=", raw);
        }

        // Check if geonames_postal is empty and import if needed
        const { rows: countRows } = await pool.query("SELECT COUNT(*) FROM geonames_postal");
        const count = Number.parseInt(countRows[0].count);
        if (count === 0) {
            console.warn('GeoNames postal data not found, importing...');
            await downloadAndImport();
        } else {
            console.warn(`GeoNames postal data already present (${count} records). Skipping import.`);
        }

        if (endPool) {
            await pool.end();
        }
    } catch (error) {
        console.error('Seed script failed:', error);
        if (endPool) {
            await pool.end().catch(() => { });
        }
        throw error;
    }
}

if (process.argv[1] === import.meta.url.slice(7)) {
    // eslint-disable-next-line promise/prefer-await-to-then
    void main().catch(console.error);
}