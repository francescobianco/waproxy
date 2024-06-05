const wwebVersion = '2.2412.54';
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require('whatsapp-web.js');
const client = new Client({
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    },
    // locking the wweb version
    webVersionCache: {
        type: 'remote',
        remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${wwebVersion}.html`,
    },
    authStrategy: new LocalAuth({
        dataPath: process.env.WAPROXY_DATA_DIR,
    })
});
const express = require('express')
const app = express()
const auth = require('express-basic-auth')

app.use(auth({
    users: { 'wa': process.env.WAPROXY_PASSWORD || 'wa' },
}))

//app.use(express.urlencoded({ extended: true }));
app.use(express.raw({ type: "*/*" }))

app.post('/send', async (req, res) => {
    const chat = req.query.to;
    const message = String(req.body);



    console.log("params", req.params)   ;
    console.log("body", req.body)   ;
    console.log("message", message)   ;

    try {
        const numberId = await client.getNumberId(chat);
        console.log("CONTACT ID", numberId._serialized)
        const sendMessage = await client.sendMessage(numberId._serialized, message);
        console.log("SENT", sendMessage)
    } catch (error) {
        console.log("ERROR", error)
    }
    res.send('Ok!'+"\n")
})

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
});

client.on('message', msg => {
    if (msg.body == '!ping') {
        msg.reply('pong');
    }
});

client.on('ready', () => {
    console.log('Client is ready!');
    app.listen(3000)
});

client.initialize();


