import crypto from "crypto";
function onlyDigits(s: string) { return (s || "").replace(/[^0-9]/g, ""); }
function mod11Checksum(nums: number[], weights: number[]) {
    const sum = nums.reduce((acc, n, i) => acc + n * weights[i], 0);
    const mod = sum % 11;
    return mod;
}

// BR CPF: 11 digits, 2 check digits
export function validateCPF(value: string) {
    const v = onlyDigits(value);
    if (v.length !== 11) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    if (/^(\d)\1+$/.test(v)) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    const n = v.split("").map(Number);
    const d1 = (n.slice(0, 9).reduce((acc, cur, idx) => acc + cur * (10 - idx), 0) * 10) % 11 % 10;
    const d2 = (n.slice(0, 10).reduce((acc, cur, idx) => acc + cur * (11 - idx), 0) * 10) % 11 % 10;
    const ok = d1 === n[9] && d2 === n[10];
    return { valid: ok, reason_codes: ok ? [] : ["taxid.invalid_checksum"] };
}

// BR CNPJ: 14 digits, 2 check digits
export function validateCNPJ(value: string) {
    const v = onlyDigits(value);
    if (v.length !== 14) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    if (/^(\d)\1+$/.test(v)) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    const n = v.split("").map(Number);
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const w2 = [6].concat(w1);
    const d1 = 11 - (n.slice(0, 12).reduce((acc, cur, idx) => acc + cur * w1[idx], 0) % 11); const cd1 = d1 > 9 ? 0 : d1;
    const d2 = 11 - (n.slice(0, 13).reduce((acc, cur, idx) => acc + cur * w2[idx], 0) % 11); const cd2 = d2 > 9 ? 0 : d2;
    const ok = cd1 === n[12] && cd2 === n[13];
    return { valid: ok, reason_codes: ok ? [] : ["taxid.invalid_checksum"] };
}

// MX RFC: 12 or 13 chars, mod 11 check digit with charset
const RFC_CHARS = "0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ";
const RFC_MAP: Record<string, number> = Object.fromEntries(RFC_CHARS.split("").map((c, i) => [c, i]));
export function validateRFC(value: string) {
    const v = value.trim().toUpperCase();
    if (!/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{2}\d$/.test(v)) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    const body = v.slice(0, v.length - 1);
    const check = v.slice(-1);
    let sum = 0;
    const weights = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    const pad = (12 - body.length);
    const padded = " ".repeat(pad) + body;
    for (let i = 0; i < 12; i++) { sum += (RFC_MAP[padded[i]] || 0) * weights[i]; }
    const dg = 11 - (sum % 11);
    const cd = dg === 11 ? "0" : dg === 10 ? "A" : String(dg);
    const ok = cd === check;
    return { valid: ok, reason_codes: ok ? [] : ["taxid.invalid_checksum"] };
}

// AR CUIT: 11 digits
export function validateCUIT(value: string) {
    const v = onlyDigits(value);
    if (v.length !== 11) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const nums = v.split("").map(Number);
    const s = nums.slice(0, 10).reduce((acc, cur, idx) => acc + cur * w[idx], 0);
    const mod = 11 - (s % 11);
    const cd = mod === 11 ? 0 : mod === 10 ? 9 : mod;
    const ok = cd === nums[10];
    return { valid: ok, reason_codes: ok ? [] : ["taxid.invalid_checksum"] };
}

// CL RUT: digits + K check
export function validateRUT(value: string) {
    const v = value.replace(/./g, "").replace(/-/g, "").toUpperCase();
    const body = v.slice(0, -1); const dv = v.slice(-1);
    if (!/^\d+$/.test(body)) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    let sum = 0, mul = 2;
    for (let i = body.length - 1; i >= 0; i--) {
        sum += parseInt(body[i], 10) * mul;
        mul = (mul === 7) ? 2 : (mul + 1);
    }
    const res = 11 - (sum % 11);
    const cd = res === 11 ? "0" : res === 10 ? "K" : String(res);
    const ok = cd === dv;
    return { valid: ok, reason_codes: ok ? [] : ["taxid.invalid_checksum"] };
}

// PE RUC: 11 digits with known prefixes, checksum
export function validateRUC(value: string) {
    const v = onlyDigits(value);
    if (v.length !== 11) return { valid: false, reason_codes: ["taxid.invalid_format"] };
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const nums = v.split("").map(Number);
    const s = nums.slice(0, 10).reduce((acc, cur, idx) => acc + cur * weights[idx], 0);
    const mod = 11 - (s % 11);
    const cd = (mod === 11) ? 1 : (mod === 10) ? 2 : mod;
    const ok = cd === nums[10];
    return { valid: ok, reason_codes: ok ? [] : ["taxid.invalid_checksum"] };
}

