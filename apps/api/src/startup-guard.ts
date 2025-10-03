import type { FastifyInstance, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';

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

function isAsync(function_: Function) {
    return function_ && function_.constructor && function_.constructor.name === 'AsyncFunction';
}

function checkOne(name: keyof typeof expectedArity, function_: any) {
    if (typeof function_ !== 'function') return;
    const need = expectedArity[name];
    // Valid if async OR accepts the done callback (arity >= need)
    if (!isAsync(function_) && function_.length < need) {
        const label = function_.name || '<anonymous>';
        throw new Error(
            `[startup-guard] ${name} handler "${label}" appears synchronous but does not accept "done" (arity ${function_.length} < ${need}). ` +
            `Mark it "async" or include the "done" callback.`
        );
    }
}

function checkMany(name: keyof typeof expectedArity, handlers: any) {
    if (!handlers) return;
    if (Array.isArray(handlers)) for (const h of handlers) checkOne(name, h);
    else checkOne(name, handlers);
}

export default fp(async (app: FastifyInstance) => {
    // Guard global hooks
    const origAddHook = app.addHook.bind(app);
    (app as any).addHook = ((name: string, handler: any) => {
        if (name in expectedArity) checkOne(name as any, handler);
        return origAddHook(name as any, handler);
    }) as any;

    // Guard route-level hooks
    app.addHook('onRoute', (route: RouteOptions) => {
        for (const n of ([
            'onRequest', 'preParsing', 'preValidation', 'preHandler',
            'preSerialization', 'onSend', 'onResponse', 'onError'
        ] as const)) {
            checkMany(n, (route as any)[n]);
        }
    });
});