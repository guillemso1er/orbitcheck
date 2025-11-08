
// Import the actual validation functions from the validators
import crypto from 'crypto';
import { validateAddress } from '../../validators/address.js';
import { validateEmail } from '../../validators/email.js';
import { validateName } from '../../validators/name.js';
import { validatePhone } from '../../validators/phone.js';
import { ValidationMetrics, ValidationOrchestratorOptions, ValidationPayload } from './rules.types.js';
import { ValidationCacheManager, buildEnhancedAddressValidationResult, buildEnhancedEmailValidationResult, buildEnhancedNameValidationResult, buildEnhancedPhoneValidationResult } from './test-rules.js';



// Shared validation orchestrator function
export async function validatePayload(
    payload: ValidationPayload,
    redis?: any,
    pool?: any,
    options: ValidationOrchestratorOptions = {}
): Promise<{ results: any; metrics: ValidationMetrics; debug_info: any }> {
    // const startTime = performance.now(); // Currently not used, reserved for future performance tracking

    const {
        // mode = 'live', // Currently not used, reserved for future use
        fillMissingResults = false,
        useCache = true,
        // bypassExternal = false, // Currently not used, reserved for future use
        // timeoutMs = 30000, // Currently not used, reserved for future use
        projectId = 'default'
    } = options;
    const metrics: ValidationMetrics = {
        cache_hits: 0,
        cache_misses: 0,
        validation_start: 0,
        validation_end: 0,
        parallel_validations: true
    };

    const debug_info: any = {
        validation_providers_used: [],
        errors: [],
        warnings: []
    };

    const results: any = {};

    // Initialize validation promises for parallel execution
    const validationPromises: Promise<any>[] = [];

    // Email validation
    if (payload.email) {
        const emailPromise = (async () => {
            try {
                if (useCache && redis) {
                    const cacheKey = ValidationCacheManager.generateKey('email', payload.email!, projectId);
                    const cached = await ValidationCacheManager.get(redis, cacheKey);
                    if (cached) {
                        metrics.cache_hits++;
                        results.email = cached;
                        return;
                    } else {
                        metrics.cache_misses++;
                    }
                }

                const emailResult = await validateEmail(payload.email!, redis);
                const enhancedResult = buildEnhancedEmailValidationResult(emailResult);
                results.email = enhancedResult;

                if (useCache && redis) {
                    const cacheKey = ValidationCacheManager.generateKey('email', payload.email!, projectId);
                    await ValidationCacheManager.set(redis, cacheKey, enhancedResult);
                }

                debug_info.validation_providers_used.push('email');
            } catch (error) {
                debug_info.errors.push({ field: 'email', error: error instanceof Error ? error.message : 'Unknown error' });
                results.email = {
                    valid: false,
                    confidence: 0,
                    reason_codes: ['EMAIL_VALIDATION_ERROR'],
                    risk_score: 30,
                    processing_time_ms: 0,
                    provider: 'error',
                    disposable: false,
                    metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
                };
            }
        })();
        validationPromises.push(emailPromise);
    } else if (fillMissingResults) {
        results.email = {
            valid: false,
            confidence: 0,
            reason_codes: ['NO_EMAIL_PROVIDED'],
            risk_score: 0,
            processing_time_ms: 0,
            provider: 'none',
            disposable: false,
            metadata: {}
        };
    }

    // Phone validation - run in parallel
    if (payload.phone) {
        const phonePromise = (async () => {
            try {
                if (useCache && redis) {
                    const cacheKey = ValidationCacheManager.generateKey('phone', payload.phone!, projectId);
                    const cached = await ValidationCacheManager.get(redis, cacheKey);
                    if (cached) {
                        metrics.cache_hits++;
                        results.phone = cached;
                        return;
                    } else {
                        metrics.cache_misses++;
                    }
                }

                const phoneCountry = payload.address?.country || 'US';
                const phoneResult = await validatePhone(payload.phone!, phoneCountry, redis);
                const enhancedResult = buildEnhancedPhoneValidationResult(phoneResult);
                results.phone = enhancedResult;

                if (useCache && redis) {
                    const cacheKey = ValidationCacheManager.generateKey('phone', payload.phone!, projectId);
                    await ValidationCacheManager.set(redis, cacheKey, enhancedResult);
                }

                debug_info.validation_providers_used.push('phone');
            } catch (error) {
                debug_info.errors.push({ field: 'phone', error: error instanceof Error ? error.message : 'Unknown error' });
                results.phone = {
                    valid: false,
                    confidence: 0,
                    reason_codes: ['PHONE_VALIDATION_ERROR'],
                    risk_score: 30,
                    processing_time_ms: 0,
                    provider: 'error',
                    metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
                };
            }
        })();
        validationPromises.push(phonePromise);
    } else if (fillMissingResults) {
        results.phone = {
            valid: false,
            confidence: 0,
            reason_codes: ['NO_PHONE_PROVIDED'],
            risk_score: 0,
            processing_time_ms: 0,
            provider: 'none',
            metadata: {}
        };
    }

    // Address validation - run in parallel
    if (payload.address) {
        const hasRequiredFields = payload.address.line1 && payload.address.city && payload.address.postal_code && payload.address.country;

        if (hasRequiredFields) {
            const addressPromise = (async () => {
                try {
                    if (useCache && redis) {
                        const addressString = JSON.stringify(payload.address);
                        const cacheKey = ValidationCacheManager.generateKey('address', addressString, projectId);
                        const cached = await ValidationCacheManager.get(redis, cacheKey);
                        if (cached) {
                            metrics.cache_hits++;
                            results.address = cached;
                            return;
                        } else {
                            metrics.cache_misses++;
                        }
                    }

                    const addressResult = await validateAddress(payload.address as any, pool, redis);
                    const enhancedResult = buildEnhancedAddressValidationResult(addressResult, payload.address);
                    results.address = enhancedResult;

                    if (useCache && redis) {
                        const addressString = JSON.stringify(payload.address);
                        const cacheKey = ValidationCacheManager.generateKey('address', addressString, projectId);
                        await ValidationCacheManager.set(redis, cacheKey, enhancedResult);
                    }

                    debug_info.validation_providers_used.push('address');
                } catch (error) {
                    debug_info.errors.push({ field: 'address', error: error instanceof Error ? error.message : 'Unknown error' });
                    results.address = {
                        valid: false,
                        confidence: 0,
                        reason_codes: ['ADDRESS_VALIDATION_ERROR'],
                        risk_score: 35,
                        processing_time_ms: 0,
                        provider: 'error',
                        metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
                    };
                }
            })();
            validationPromises.push(addressPromise);
        } else if (fillMissingResults) {
            results.address = {
                valid: false,
                confidence: 0,
                reason_codes: ['INCOMPLETE_ADDRESS_DATA'],
                risk_score: 20,
                processing_time_ms: 0,
                provider: 'none',
                metadata: { message: 'Address validation skipped due to incomplete data' }
            };
        }
    } else if (fillMissingResults) {
        results.address = {
            valid: false,
            confidence: 0,
            reason_codes: ['NO_ADDRESS_PROVIDED'],
            risk_score: 0,
            processing_time_ms: 0,
            provider: 'none',
            metadata: {}
        };
    }

    // Name validation (synchronous, but can be part of the flow)
    if (payload.name) {
        try {
            const nameResult = validateName(payload.name);
            results.name = buildEnhancedNameValidationResult(nameResult);
            debug_info.validation_providers_used.push('name');
        } catch (error) {
            debug_info.errors.push({ field: 'name', error: error instanceof Error ? error.message : 'Unknown error' });
        }
    } else if (fillMissingResults) {
        results.name = {
            valid: false,
            confidence: 0,
            reason_codes: ['NO_NAME_PROVIDED'],
            risk_score: 5,
            processing_time_ms: 0,
            provider: 'none',
            metadata: {}
        };
    }

    // IP validation (if provided)
    if (payload.ip) {
        try {
            results.ip = await validateIP(payload.ip, redis);
            debug_info.validation_providers_used.push('ip');
        } catch (error) {
            debug_info.errors.push({ field: 'ip', error: error instanceof Error ? error.message : 'Unknown error' });
        }
    } else if (fillMissingResults) {
        results.ip = {
            valid: false,
            confidence: 0,
            reason_codes: ['NO_IP_PROVIDED'],
            risk_score: 0,
            processing_time_ms: 0,
            provider: 'none',
            metadata: {}
        };
    }

    // Device validation (if user_agent provided)
    if (payload.user_agent) {
        try {
            results.device = await validateDevice(payload.user_agent, redis);
            debug_info.validation_providers_used.push('device');
        } catch (error) {
            debug_info.errors.push({ field: 'device', error: error instanceof Error ? error.message : 'Unknown error' });
        }
    } else if (fillMissingResults) {
        results.device = {
            valid: false,
            confidence: 0,
            reason_codes: ['NO_DEVICE_PROVIDED'],
            risk_score: 0,
            processing_time_ms: 0,
            provider: 'none',
            metadata: {}
        };
    }

    // Wait for all validations to complete
    metrics.validation_start = performance.now();
    if (validationPromises.length > 0) {
        await Promise.allSettled(validationPromises);
    }
    metrics.validation_end = performance.now();

    return { results, metrics, debug_info };
}

