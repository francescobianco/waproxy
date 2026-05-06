const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const BehaviourManager = require('../behaviours/mutable-manager');

// --- mocks ---

function makeChat() {
    const chat = new EventEmitter();
    chat.sendMessage = async (to, body) => ({ to, body });
    chat.getNumberId = async (to) => ({ _serialized: `${to}@c.us` });
    return chat;
}

function makeCron() {
    return {
        _tasks: [],
        schedule(pattern, fn) {
            const task = { pattern, fn, stopped: false, stop() { this.stopped = true; } };
            this._tasks.push(task);
            return task;
        }
    };
}

function makeWeb() {
    return { use() {} };
}

// Each test gets its own isolated directory
function makeDir(base) {
    return fs.mkdtempSync(path.join(base, 'case-'));
}

// --- helpers ---

function write(dir, name, source) {
    fs.writeFileSync(path.join(dir, `${name}.js`), source, 'utf8');
}

const SRC = {
    one_listener: `module.exports = function(chat) { chat.on('message', () => {}); };`,
    two_listeners: `module.exports = function(chat) { chat.on('message', () => {}); chat.on('message', () => {}); };`,
    one_cron: `module.exports = function(chat, web, cron) { cron.schedule('* * * * *', () => {}); };`,
    pong: `module.exports = function(chat) { chat.on('message', msg => { if (msg.body === 'ping') msg.reply('pong'); }); };`,
    pong_v2: `module.exports = function(chat) { chat.on('message', msg => { if (msg.body === 'ping') msg.reply('pong-v2'); }); };`,
    noop: `module.exports = function() {};`,
};

// --- suite ---

