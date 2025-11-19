// apps/api/test-postal.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

try {
    const postal = require('node-postal');
    console.log("✅ Library loaded successfully.");

    console.log("Parsing address...");
    // Validating a specific known address to check models
    const results = postal.parser.parse_address("781 Franklin Ave Crown Heights Brooklyn NYC NY 11216 USA");

    console.log("\n--- Result ---");
    console.log(JSON.stringify(results, null, 2));
} catch (e) {
    console.error("❌ Error:", e);
}