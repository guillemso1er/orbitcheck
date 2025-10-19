import AdmZip from 'adm-zip';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orbitcheck';
const GEONAMES_POSTAL_URL = 'http://download.geonames.org/export/dump/postalCodeTSV.zip';

async function downloadAndImport() {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const tempDir = '/tmp/geonames';
    const zipPath = path.join(tempDir, 'postalCodeTSV.zip');
    const tsvPath = path.join(tempDir, 'postalCodeTSV.txt');

    try {
        // Create temp dir
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        console.log('Downloading GeoNames postal codes...');
        const response = await fetch(GEONAMES_POSTAL_URL);
        if (!response.ok) {
            throw new Error(`Download failed: ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(zipPath, buffer);

        console.log('Extracting ZIP...');
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(tempDir, true);

        // The TSV is named postalCodeTSV.txt inside the zip
        if (!fs.existsSync(tsvPath)) {
            throw new Error('TSV file not found after extraction');
        }

        console.log('Parsing and importing data...');
        const data = fs.readFileSync(tsvPath, 'utf8');
        const lines = data.trim().split('\n').slice(1); // Skip header

        const batchSize = 1000;
        let batch: (string | number)[][] = [];
        let count = 0;

        for (const line of lines) {
            const [countryCode, postalCode, placeName, adminName1, adminCode1, lat, lng, accuracy] = line.split('\t');
            if (postalCode && placeName) { // Skip empty postal codes
                batch.push([countryCode, postalCode, placeName, adminName1 || '', adminCode1 || '', parseFloat(lat), parseFloat(lng)]);

                if (batch.length >= batchSize) {
                    await insertBatch(pool, batch);
                    count += batch.length;
                    console.log(`Imported ${count} records...`);
                    batch = [];
                }
            }
        }

        // Insert remaining
        if (batch.length > 0) {
            await insertBatch(pool, batch);
            count += batch.length;
        }

        console.log(`Successfully imported ${count} postal code records.`);
    } catch (error) {
        console.error('Import failed:', error);
        process.exit(1);
    } finally {
        pool.end();
        // Cleanup temp files
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        if (fs.existsSync(tsvPath)) fs.unlinkSync(tsvPath);
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

downloadAndImport();