describe('BehaviourManager', () => {
    let base;

    before(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'waproxy-mgr-')); });
    after(() => { fs.rmSync(base, { recursive: true, force: true }); });

    test('load() registra il listener del behaviour', () => {
        const dir = makeDir(base);
        const chat = makeChat();
        const manager = new BehaviourManager(chat, makeWeb(), makeCron(), { dir });

        write(dir, 'a', SRC.one_listener);
        manager.load('a');

        assert.equal(chat.listenerCount('message'), 1);
    });

    test('unload() rimuove i listener e distrugge i cron', () => {
        const dir = makeDir(base);
        const chat = makeChat();
        const cron = makeCron();
        const manager = new BehaviourManager(chat, makeWeb(), cron, { dir });

        write(dir, 'b', SRC.one_cron);
        manager.load('b');
        assert.equal(cron._tasks.length, 1);
        assert.equal(cron._tasks[0].stopped, false);

        manager.unload('b');
        assert.equal(chat.listenerCount('message'), 0);
        assert.equal(cron._tasks[0].stopped, true);
    });

    test('save() scrive il file e attiva il behaviour immediatamente', () => {
        const dir = makeDir(base);
        const chat = makeChat();
        const manager = new BehaviourManager(chat, makeWeb(), makeCron(), { dir });

        manager.save('c', SRC.one_listener);

        assert.equal(chat.listenerCount('message'), 1);
        assert.ok(fs.existsSync(path.join(dir, 'c.js')));
    });

    test('save() rifiuta sorgenti che non esportano una funzione', () => {
        const dir = makeDir(base);
        const manager = new BehaviourManager(makeChat(), makeWeb(), makeCron(), { dir });

        assert.throws(
            () => manager.save('bad', `const topLevelOnly = true;`),
            /deve esportare una funzione/
        );
        assert.equal(manager.list().some(item => item.name === 'bad'), false);
        assert.equal(fs.existsSync(path.join(dir, 'bad.js')), false);
    });

    test('save() ripristina il sorgente precedente se un aggiornamento non è valido', () => {
        const dir = makeDir(base);
        const chat = makeChat();
        const manager = new BehaviourManager(chat, makeWeb(), makeCron(), { dir });

        manager.save('stable', SRC.one_listener);

        assert.throws(
            () => manager.save('stable', `const broken = true;`),
            /deve esportare una funzione/
        );
        assert.equal(manager.show('stable'), SRC.one_listener);
        assert.equal(chat.listenerCount('message'), 1);
    });

    test('delete() rimuove listener e file su disco', () => {
        const dir = makeDir(base);
        const chat = makeChat();
        const manager = new BehaviourManager(chat, makeWeb(), makeCron(), { dir });

        manager.save('d', SRC.one_listener);
        manager.delete('d');

        assert.equal(chat.listenerCount('message'), 0);
        assert.equal(fs.existsSync(path.join(dir, 'd.js')), false);
    });

    test('list() restituisce i behaviour attivi con MD5', () => {
        const dir = makeDir(base);
        const manager = new BehaviourManager(makeChat(), makeWeb(), makeCron(), { dir });

        manager.save('e1', SRC.noop);
        manager.save('e2', SRC.noop);

        const items = manager.list();
        const names = items.map(i => i.name);
        assert.ok(names.includes('e1'));
        assert.ok(names.includes('e2'));
        items.forEach(i => assert.match(i.md5, /^[a-f0-9]{32}$/));
    });

    test('show() restituisce il sorgente corrente', () => {
        const dir = makeDir(base);
        const manager = new BehaviourManager(makeChat(), makeWeb(), makeCron(), { dir });

        manager.save('f', '/* unique-marker */\nmodule.exports = function() {};');

        assert.ok(manager.show('f').includes('unique-marker'));
        assert.equal(manager.show('nonexistent'), null);
    });

    test('check() rileva file nuovo e lo carica', () => {
        const dir = makeDir(base);
        const chat = makeChat();
        const manager = new BehaviourManager(chat, makeWeb(), makeCron(), { dir });

        write(dir, 'g', SRC.one_listener);
        const result = manager.check();

        assert.ok(result.added.includes('g'));
        assert.equal(chat.listenerCount('message'), 1);
    });

    test('check() segnala file invalidi senza interrompere il reload', () => {
        const dir = makeDir(base);
        const chat = makeChat();
        const manager = new BehaviourManager(chat, makeWeb(), makeCron(), { dir });

        write(dir, 'invalid', `const broken = true;`);
        write(dir, 'valid', SRC.one_listener);
        const result = manager.check();

        assert.ok(result.added.includes('valid'));
        assert.equal(result.errors.length, 1);
        assert.equal(result.errors[0].name, 'invalid');
        assert.equal(chat.listenerCount('message'), 1);
        assert.equal(fs.existsSync(path.join(dir, 'invalid.js')), false);
        assert.equal(fs.existsSync(path.join(dir, 'invalid.js.invalid')), true);
    });

    test('check() mette in quarantena anche sorgenti con errori top-level', () => {
        const dir = makeDir(base);
        const manager = new BehaviourManager(makeChat(), makeWeb(), makeCron(), { dir });

        write(dir, 'top-level-error', `chat.sendMessage('x', 'y');`);
        const result = manager.check();

        assert.equal(result.errors.length, 1);
        assert.match(result.errors[0].error, /chat is not defined/);
        assert.equal(fs.existsSync(path.join(dir, 'top-level-error.js')), false);
        assert.equal(fs.existsSync(path.join(dir, 'top-level-error.js.invalid')), true);
    });

    test('check() rileva MD5 cambiato e ricarica', () => {
        const dir = makeDir(base);
        const chat = makeChat();
        const manager = new BehaviourManager(chat, makeWeb(), makeCron(), { dir });

        write(dir, 'h', SRC.one_listener);
        manager.load('h');
        assert.equal(chat.listenerCount('message'), 1);

        write(dir, 'h', SRC.two_listeners);
        const result = manager.check();

        assert.ok(result.reloaded.includes('h'));
        assert.equal(chat.listenerCount('message'), 2, 'vecchio listener rimosso, due nuovi attivi');
    });

    test('check() rileva file rimosso e scarica il behaviour', () => {
        const dir = makeDir(base);
        const chat = makeChat();
        const manager = new BehaviourManager(chat, makeWeb(), makeCron(), { dir });

        write(dir, 'i', SRC.one_listener);
        manager.load('i');
        assert.equal(chat.listenerCount('message'), 1);

        fs.unlinkSync(path.join(dir, 'i.js'));
        const result = manager.check();

        assert.ok(result.removed.includes('i'));
        assert.equal(chat.listenerCount('message'), 0);
    });

    test('il behaviour esegue la logica corretta a runtime', () => {
        const dir = makeDir(base);
        const chat = makeChat();
        const manager = new BehaviourManager(chat, makeWeb(), makeCron(), { dir });

        manager.save('j', SRC.pong);

        let replied = null;
        chat.emit('message', { body: 'ping', reply: t => { replied = t; } });
        assert.equal(replied, 'pong');

        chat.emit('message', { body: 'other', reply: t => { replied = t; } });
        assert.equal(replied, 'pong', 'messaggio non corrispondente non modifica la risposta');
    });

    test('reload sostituisce la logica a runtime senza residui', () => {
        const dir = makeDir(base);
        const chat = makeChat();
        const manager = new BehaviourManager(chat, makeWeb(), makeCron(), { dir });

        manager.save('k', SRC.pong);

        let replied = null;
        const msg = { body: 'ping', reply: t => { replied = t; } };
        chat.emit('message', msg);
        assert.equal(replied, 'pong');

        manager.save('k', SRC.pong_v2);

        replied = null;
        chat.emit('message', msg);
        assert.equal(replied, 'pong-v2');
        assert.equal(chat.listenerCount('message'), 1, 'solo il listener della versione nuova è attivo');
    });
});
