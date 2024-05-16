
const wbm = require('wbm');
const express = require('express')
const app = express()

app.post('/send', async (req, res) => {
    const phones = ['393200466987'];
    const message = 'Good Morning.';
    await fastify.wbm.send(phones, message);

    res.send('hello world')
})

app.listen(3000)

/*
wbm.start().then(async () => {
    fastify.listen({ port: 3000, host: '0.0.0.0' }, function (err, address) {
        if (err) {
            fastify.log.error(err)
            process.exit(1)
        }
        fastify.log.info(`Server listening on ${address}`)
    })
}).catch(err => console.log(err));
*/