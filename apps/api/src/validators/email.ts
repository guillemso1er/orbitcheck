import crypto from "node:crypto";
import dns from "node:dns/promises";
import url from 'node:url';

import { isEmailValid } from '@hapi/address';
import type { Redis } from "ioredis";
import { getDomain as getRegistrableDomain } from 'tldts';

import { DNS_TIMEOUT_MS, DOMAIN_CACHE_TTL_DAYS, REASON_CODES, TTL_EMAIL } from "../constants.js";

/**
 * Utility to add timeout to a Promise, preventing long hangs (e.g., for DNS lookups).
 * Races the input promise against a timeout promise and clears the timer on resolution.
 *
 * @param p - The original Promise to timeout.
 * @param ms - Timeout duration in milliseconds (default: 1200).
 * @returns {Promise} The raced promise; rejects with 'ETIMEDOUT' if timed out.
 */
async function withTimeout<T>(p: Promise<T>, ms = DNS_TIMEOUT_MS): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    try {
        // The timeout promise
        const timeoutPromise = new Promise<never>((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('ETIMEDOUT')), ms);
        });

        // Race the input promise against the timeout
        return await Promise.race([p, timeoutPromise]);
    } finally {
        // CRITICAL: Always clear the timer when the race is over.
        if (timer) clearTimeout(timer);
    }
}

/**
 * Validates an email address: format check, MX records (with A/AAAA fallback), disposable domain check via Redis.
 * Normalizes to lowercase ASCII domain. Caches results in Redis (30 days TTL) using SHA-1 hash.
 * For performance, caches MX and disposable status at domain level (7 days TTL) to avoid repeated DNS/Redis lookups.
 *
 * @param email - The email address to validate.
 * @param redis - Optional Redis client for disposable domain lookup and caching.
 * @returns {Promise<Object>} Validation result with normalized email, validity, MX/disposable status, reason codes, etc.
 */
interface DomainCache {
    mx_found: boolean;
    disposable: boolean;
}

export interface ValidationResult {
    valid: boolean;
    normalized: string;
    disposable: boolean;
    mx_found: boolean;
    reason_codes: string[];
    request_id: string;
    ttl_seconds: number;
}

export async function validateEmail(
    email: string,
    redis?: Redis
): Promise<ValidationResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const input = normalizedEmail;
    const hash = crypto.createHash('sha1').update(input).digest('hex');
    const cacheKey = `validator:email:${hash}`;

    if (redis) {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
    }

    const reason_codes: string[] = [];
    let mx_found = false;
    let disposable = false;
    let domainData: DomainCache | undefined;
    let registrableDomain = '';
    let asciiHost = '';
    let isFormatValid = false;
    let fullNormalized = normalizedEmail;

    try {
        const [local, host = ''] = normalizedEmail.split('@');

        asciiHost = url.domainToASCII(host);
        fullNormalized = (local || '') + (host ? '@' + asciiHost.toLowerCase() : '');
        registrableDomain = asciiHost ? (getRegistrableDomain(asciiHost) || asciiHost) : '';

        // Format validation
        isFormatValid = isEmailValid(fullNormalized);

        if (!isFormatValid) {
            reason_codes.push(REASON_CODES.EMAIL_INVALID_FORMAT);
        }

        // Network-dependent validations
        if (isFormatValid && asciiHost) {
            // Domain-level caching for MX and disposable (7 days TTL)
            const domainCacheKey = `domain:${asciiHost}`;
            if (redis) {
                const domainCache = await redis.get(domainCacheKey);
                if (domainCache) {
                    domainData = JSON.parse(domainCache) as DomainCache;
                    mx_found = domainData.mx_found;
                    disposable = domainData.disposable;
                } else {
                    // DNS LOOKUP (with MX and A/AAAA fallback)
                    try {
                        // First, try to resolve MX records.
                        const recs = await withTimeout(dns.resolveMx(asciiHost));
                        mx_found = !!(recs && recs.length > 0 && recs[0].exchange !== '.');
                    } catch {
                        // If MX lookup fails, fall back to checking for A/AAAA.
                        try {
                            const [a, aaaa] = await Promise.allSettled([
                                withTimeout(dns.resolve4(asciiHost)),
                                withTimeout(dns.resolve6(asciiHost)),
                            ]);
                            const hasA = a.status === 'fulfilled' && (a.value)?.length > 0;
                            const hasAAAA = aaaa.status === 'fulfilled' && (aaaa.value)?.length > 0;
                            mx_found = hasA || hasAAAA;
                        } catch {
                            mx_found = false;
                        }
                    }

                    if (!mx_found) {
                        reason_codes.push(REASON_CODES.EMAIL_MX_NOT_FOUND);
                    }

                    // REDIS LOOKUP for disposable domains
                    const isDisposable =
                        (await redis.sismember('disposable_domains', asciiHost)) ||
                        (registrableDomain && (await redis.sismember('disposable_domains', registrableDomain)));

                    if (isDisposable) {
                        disposable = true;
                        reason_codes.push(REASON_CODES.EMAIL_DISPOSABLE_DOMAIN);
                    }

                    // Cache domain data
                    domainData = { mx_found, disposable };
                    await redis.set(domainCacheKey, JSON.stringify(domainData), 'EX', DOMAIN_CACHE_TTL_DAYS * 24 * 3600);
                }
            } else {
                // Fallback if no Redis
                try {
                    // First, try to resolve MX records.
                    const recs = await withTimeout(dns.resolveMx(asciiHost));
                    mx_found = !!(recs && recs.length > 0 && recs[0].exchange !== '.');
                } catch {
                    try {
                        const [a, aaaa] = await Promise.allSettled([
                            withTimeout(dns.resolve4(asciiHost)),
                            withTimeout(dns.resolve6(asciiHost)),
                        ]);
                        const hasA = a.status === 'fulfilled' && (a.value)?.length > 0;
                        const hasAAAA = aaaa.status === 'fulfilled' && (aaaa.value)?.length > 0;
                        mx_found = hasA || hasAAAA;
                    } catch {
                        mx_found = false;
                    }
                }

                if (!mx_found) {
                    reason_codes.push(REASON_CODES.EMAIL_MX_NOT_FOUND);
                }

                // Disposable check without Redis
                disposable = false; // Can't check without Redis
            }
        }
    } catch {
        // Global safety net
        reason_codes.push(REASON_CODES.EMAIL_SERVER_ERROR);
    }

    const valid = isFormatValid && mx_found && !disposable;
    const result: ValidationResult = {
        valid,
        normalized: fullNormalized,
        disposable,
        mx_found,
        reason_codes,
        request_id: crypto.randomUUID(),
        ttl_seconds: TTL_EMAIL,
    };

    if (redis) {
        await redis.set(cacheKey, JSON.stringify(result), 'EX', TTL_EMAIL);
    }

    return result;
}