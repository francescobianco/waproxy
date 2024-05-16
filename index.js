
const wbm = require('wbm');
const fastify = require('fastify')({
    logger: true
})

fastify.decorate('wbm', wbm);
fastify.register(require('./routes'))

wbm.start().then(async () => {

    fastify.listen({ port: 3000, host: '0.0.0.0' }, function (err, address) {
        if (err) {
            fastify.log.error(err)
            process.exit(1)
        }

        fastify.log.info(`Server listening on ${address}`)
    })






}).catch(err => console.log(err));
