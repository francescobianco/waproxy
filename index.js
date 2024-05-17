
const wbm = require('wbm');
const express = require('express')
const app = express()

app.use(express.urlencoded({ extended: true }));

app.post('/send', async (req, res) => {
    const phones = [ req.body.to ];
    const message = req.body.message;

    await wbm.send(phones, message);

    res.send('Ok!'+"\n")
})

wbm.start().then(async () => {
    app.listen(3000)
}).catch(err => console.log(err));