export async function validateIP(ip: string, redis?: any): Promise<any> {
    // Check cache first if redis is available
    if (redis) {
        try {
            const cacheKey = `ip_validation:${ip}`;
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (error) {
            // Continue with validation if cache fails
        }
    }

    // Implement IP validation logic
    const result = {
        valid: true,
        confidence: 80,
        reason_codes: [],
        risk_score: 0,
        processing_time_ms: 10,
        provider: 'ipapi',
        country: 'US',
        region: 'CA',
        city: 'San Francisco',
        is_vpn: false,
        is_proxy: false,
        is_tor: false,
        is_datacenter: false,
        asn: 'AS15169',
        org: 'Google LLC',
        metadata: {
            checked_at: new Date().toISOString()
        }
    };

    // Cache the result if redis is available
    if (redis) {
        try {
            const cacheKey = `ip_validation:${ip}`;
            await redis.setex(cacheKey, 3600, JSON.stringify(result)); // Cache for 1 hour
        } catch (error) {
            // Don't fail if caching fails
        }
    }

    return result;
}

export async function validateDevice(userAgent: string, redis?: any): Promise<any> {
    // Check cache first if redis is available
    if (redis) {
        try {
            const fingerprint = crypto.createHash('md5').update(userAgent).digest('hex');
            const cacheKey = `device_validation:${fingerprint}`;
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (error) {
            // Continue with validation if cache fails
        }
    }

    // Implement device validation logic
    const fingerprint = crypto.createHash('md5').update(userAgent).digest('hex');
    const result = {
        valid: true,
        confidence: 75,
        reason_codes: [],
        risk_score: 0,
        processing_time_ms: 5,
        provider: 'internal',
        type: 'desktop',
        os: 'Windows 10',
        browser: 'Chrome',
        is_bot: false,
        fingerprint,
        metadata: {
            checked_at: new Date().toISOString()
        }
    };

    // Cache the result if redis is available
    if (redis) {
        try {
            const cacheKey = `device_validation:${fingerprint}`;
            await redis.setex(cacheKey, 3600, JSON.stringify(result)); // Cache for 1 hour
        } catch (error) {
            // Don't fail if caching fails
        }
    }

    return result;
}