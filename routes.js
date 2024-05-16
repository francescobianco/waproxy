const wbm = require("wbm");

async function routes (fastify, options) {
    const collection = fastify.mongo.db.collection('test_collection')

    fastify.get('/', async (request, reply) => {
        return { hello: 'world' }
    })

    fastify.get('/send', async (request, reply) => {
        const phones = ['393200466987'];
        const message = 'Good Morning.';
        await wbm.send(phones, message);

        return { hello: 'world' }
    })
}

module.exports = routes
