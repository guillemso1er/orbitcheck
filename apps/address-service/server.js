const fastify = require('fastify')({ logger: true });
const postal = require('node-postal');

// Expand endpoint
fastify.post('/expand', async (request, reply) => {
    const { address } = request.body;
    if (!address) return reply.code(400).send({ error: 'Address required' });
    return postal.parser.expand_address(address);
});

// Parse endpoint
fastify.post('/parse', async (request, reply) => {
    const { address } = request.body;
    if (!address) return reply.code(400).send({ error: 'Address required' });

    // Transform array to object for easier consumption
    const raw = postal.parser.parse_address(address);
    const result = {};
    raw.forEach(item => {
        result[item.component] = item.value;
    });
    return result;
});

const start = async () => {
    try {
        await fastify.listen({ port: 3000, host: '0.0.0.0' });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();