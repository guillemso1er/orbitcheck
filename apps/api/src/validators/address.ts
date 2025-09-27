import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

// Simple PO Box detector for multiple locales
export function detectPoBox(line: string): boolean {
    const s = (line || "").toLowerCase();
    return /(po box|p.o. box| apartado | apartado postal |caixa postal|casilla|cas.b|bo?.?x)/i.test(s);
}

// Use libpostal CLI (installed in image) to normalize; simple wrapper to avoid native bindings complexity
export async function normalizeAddress(addr: { line1: string; line2?: string; city: string; state?: string; postal_code: string; country: string; }): Promise<any> {
    const joined = `${addr.line1}, ${addr.line2 || ""}, ${addr.city}, ${addr.state || ""}, ${addr.postal_code}, ${addr.country}`;
    const { stdout } = await exec("/usr/local/bin/parse-address", [joined]);
    // Fallback: naive normalization if libpostal rest wrapper not present
    const parts: any = {};
    stdout.split("\n").forEach(line => {
        const [k, v] = line.split(":").map(s => s?.trim());
        if (k && v) parts[k] = v;
    });
    return {
        line1: (parts.house_number && parts.road) ? `${parts.house_number} ${parts.road}` : addr.line1,
        line2: addr.line2 || "",
        city: parts.city || addr.city,
        state: parts.state || addr.state || "",
        postal_code: parts.postcode || addr.postal_code,
        country: (parts.country || addr.country).toUpperCase()
    };
}