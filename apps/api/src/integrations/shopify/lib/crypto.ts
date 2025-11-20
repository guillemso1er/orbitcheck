import * as crypto from 'node:crypto';
import { promisify } from 'node:util';

import { CRYPTO_IV_BYTES } from '../../../config.js';
import { environment } from '../../../environment.js';

const ALGORITHM = 'aes-256-cbc';
const KEY = Buffer.from(environment.ENCRYPTION_KEY, 'hex');

if (KEY.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 bytes long');
}

export async function encryptShopifyToken(secret: string): Promise<string> {
    const randomBytesAsync = promisify(crypto.randomBytes);
    const iv = await randomBytesAsync(CRYPTO_IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptShopifyToken(value: string): string {
    const [ivHex, payloadHex] = value.split(':');
    if (!ivHex || !payloadHex) {
        throw new Error('Invalid encrypted Shopify token');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(payloadHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
}