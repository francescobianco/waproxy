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
const WAPROXY_PASSWORD = process.env.WAPROXY_PASSWORD || 'wa'
const behaviours = require('./behaviours');

let isReady = false;

//app.use(express.urlencoded({ extended: true }));
app.use(express.raw({ type: "*/*" }))

app.use((req, res, next) => {
    if (isReady) {
        next();
    } else {
        res.status(503).send('<h1>WAProxy</h1><p>Please consult the logs to proceed with the configuration.</p>');
    }
});

function bootstrap() {
    app.use(auth({
        users: { 'wa': WAPROXY_PASSWORD },
    }))

    app.post('/send', async (req, res) => {
        const chat = req.query.to;
        const message = String(req.body);
        try {
            const numberId = await client.getNumberId(chat);
            const sendMessage = await client.sendMessage(numberId._serialized, message);
            console.log("SENT", sendMessage)
        } catch (error) {
            console.log("ERROR", error)
        }
        res.send('Ok!'+"\n")
    })

    client.on('message', msg => {
        if (msg.body === '/ping') {
            msg.reply('pong');
        }
    });
}

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('WAPROXY_PASSWORD:', WAPROXY_PASSWORD);
});

client.on('ready', () => {
    bootstrap()
    //behaviours(client, app);
    isReady = true;
    console.log('WAProxy is ready!');
    console.log('WAPROXY_PASSWORD:', WAPROXY_PASSWORD);
});

app.listen(3025)

client.initialize();
