/**
 * Options for the fetchWithRetry function.
 */
export interface FetchWithRetryOptions extends RequestInit {
    /**
     * Number of retry attempts.
     * Set to `Infinity` for background tasks waiting for a service to come up.
     * Default: 3
     */
    retries?: number;

    /**
     * Initial delay in milliseconds.
     * Default: 1000
     */
    retryDelay?: number;

    /**
     * Maximum delay in milliseconds. 
     * Prevents exponential backoff from becoming too long.
     * Default: 30000 (30 seconds)
     */
    maxRetryDelay?: number;

    /**
     * HTTP status codes that trigger a retry.
     * Default: [408, 429, 500, 502, 503, 504]
     */
    retryOn?: number[];

    /**
     * Timeout in milliseconds for EACH individual attempt.
     * Default: 10000 (10 seconds)
     */
    timeout?: number;

    /**
     * Custom callback to determine if a retry should occur.
     * Returns true to retry, false to stop.
     * Overrides 'retryOn' logic if provided.
     */
    shouldRetry?: (response: Response | null, error: unknown, attempt: number) => boolean | Promise<boolean>;

    /**
     * Callback executed before a retry happens.
     * Useful for logging or metrics.
     */
    onRetry?: (attempt: number, error: unknown, response: Response | null, delay: number) => void;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_MAX_RETRY_DELAY = 30000;
const DEFAULT_RETRY_ON = [408, 429, 500, 502, 503, 504];
const DEFAULT_TIMEOUT = 10000;

/**
 * Enhanced fetch with exponential backoff, jitter, Retry-After support,
 * timeouts, infinite retry safety, and abort signal handling.
 */
export async function fetchWithRetry(
    input: string | URL | Request,
    options: FetchWithRetryOptions = {}
): Promise<Response> {
    const {
        retries = DEFAULT_RETRIES,
        retryDelay = DEFAULT_RETRY_DELAY,
        maxRetryDelay = DEFAULT_MAX_RETRY_DELAY,
        retryOn = DEFAULT_RETRY_ON,
        timeout = DEFAULT_TIMEOUT,
        onRetry,
        shouldRetry,
        signal,
        ...fetchOptions
    } = options;

    let attempt = 0;

    // Validation: Cannot retry if the request body is a one-time stream
    if (input instanceof Request && input.bodyUsed) {
        throw new Error("Cannot retry a Request with a body that has already been used.");
    }

    const checkShouldRetry = async (res: Response | null, err: unknown): Promise<boolean> => {
        // If retries is strict number and we hit it, stop. 
        // If retries is Infinity, this check is always false (good).
        if (attempt >= retries) return false;

        if (shouldRetry) {
            return shouldRetry(res, err, attempt);
        }

        // Default Logic
        if (err) return true; // Always retry network errors (unless max retries reached)
        if (res && retryOn.includes(res.status)) return true;

        return false;
    };

    while (true) {
        let currentResponse: Response | null = null;
        let currentError: unknown = null;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        try {
            // 1. Prepare Input (Clone Request if needed)
            let fetchInput = input;
            if (input instanceof Request) {
                fetchInput = input.clone();
            }

            // 2. Handle Timeout & Signals
            const controller = new AbortController();

            // Link user signal to internal controller
            if (signal) {
                if (signal.aborted) throw signal.reason;
                signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
            }

            // Set per-attempt timeout
            timeoutId = setTimeout(() => controller.abort(new Error('Request timed out')), timeout);

            // 3. Execute Fetch
            currentResponse = await fetch(fetchInput, {
                ...fetchOptions,
                signal: controller.signal,
            });

        } catch (error: unknown) {
            currentError = error;
            // If user intentionally aborted, stop immediately.
            if (signal?.aborted && error === signal.reason) {
                throw error;
            }
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }

        // 4. Determine if we should retry
        const shouldAttemptRetry = await checkShouldRetry(currentResponse, currentError);

        if (!shouldAttemptRetry) {
            if (currentError) throw currentError;
            return currentResponse!;
        }

        // 5. Calculate Delay
        // Formula: Initial * 2^attempt * Jitter
        let delay = retryDelay * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);

        // Cap the delay at maxRetryDelay to prevent waiting years
        delay = Math.min(delay, maxRetryDelay);

        // 6. Handle "Retry-After" header (Overrides calculation)
        if (currentResponse) {
            const retryAfter = currentResponse.headers.get('Retry-After');
            if (retryAfter) {
                if (/^\d+$/.test(retryAfter)) {
                    // Integer: Seconds
                    delay = parseInt(retryAfter, 10) * 1000;
                } else {
                    // String: HTTP-date
                    const date = Date.parse(retryAfter);
                    if (!isNaN(date)) {
                        delay = date - Date.now();
                    }
                }
                // Ensure non-negative
                delay = Math.max(0, delay);
            }
        }

        attempt++;

        // 7. Trigger Hook / Log
        if (onRetry) {
            onRetry(attempt, currentError, currentResponse, delay);
        } else {
            const reason = currentError
                ? (currentError instanceof Error ? currentError.message : String(currentError))
                : `Status ${currentResponse?.status}`;
            console.warn(`[fetchWithRetry] Attempt ${attempt}/${retries === Infinity ? '∞' : retries} failed (${reason}). Retrying in ${Math.round(delay)}ms...`);
        }

        // 8. Wait for delay (Abort-aware)
        await new Promise<void>((resolve, reject) => {
            if (signal?.aborted) return reject(signal.reason);

            const timer = setTimeout(() => {
                cleanup();
                resolve();
            }, delay);

            const onAbort = () => {
                clearTimeout(timer);
                cleanup();
                reject(signal!.reason);
            };

            const cleanup = () => {
                signal?.removeEventListener('abort', onAbort);
            };

            signal?.addEventListener('abort', onAbort, { once: true });
        });
    }
}