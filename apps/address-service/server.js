const fastify = require('fastify')({
    logger: true,
    disableRequestLogging: false
});
const postal = require('node-postal');

// Health check
fastify.get('/health', async (request, reply) => {
    return { status: 'ok', uptime: process.uptime() };
});

// Expand endpoint
fastify.post('/expand', async (request, reply) => {
    const { address } = request.body || {};
    if (!address) {
        request.log.warn('Expand request missing address');
        return reply.code(400).send({ error: 'Address required' });
    }

    try {
        const results = postal.parser.expand_address(address);
        return { results };
    } catch (err) {
        request.log.error(err, 'Error expanding address');
        return reply.code(500).send({ error: 'Internal server error processing address' });
    }
});

// Parse endpoint
fastify.post('/parse', async (request, reply) => {
    const { address } = request.body || {};
    if (!address) {
        request.log.warn('Parse request missing address');
        return reply.code(400).send({ error: 'Address required' });
    }

    try {
        // Transform array to object for easier consumption
        const raw = postal.parser.parse_address(address);
        const result = {};

        if (Array.isArray(raw)) {
            raw.forEach(item => {
                result[item.component] = item.value;
            });
        }

        return result;
    } catch (err) {
        request.log.error(err, 'Error parsing address');
        return reply.code(500).send({ error: 'Internal server error processing address' });
    }
});

const start = async () => {
    try {
        const port = process.env.PORT || 3000;
        const host = '0.0.0.0';
        await fastify.listen({ port, host });
        console.log(`Address service listening on ${host}:${port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();