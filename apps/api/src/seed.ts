import { createHash } from "node:crypto";
import { promises as fs } from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';
dotenv.config();

import AdmZip from 'adm-zip';
import { Pool } from "pg";

import { BATCH_SIZE_GEONAMES, GEO_NAMES_BASE_URL, SEED_API_KEY_PREFIX, SEED_PROJECT_NAME } from "./config.js";

console.warn('DATABASE_URL:', process.env.DATABASE_URL);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function randomBytesAsync(size: number): Promise<Buffer> {
    const { randomBytes } = await import('node:crypto');
    return randomBytes(size);
}

async function processCountry(country: string, temporaryDirectory: string, geonamesBaseUrl: string): Promise<number> {
    const zipPath = path.join(temporaryDirectory, `${country}.zip`);
    const tsvPath = path.join(temporaryDirectory, `${country}postalCodeLatLongCity.txt`);

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

    try {
        await fs.access(tsvPath);
    } catch {
        console.warn(`TSV file not found for ${country} after extraction. Skipping.`);
        await fs.unlink(zipPath).catch(() => { });
        return 0;
    }

    console.warn(`Parsing and importing data for ${country}...`);
    const data = await fs.readFile(tsvPath, 'utf8');
    const lines = data.trim().split('\n').slice(1); // Skip header if present

    const batchSize = BATCH_SIZE_GEONAMES;
    const allBatches: (string | number)[][][] = [];
    let currentBatch: (string | number)[][] = [];
    let countryCount = 0;

    // Prepare all batches first
    for (const line of lines) {
        const [postalCode, placeName, adminName1, adminCode1, lat, lng, _accuracy] = line.split('\t');
        if (postalCode && placeName) { // Skip empty postal codes
            currentBatch.push([country, postalCode, placeName, adminName1 || '', adminCode1 || '', Number.parseFloat(lat), Number.parseFloat(lng)]);

            if (currentBatch.length >= batchSize) {
                allBatches.push(currentBatch);
                countryCount += currentBatch.length;
                currentBatch = [];
            }
        }
    }

    // Add remaining batch
    if (currentBatch.length > 0) {
        allBatches.push(currentBatch);
        countryCount += currentBatch.length;
    }

    // Process batches in parallel
    await Promise.all(allBatches.map(batch => insertBatch(pool, batch)));
    console.warn(`Successfully imported ${countryCount} postal code records for ${country}.`);

    // Cleanup in parallel
    await Promise.all([
        fs.unlink(zipPath).catch(() => { }),
        fs.unlink(tsvPath).catch(() => { })
    ]);

    return countryCount;
}

async function downloadAndImport(): Promise<void> {
    const temporaryDirectory = '/tmp/geonames';
    const countries = ['AR']; // Default to Argentina; extend as needed

    try {
        // Create temp dir
        try {
            await fs.mkdir(temporaryDirectory, { recursive: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }

        // Process countries
        const totalCount = await processCountry(countries[0], temporaryDirectory, GEO_NAMES_BASE_URL);

        // For parallel processing (use with caution):
        // const counts = await Promise.all(
        //     countries.map(country => processCountry(country, temporaryDirectory, GEONAMES_BASE_URL))
        // );
        // const totalCount = counts.reduce((sum, count) => sum + count, 0);

        console.warn(`Total postal code records imported: ${totalCount}.`);
    } catch (error) {
        console.error('Import failed:', error);
        // Don't exit on import failure, as seed can continue
    }
}

async function insertBatch(_pool: Pool, batch: (string | number)[][]): Promise<void> {
    const client = await _pool.connect();
    try {
        const placeholders = batch.map((_, index) => `($${index * 7 + 1}, $${index * 7 + 2}, $${index * 7 + 3}, $${index * 7 + 4}, $${index * 7 + 5}, $${index * 7 + 6}, $${index * 7 + 7})`).join(', ');

        const query = `
            INSERT INTO geonames_postal (country_code, postal_code, place_name, admin_name1, admin_code1, latitude, longitude)
            VALUES ${placeholders}
            ON CONFLICT DO NOTHING
        `;

        const flatValues = batch.flat();
        await client.query(query, flatValues);
    } finally {
        client.release();
    }
}

async function main(): Promise<void> {
    try {
        const { rows } = await pool.query("insert into projects (name, plan) values ($1, $2) returning id", [SEED_PROJECT_NAME, "dev"]);
        const project_id = rows[0].id;
        const buf = await randomBytesAsync(18);
        const raw = SEED_API_KEY_PREFIX + buf.toString("hex");

        // Use the same hashing mechanism as the auth function
        const hash = createHash('sha256').update(raw).digest('hex');

        // The hash column in your DB should be a simple TEXT or VARCHAR
        await pool.query(
            "insert into api_keys(project_id, prefix, hash, status) values ($1, $2, $3, $4)",
            [project_id, raw.slice(0, 6), hash, 'active']
        );

        console.warn("PROJECT_ID=", project_id);
        console.warn("API_KEY=", raw);

        // Check if geonames_postal is empty and import if needed
        const { rows: countRows } = await pool.query("SELECT COUNT(*) FROM geonames_postal");
        const count = Number.parseInt(countRows[0].count);
        if (count === 0) {
            console.warn('GeoNames postal data not found, importing...');
            await downloadAndImport();
        } else {
            console.warn(`GeoNames postal data already present (${count} records). Skipping import.`);
        }

        await pool.end();
    } catch (error) {
        console.error('Seed script failed:', error);
        throw error;
    }
}

main().catch(console.error);