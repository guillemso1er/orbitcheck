import dotenv from 'dotenv';
dotenv.config();
import { createHash, randomBytes } from "node:crypto";
import * as fs from 'node:fs';
import * as path from 'node:path';

import AdmZip from 'adm-zip';
import fetch from 'node-fetch';
import { Pool } from "pg";

console.log('DATABASE_URL:', process.env.DATABASE_URL);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function downloadAndImport() {
    const tempDir = '/tmp/geonames';
    const countries = ['AR']; // Default to Argentina; extend as needed
    const GEONAMES_BASE_URL = 'http://download.geonames.org/export/zip';

    try {
        // Create temp dir
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        let totalCount = 0;

        for (const country of countries) {
            const zipPath = path.join(tempDir, `${country}.zip`);
            const tsvPath = path.join(tempDir, `${country}postalCodeLatLongCity.txt`);

            console.log(`Downloading GeoNames postal codes for ${country}...`);
            const url = `${GEONAMES_BASE_URL}/${country}.zip`;
            const response = await fetch(url);
            if (!response.ok) {
                console.warn(`Download failed for ${country}: ${response.status}. Skipping.`);
                continue;
            }
            const buffer = await response.buffer();
            fs.writeFileSync(zipPath, buffer);

            console.log(`Extracting ZIP for ${country}...`);
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(tempDir, true);

            if (!fs.existsSync(tsvPath)) {
                console.warn(`TSV file not found for ${country} after extraction. Skipping.`);
                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
                continue;
            }

            console.log(`Parsing and importing data for ${country}...`);
            const data = fs.readFileSync(tsvPath, 'utf8');
            const lines = data.trim().split('\n').slice(1); // Skip header if present

            const batchSize = 1000;
            let batch: (string | number)[][] = [];
            let countryCount = 0;

            for (const line of lines) {
                const [postalCode, placeName, adminName1, adminCode1, lat, lng, accuracy] = line.split('\t');
                if (postalCode && placeName) { // Skip empty postal codes
                    batch.push([country, postalCode, placeName, adminName1 || '', adminCode1 || '', Number.parseFloat(lat), Number.parseFloat(lng)]);

                    if (batch.length >= batchSize) {
                        await insertBatch(pool, batch);
                        countryCount += batch.length;
                        totalCount += batch.length;
                        console.log(`Imported ${countryCount} records for ${country}...`);
                        batch = [];
                    }
                }
            }

            // Insert remaining
            if (batch.length > 0) {
                await insertBatch(pool, batch);
                countryCount += batch.length;
                totalCount += batch.length;
            }

            console.log(`Successfully imported ${countryCount} postal code records for ${country}.`);

            // Cleanup
            if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
            if (fs.existsSync(tsvPath)) fs.unlinkSync(tsvPath);
        }

        console.log(`Total postal code records imported: ${totalCount}.`);
    } catch (error) {
        console.error('Import failed:', error);
        // Don't exit on import failure, as seed can continue
    }
}

async function insertBatch(pool: Pool, batch: (string | number)[][]) {
    const client = await pool.connect();
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

(async () => {
    const { rows } = await pool.query("insert into projects (name, plan) values ($1, $2) returning id", ["Dev Project", "dev"]);
    const project_id = rows[0].id;
    const raw = "ok_test_" + randomBytes(18).toString("hex");

    // Use the same hashing mechanism as the auth function
    const hash = createHash('sha256').update(raw).digest('hex');

    // The hash column in your DB should be a simple TEXT or VARCHAR
    await pool.query(
        "insert into api_keys(project_id, prefix, hash, status) values ($1, $2, $3, $4)",
        [project_id, raw.slice(0, 6), hash, 'active']
    );

    console.log("PROJECT_ID=", project_id);
    console.log("API_KEY=", raw);

    // Check if geonames_postal is empty and import if needed
    const { rows: countRows } = await pool.query("SELECT COUNT(*) FROM geonames_postal");
    const count = Number.parseInt(countRows[0].count);
    if (count === 0) {
        console.log('GeoNames postal data not found, importing...');
        await downloadAndImport();
    } else {
        console.log(`GeoNames postal data already present (${count} records). Skipping import.`);
    }

    await pool.end();
    process.exit(0);
})();