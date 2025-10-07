import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';
import { performance } from 'perf_hooks';
import v8 from 'v8';

const expectedArity: Record<string, number> = {
    onRequest: 3,           // (req, reply, done)
    preParsing: 4,          // (req, reply, payload, done)
    preValidation: 3,       // (req, reply, done)
    preHandler: 3,          // (req, reply, done)
    preSerialization: 4,    // (req, reply, payload, done)
    onSend: 4,              // (req, reply, payload, done)
    onResponse: 3,          // (req, reply, done)
    onError: 4              // (req, reply, error, done)
};

// Blocking operations to detect
const BLOCKING_PATTERNS = [
    'readFileSync', 'writeFileSync', 'appendFileSync', 'accessSync', 'statSync',
    'mkdirSync', 'rmdirSync', 'readdirSync', 'unlinkSync', 'existsSync',
    'execSync', 'spawnSync', 'pbkdf2Sync', 'randomFillSync', 'scryptSync',
    'generateKeyPairSync', 'generateKeySync', 'createCipheriv', 'createDecipheriv'
];

// Get detailed stack trace info
function getStackInfo(depth: number = 3): string {
    const oldLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = depth + 5;
    const stack = new Error().stack || '';
    Error.stackTraceLimit = oldLimit;

    const lines = stack.split('\n').slice(2); // Skip Error and current function
    const relevantLines = lines
        .filter(line => !line.includes('node_modules') && !line.includes('node:internal'))
        .slice(0, depth)
        .map(line => line.trim());

    return relevantLines.join('\n    ');
}

function isAsync(func: Function): boolean {
    return func && func.constructor && func.constructor.name === 'AsyncFunction';
}

function isPromise(obj: any): boolean {
    return obj && typeof obj.then === 'function';
}

// Detect blocking operations in function source
function detectBlockingOperations(func: Function): string[] {
    const source = func.toString();
    const found: string[] = [];

    for (const pattern of BLOCKING_PATTERNS) {
        if (source.includes(pattern)) {
            found.push(pattern);
        }
    }

    // Check for obvious infinite loops
    if (/while\s*\(\s*true\s*\)/.test(source) || /for\s*\(\s*;\s*;\s*\)/.test(source)) {
        found.push('potential infinite loop');
    }

    // Check for blocking regex patterns
    if (/\/[^\n\r(\u2028\u2029]*\([^\n\r)\u2028\u2029]*(?:\)[^\n\r(\u2028\u2029]*\([^\n\r)\u2028\u2029]*)*(?:[\n\r\u2028\u2029][^)]*)?\+\)[^)]*\)\+.*/.test(source)) {
        found.push('potentially catastrophic regex backtracking');
    }

    return found;
}

