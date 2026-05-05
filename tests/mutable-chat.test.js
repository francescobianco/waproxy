const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const mutableChat = require('../behaviours/mutable-chat');

// --- mocks ---

function makeChat() {
    const chat = new EventEmitter();
    chat.sendMessage = async (to, body) => ({ to, body });
    chat.getNumberId = async (to) => ({ _serialized: `${to}@c.us` });
    return chat;
}

function makeCron() {
    return { schedule() { return { destroy() {} }; } };
}

function makeWeb() {
    return { use() {} };
}

function makeDir(base) {
    return fs.mkdtempSync(path.join(base, 'case-'));
}

// Simula un messaggio WhatsApp in arrivo e attende la risposta
async function send(chat, from, body) {
    let replied = null;
    const msg = {
        from: `${from}@c.us`,
        body,
        reply: (text) => { replied = text; return Promise.resolve(text); }
    };
    chat.emit('message', msg);
    // dà tempo agli handler async di completare
    await new Promise(r => setImmediate(r));
    return { getReply: () => replied };
}

// --- suite ---

describe('mutable-chat comandi', () => {
    let base;

    before(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'waproxy-chat-')); });
    after(() => { fs.rmSync(base, { recursive: true, force: true }); });

    test('/behaviour list quando non ci sono behaviour', async () => {
        const dir = makeDir(base);
        const chat = makeChat();
        mutableChat(chat, makeWeb(), makeCron(), { dir });

        const r = await send(chat, '39300', '/behaviour list');
        assert.match(r.getReply(), /Nessun behaviour mutable/);
    });

    test('flusso completo create → codice → save attiva il behaviour', async () => {
        const dir = makeDir(base);
        const chat = makeChat();
        mutableChat(chat, makeWeb(), makeCron(), { dir });

        const admin = '39300';
        const code = `module.exports = function(chat) {
            chat.on('message', msg => { if (msg.body === 'hi') msg.reply('hello'); });
        };`;

        await send(chat, admin, '/behaviour create greet');
        await send(chat, admin, code);
        const r = await send(chat, admin, '/behaviour save');

        assert.match(r.getReply(), /greet/);
        assert.match(r.getReply(), /salvato/);

        // il behaviour è ora attivo: verifica che risponda
        let replied = null;
        chat.emit('message', { from: `${admin}@c.us`, body: 'hi', reply: t => { replied = t; } });
        await new Promise(r => setImmediate(r));
        assert.equal(replied, 'hello');
    });

    test('/behaviour list mostra i behaviour salvati', async () => {
        const dir = makeDir(base);
        const chat = makeChat();
        mutableChat(chat, makeWeb(), makeCron(), { dir });

        const admin = '39301';
        await send(chat, admin, '/behaviour create listed');
        await send(chat, admin, 'module.exports = function() {};');
        await send(chat, admin, '/behaviour save');

        const r = await send(chat, admin, '/behaviour list');
        assert.match(r.getReply(), /listed/);
    });

    test('/behaviour show restituisce il sorgente', async () => {
        const dir = makeDir(base);
        const chat = makeChat();
        mutableChat(chat, makeWeb(), makeCron(), { dir });

        const admin = '39302';
        await send(chat, admin, '/behaviour create showme');
        await send(chat, admin, '/* unique-source-marker */\nmodule.exports = function() {};');
        await send(chat, admin, '/behaviour save');

        const r = await send(chat, admin, '/behaviour show showme');
        assert.ok(r.getReply().includes('unique-source-marker'));
    });

    test('/behaviour delete rimuove il behaviour e i suoi listener', async () => {
        const dir = makeDir(base);
        const chat = makeChat();
        mutableChat(chat, makeWeb(), makeCron(), { dir });

        const admin = '39303';
        await send(chat, admin, '/behaviour create todelete');
        await send(chat, admin, `module.exports = function(chat) { chat.on('message', () => {}); };`);
        await send(chat, admin, '/behaviour save');
        assert.equal(chat.listenerCount('message'), 2, 'mutable-chat + todelete');

        await send(chat, admin, '/behaviour delete todelete');
        assert.equal(chat.listenerCount('message'), 1, 'rimane solo mutable-chat');
    });

    test('/behaviour cancel annulla la sessione in corso', async () => {
        const dir = makeDir(base);
        const chat = makeChat();
        mutableChat(chat, makeWeb(), makeCron(), { dir });

        const admin = '39304';
        await send(chat, admin, '/behaviour create willcancel');
        await send(chat, admin, '/behaviour cancel');

        const r = await send(chat, admin, '/behaviour save');
        assert.match(r.getReply(), /Nessun codice in attesa/);
    });

    test('/behaviour reload rileva cambiamenti e aggiorna', async () => {
        const dir = makeDir(base);
        const chat = makeChat();
        mutableChat(chat, makeWeb(), makeCron(), { dir });

        const admin = '39305';

        // Salva v1 — risponde solo al trigger 'check', non a ogni messaggio
        await send(chat, admin, '/behaviour create reloadme');
        await send(chat, admin, `module.exports = function(chat) { chat.on('message', msg => { if (msg.body === 'check') msg.reply('v1'); }); };`);
        await send(chat, admin, '/behaviour save');

        // Modifica il file direttamente su disco (simula edit esterno)
        fs.writeFileSync(
            path.join(dir, 'reloadme.js'),
            `module.exports = function(chat) { chat.on('message', msg => { if (msg.body === 'check') msg.reply('v2'); }); };`
        );

        const r = await send(chat, admin, '/behaviour reload');
        assert.match(r.getReply(), /reloadme/);

        // Verifica che il behaviour aggiornato risponda con v2
        let replied = null;
        chat.emit('message', { from: `${admin}@c.us`, body: 'check', reply: t => { replied = t; } });
        await new Promise(r => setImmediate(r));
        assert.equal(replied, 'v2');
    });

    test('comando sconosciuto mostra l\'help', async () => {
        const dir = makeDir(base);
        const chat = makeChat();
        mutableChat(chat, makeWeb(), makeCron(), { dir });

        const r = await send(chat, '39306', '/behaviour unknown');
        assert.match(r.getReply(), /Comandi:/);
    });

    test('messaggi da non-admin vengono ignorati', async () => {
        const dir = makeDir(base);
        const chat = makeChat();
        mutableChat(chat, makeWeb(), makeCron(), { dir, admin: ['39399'] });

        const r = await send(chat, '39000', '/behaviour list');
        assert.equal(r.getReply(), null, 'nessuna risposta a mittente non autorizzato');
    });

    test('admin whitelist vuota accetta tutti (modalità dev)', async () => {
        const dir = makeDir(base);
        const chat = makeChat();
        mutableChat(chat, makeWeb(), makeCron(), { dir, admin: [] });

        const r = await send(chat, '39000', '/behaviour list');
        assert.match(r.getReply(), /Nessun behaviour mutable/);
    });
});
