import validator from 'validator';

/**
 * Sanitizes user input strings to prevent XSS and injection attacks
 */
export class InputSanitizer {
    /**
     * Sanitizes string input by trimming whitespace and escaping HTML
     */
    static sanitizeString(input: string): string {
        if (!input || typeof input !== 'string') {
            return '';
        }
        return validator.escape(input.trim());
    }

    /**
     * Sanitizes email input by validating format and escaping
     */
    static sanitizeEmail(email: string): string {
        if (!email || typeof email !== 'string') {
            return '';
        }
        const trimmed = email.trim();
        if (!validator.isEmail(trimmed)) {
            return '';
        }
        return validator.escape(trimmed);
    }

    /**
     * Sanitizes phone number input
     */
    static sanitizePhone(phone: string): string {
        if (!phone || typeof phone !== 'string') {
            return '';
        }
        // Remove all non-numeric characters except +, -, (, ), space
        return phone.replace(/[^+\d\s\-\(\)]/g, '').trim();
    }

    /**
     * Sanitizes name input - allows letters, spaces, hyphens, apostrophes, dots
     */
    static sanitizeName(name: string): string {
        if (!name || typeof name !== 'string') {
            return '';
        }
        const trimmed = name.trim();
        // Allow only letters, spaces, hyphens, apostrophes, dots
        const sanitized = trimmed.replace(/[^a-zA-Z\s\-'\.]/g, '');
        return validator.escape(sanitized);
    }

    /**
     * Sanitizes address input - allows common address characters
     */
    static sanitizeAddress(address: string): string {
        if (!address || typeof address !== 'string') {
            return '';
        }
        const trimmed = address.trim();
        // Allow letters, numbers, spaces, commas, periods, hyphens, slashes, parentheses
        const sanitized = trimmed.replace(/[^a-zA-Z0-9\s,\.\-\(\)\/]/g, '');
        return validator.escape(sanitized);
    }

    /**
     * Sanitizes postal code input
     */
    static sanitizePostalCode(postalCode: string): string {
        if (!postalCode || typeof postalCode !== 'string') {
            return '';
        }
        // Allow letters, numbers, spaces, hyphens
        return postalCode.replace(/[^a-zA-Z0-9\s\-]/g, '').trim();
    }

    /**
     * Sanitizes tax ID input - allows alphanumeric characters
     */
    static sanitizeTaxId(taxId: string): string {
        if (!taxId || typeof taxId !== 'string') {
            return '';
        }
        // Allow alphanumeric characters, hyphens, slashes, dots
        return taxId.replace(/[^a-zA-Z0-9\-\.\/]/g, '').trim();
    }

    /**
     * Sanitizes URL input
     */
static sanitizeUrl(url: string): string {
    if (!url || typeof url !== 'string') {
        return '';
    }

    const trimmed = url.trim();

    if (!validator.isURL(trimmed, {
        require_protocol: false,
        require_tld: false // This is the key change to allow 'localhost'
    })) {
        return '';
    }

    return trimmed; // Don't escape URLs to preserve special characters
}

    /**
     * Sanitizes generic text input by escaping HTML
     */
    static sanitizeText(text: string): string {
        if (!text || typeof text !== 'string') {
            return '';
        }
        return validator.escape(text.trim());
    }

    /**
     * Recursively sanitizes object properties
     */
    static sanitizeObject(obj: any): any {
        if (obj === null || obj === undefined) {
            return obj;
        }

        if (typeof obj === 'string') {
            return this.sanitizeText(obj);
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.sanitizeObject(item));
        }

        if (typeof obj === 'object') {
            const sanitized: any = {};
            for (const [key, value] of Object.entries(obj)) {
                // Sanitize keys too
                const sanitizedKey = key.replace(/[^a-zA-Z0-9_]/g, '');
                sanitized[sanitizedKey] = this.sanitizeObject(value);
            }
            return sanitized;
        }

        return obj;
    }

    /**
     * Sanitizes password input - preserves special characters needed for strong passwords
     */
    static sanitizePassword(password: string): string {
        if (typeof password !== 'string') {
            return '';
        }
        // Do not sanitize passwords - they may contain special characters
        // Just trim whitespace
        return password.trim();
    }
}