// CO NIT: mod 11
export function validateNIT(value: string) {
    const v = onlyDigits(value);
    const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43];
    const nums = v.slice(0, -1).split("").reverse().map(Number);
    let sum = 0;
    for (let i = 0; i < nums.length; i++) { sum += nums[i] * (weights[i] || 3); }
    const mod = sum % 11;
    const cd = (mod > 1) ? (11 - mod) : 0;
    const ok = cd === Number(v.slice(-1));
    return { valid: ok, reason_codes: ok ? [] : ["taxid.invalid_checksum"] };
}

// ES NIF/NIE/CIF (simplified formats, checksum)
const NIF_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
export function validateES(value: string) {
    let v = value.trim().toUpperCase();
    v = v.replace(/\s/g, "");

    // NIE: X/Y/Z + 7 digits + letter
    if (/^[XYZ]\d{7}[A-Z]$/.test(v)) {
        const map: any = { X: "0", Y: "1", Z: "2" };
        const num = map[v[0]] + v.slice(1, 8);
        const letter = NIF_LETTERS[parseInt(num, 10) % 23];
        return {
            valid: letter === v[8],
            reason_codes: letter === v[8] ? [] : ["taxid.invalid_checksum"],
        };
    }

    // NIF: 8 digits + letter
    if (/\d{8}[A-Z]/.test(v)) {
        const num = parseInt(v.slice(0, 8), 10);
        const letter = NIF_LETTERS[num % 23];
        return {
            valid: letter === v[8],
            reason_codes: letter === v[8] ? [] : ["taxid.invalid_checksum"],
        };
    }

    // CIF simplified: letter + 7 digits + control
    if (/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(v)) {
        // Simplified acceptance (full CIF rules are longer)
        return { valid: true, reason_codes: [] };
    }

    return { valid: false, reason_codes: ["taxid.invalid_format"] };
}

// US EIN: format only
export function validateEIN(value: string) {
    const v = onlyDigits(value);
    return { valid: v.length === 9, reason_codes: v.length === 9 ? [] : ["taxid.invalid_format"] };
}

// VIES SOAP
import soap from "soap";
export async function validateVATViaVIES(country: string, vatNumber: string): Promise<{ valid: boolean; reason_codes: string[]; source: string }> {
    try {
        const client = await soap.createClientAsync(process.env.VIES_WSDL_URL || "https://ec.europa.eu/taxation_customs/vies/checkVatService.wsdl");
        const [result] = await client.checkVatAsync({ countryCode: country, vatNumber });
        if (result.valid) return { valid: true, reason_codes: [], source: "vies" };
        return { valid: false, reason_codes: ["taxid.vies_invalid"], source: "vies" };
    } catch {
        return { valid: false, reason_codes: ["taxid.vies_unavailable"], source: "vies" };
    }
}

export async function validateTaxId({ type, value, country }: { type: string, value: string, country: string }) {
    const t = type.toUpperCase();
    let base = { valid: false, reason_codes: [] as string[], request_id: crypto.randomUUID(), source: "format", normalized: value.replace(/\s/g, "") };
    if (t === "CPF") return { ...base, ...validateCPF(value) };
    if (t === "CNPJ") return { ...base, ...validateCNPJ(value) };
    if (t === "RFC") return { ...base, ...validateRFC(value) };
    if (t === "CUIT") return { ...base, ...validateCUIT(value) };
    if (t === "RUT") return { ...base, ...validateRUT(value) };
    if (t === "RUC") return { ...base, ...validateRUC(value) };
    if (t === "NIT") return { ...base, ...validateNIT(value) };
    if (t === "NIF" || t === "NIE" || t === "CIF") return { ...base, ...validateES(value) };
    if (t === "EIN") return { ...base, ...validateEIN(value) };
    if (t === "VAT") {
        const cc = country?.toUpperCase() || value.slice(0, 2);
        const vn = value.replace(/^[A-Z]{2}/, "");
        const res = await validateVATViaVIES(cc, vn);
        return { ...base, valid: res.valid, reason_codes: res.reason_codes, source: res.source };
    }
    return { ...base, valid: false, reason_codes: ["taxid.invalid_format"] };
}