// Check for missing await on async operations
function detectMissingAwait(func: Function): string[] {
    const source = func.toString();
    const issues: string[] = [];

    // Common async patterns that should be awaited
    const asyncPatterns = [
        { pattern: /\.save\(/g, name: 'save()' },
        { pattern: /\.find[A-Z]?\w*\(/g, name: 'database query' },
        { pattern: /\.create\(/g, name: 'create()' },
        { pattern: /\.update\(/g, name: 'update()' },
        { pattern: /\.delete\(/g, name: 'delete()' },
        { pattern: /fetch\(/g, name: 'fetch()' },
        { pattern: /axios\./g, name: 'axios call' }
    ];



    for (const { pattern, name } of asyncPatterns) {
        const matches = source.match(pattern);
        if (matches) {
            // Check if these are preceded by await
            matches.forEach(match => {
                const awaitPattern = new RegExp(`await\\s+[^;]*${match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
                if (!awaitPattern.test(source)) {
                    issues.push(`potentially missing await for ${name}`);
                }
            });
        }
    }

    return issues;
}

// Wrap handler with monitoring
function wrapHandler(name: string, handler: Function, location: string): Function {
    const isAsyncHandler = isAsync(handler);
    const blockingOps = detectBlockingOperations(handler);
    const missingAwaits = isAsyncHandler ? detectMissingAwait(handler) : [];

    // Warn about detected issues
    if (blockingOps.length > 0) {
        console.warn(`⚠️  [startup-guard] Potential blocking operations in ${name} handler "${handler.name || '<anonymous>'}":`);
        console.warn(`    Location: ${location}`);
        console.warn(`    Detected: ${blockingOps.join(', ')}`);
    }

    if (missingAwaits.length > 0) {
        console.warn(`⚠️  [startup-guard] Potential missing awaits in ${name} handler "${handler.name || '<anonymous>'}":`);
        console.warn(`    Location: ${location}`);
        console.warn(`    Issues: ${missingAwaits.join(', ')}`);
    }

    // Return wrapped handler with runtime monitoring
    if (isAsyncHandler) {
        return async function (this: any, ...args: any[]) {
            const start = performance.now();
            const timeout = setTimeout(() => {
                const duration = performance.now() - start;
                console.error(`❌ [startup-guard] Handler timeout in ${name} "${handler.name || '<anonymous>'}":`);
                console.error(`    Duration: ${duration.toFixed(2)}ms`);
                console.error(`    Location: ${location}`);
                console.error(`    Stack: ${getStackInfo(5)}`);
            }, 5000); // Warn after 5 seconds

            try {
                const result = await handler.apply(this, args);
                clearTimeout(timeout);

                // Check if result is a hanging promise
                if (isPromise(result)) {
                    console.warn(`⚠️  [startup-guard] Handler returned unresolved promise in ${name}:`, location);
                }

                return result;
            } catch (error) {
                clearTimeout(timeout);
                throw error;
            }
        };
    } else {
        // For sync handlers with done callback
        return function (this: any, ...args: any[]) {
            let doneCalled = false;
            const originalDone = args[args.length - 1];

            if (typeof originalDone === 'function') {
                // Wrap the done callback
                args[args.length - 1] = function (this: any, ...doneArgs: any[]) {
                    if (doneCalled) {
                        console.error(`❌ [startup-guard] done() called multiple times in ${name}:`, location);
                        return;
                    }
                    doneCalled = true;
                    return originalDone.apply(this, doneArgs);
                };

                // Set timeout for done callback
                setTimeout(() => {
                    if (!doneCalled) {
                        console.error(`❌ [startup-guard] done() never called in ${name}:`, location);
                    }
                }, 5000);
            }

            return handler.apply(this, args);
        };
    }
}

function checkOne(name: keyof typeof expectedArity, func: any, location?: string): any {
    if (typeof func !== 'function') return func;

    const loc = location || getStackInfo(3);
    const need = expectedArity[name];

    // Check handler signature
    if (!isAsync(func) && func.length < need) {
        const label = func.name || '<anonymous>';
        throw new Error(
            `[startup-guard] ${name} handler "${label}" appears synchronous but does not accept "done" (arity ${func.length} < ${need}).\n` +
            `    Mark it "async" or include the "done" callback.\n` +
            `    Location: ${loc}`
        );
    }

    // Return wrapped handler with monitoring
    return wrapHandler(name, func, loc);
}

function checkMany(name: keyof typeof expectedArity, handlers: any, location?: string): any {
    if (!handlers) return handlers;
    const loc = location || getStackInfo(3);

    if (Array.isArray(handlers)) {
        return handlers.map(h => checkOne(name, h, loc));
    } else {
        return checkOne(name, handlers, loc);
    }
}

// Event loop monitoring
function setupEventLoopMonitoring(app: FastifyInstance) {
    let lastCheck = Date.now();
    const threshold = 50; // ms

    const checkEventLoop = () => {
        const now = Date.now();
        const delta = now - lastCheck - 100; // We check every 100ms

        if (delta > threshold) {
            console.warn(`⚠️  [startup-guard] Event loop blocked for ${delta}ms`);
            console.warn(`    Stack: ${getStackInfo(10)}`);
        }

        lastCheck = now;
        // Store the timeout ID and return it
        return setTimeout(checkEventLoop, 100).unref();
    };

    // Start the loop and return the initial timeout ID
    return setTimeout(checkEventLoop, 100).unref();
}

// Memory monitoring
function setupMemoryMonitoring(app: FastifyInstance) {
    const checkMemory = () => {
        const heap = v8.getHeapStatistics();
        const heapUsedMB = heap.used_heap_size / 1024 / 1024;
        const heapLimitMB = heap.heap_size_limit / 1024 / 1024;

        if (heapUsedMB > heapLimitMB * 0.9) {
            console.error(`❌ [startup-guard] Memory usage critical: ${heapUsedMB.toFixed(2)}MB / ${heapLimitMB.toFixed(2)}MB`);
        }
        // Store the timeout ID and return it
        return setTimeout(checkMemory, 5000).unref();
    };

    // Start the loop and return the initial timeout ID
    return setTimeout(checkMemory, 5000).unref();
}

export default fp(async (app: FastifyInstance) => {
    console.log('🛡️  [startup-guard] Initializing API guards...');

    let eventLoopTimeoutId: NodeJS.Timeout;
    let memoryTimeoutId: NodeJS.Timeout;

    eventLoopTimeoutId = setupEventLoopMonitoring(app);
    memoryTimeoutId = setupMemoryMonitoring(app);

    // *** CHANGE: Add an onClose hook to clear the timers ***
    app.addHook('onClose', async () => {
        console.log('🛡️  [startup-guard] Shutting down monitoring...');
        clearTimeout(eventLoopTimeoutId);
        clearTimeout(memoryTimeoutId);
    });

    // Setup monitoring
    setupEventLoopMonitoring(app);
    setupMemoryMonitoring(app);

    // Guard global hooks
    const origAddHook = app.addHook.bind(app);
    (app as any).addHook = (name: string, handler: any) => {
        if (name in expectedArity) {
            const location = getStackInfo(3);
            handler = checkOne(name as any, handler, location);
        }
        return origAddHook(name as any, handler);
    };

    // Guard route-level hooks and handlers
    app.addHook('onRoute', (route: RouteOptions) => {
        const routeInfo = `${route.method} ${route.url}`;
        const location = getStackInfo(5);

        // Check route handler
        if (typeof route.handler === 'function') {
            const blockingOps = detectBlockingOperations(route.handler);
            const missingAwaits = isAsync(route.handler) ? detectMissingAwait(route.handler) : [];

            if (blockingOps.length > 0 || missingAwaits.length > 0) {
                console.warn(`⚠️  [startup-guard] Issues detected in route ${routeInfo}:`);
                console.warn(`    Location: ${location}`);
                if (blockingOps.length > 0) {
                    console.warn(`    Blocking: ${blockingOps.join(', ')}`);
                }
                if (missingAwaits.length > 0) {
                    console.warn(`    Missing awaits: ${missingAwaits.join(', ')}`);
                }
            }

            // Wrap the handler
            (route as any).handler = wrapHandler(`route ${routeInfo}`, route.handler, location);
        }

        // Check lifecycle hooks
        for (const n of ([
            'onRequest', 'preParsing', 'preValidation', 'preHandler',
            'preSerialization', 'onSend', 'onResponse', 'onError'
        ] as const)) {
            if ((route as any)[n]) {
                (route as any)[n] = checkMany(n, (route as any)[n], location);
            }
        }
    });

    // Add request timeout monitoring
    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        const timeout = setTimeout(() => {
            console.error(`❌ [startup-guard] Request timeout: ${request.method} ${request.url}`);
            console.error(`    ID: ${request.id}`);
            console.error(`    Headers: ${JSON.stringify(request.headers)}`);
        }, 30000); // 30 second timeout

        reply.raw.on('finish', () => clearTimeout(timeout));
    });

    // Monitor unhandled rejections
    process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ [startup-guard] Unhandled Promise Rejection:', reason);
        console.error('    Stack:', getStackInfo(10));
    });

    console.log('✅ [startup-guard] API guards activated');
}, {
    name: 'startup-guard',
    dependencies: []
});