const wwebVersion = '2.2412.54';
const qrcode = require("qrcode-terminal");
const cron = require('node-cron');
const { Client, LocalAuth } = require('whatsapp-web.js');
const chat = new Client({
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
const web = express()
const auth = require('express-basic-auth')
const WAPROXY_PASSWORD = process.env.WAPROXY_PASSWORD || 'wa'
const behaviours = require('./behaviours');

let isReady = false;

//web.use(express.urlencoded({ extended: true }));
web.use(express.raw({ type: "*/*" }))

web.use((req, res, next) => {
    if (isReady) {
        next();
    } else {
        res.status(503).send('<h1>WAProxy</h1><p>Please consult the logs to proceed with the configuration.</p>');
    }
});

function bootstrap(chat, web) {
    web.use(auth({
        users: { 'wa': WAPROXY_PASSWORD },
    }))
}

chat.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('WAPROXY_PASSWORD:', WAPROXY_PASSWORD)
});

chat.on('ready', () => {
    bootstrap(chat, web)
    behaviours(chat, web)
    isReady = true
    console.log('WAProxy is ready!')
});

web.listen(3025)

chat.initialize();
