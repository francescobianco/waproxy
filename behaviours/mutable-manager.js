const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const MUTABLE_DIR = process.env.WAPROXY_DATA_DIR
    ? path.join(process.env.WAPROXY_DATA_DIR, 'behaviours', 'mutable')
    : path.join(__dirname, 'mutable');

class BehaviourManager {
    constructor(chat, web, cron, options = {}) {
        this.chat = chat;
        this.web = web;
        this.cron = cron;
        this.registry = new Map(); // name → { md5, listeners, tasks }
        this.routers = new Map();  // name → Express.Router (mounted once, reused)
        this.dir = options.dir || MUTABLE_DIR;
    }

    _md5(content) {
        return crypto.createHash('md5').update(content).digest('hex');
    }

    _getRouter(name) {
        if (!this.routers.has(name)) {
            const router = express.Router();
            this.routers.set(name, router);
            this.web.use(router);
        }
        return this.routers.get(name);
    }

    _makeProxies(name, entry) {
        const chatProxy = new Proxy(this.chat, {
            get: (target, prop) => {
                if (prop === 'on') return (event, fn) => {
                    entry.listeners.push({ event, fn });
                    target.on(event, fn);
                };
                const val = target[prop];
                return typeof val === 'function' ? val.bind(target) : val;
            }
        });

        const cronProxy = new Proxy(this.cron, {
            get: (target, prop) => {
                if (prop === 'schedule') return (...args) => {
                    const task = target.schedule(...args);
                    entry.tasks.push(task);
                    return task;
                };
                const val = target[prop];
                return typeof val === 'function' ? val.bind(target) : val;
            }
        });

        return { chatProxy, cronProxy, router: this._getRouter(name) };
    }

    _execute(name, entry) {
        const filePath = path.join(this.dir, `${name}.js`);
        const modulePath = require.resolve(filePath);
        delete require.cache[modulePath];
        const fn = require(filePath);
        if (typeof fn !== 'function') {
            throw new TypeError(
                `Behaviour "${name}" non valido: il file deve esportare una funzione con module.exports = function(chat, web, cron) { ... }`
            );
        }
        const { chatProxy, cronProxy, router } = this._makeProxies(name, entry);
        fn(chatProxy, router, cronProxy);
    }

    _clearEntry(entry) {
        entry.listeners.forEach(({ event, fn }) => this.chat.removeListener(event, fn));
        entry.tasks.forEach(task => task.stop());
        entry.listeners = [];
        entry.tasks = [];
        if (this.routers.has(entry._name)) {
            this.routers.get(entry._name).stack = [];
        }
    }

    load(name) {
        const filePath = path.join(this.dir, `${name}.js`);
        const source = fs.readFileSync(filePath, 'utf8');
        const md5 = this._md5(source);

        if (this.registry.has(name)) {
            this._clearEntry(this.registry.get(name));
        }

        const entry = { _name: name, md5, listeners: [], tasks: [] };
        this.registry.set(name, entry);
        try {
            this._execute(name, entry);
        } catch (err) {
            this._clearEntry(entry);
            this.registry.delete(name);
            throw err;
        }
        return md5;
    }

    unload(name) {
        if (!this.registry.has(name)) return;
        const entry = this.registry.get(name);
        this._clearEntry(entry);
        this.registry.delete(name);
    }

    save(name, source) {
        if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
        const filePath = path.join(this.dir, `${name}.js`);
        const previous = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;

        fs.writeFileSync(filePath, source, 'utf8');
        try {
            return this.load(name);
        } catch (err) {
            if (previous === null) {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            } else {
                fs.writeFileSync(filePath, previous, 'utf8');
                this.load(name);
            }
            throw err;
        }
    }

    delete(name) {
        this.unload(name);
        const filePath = path.join(this.dir, `${name}.js`);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    show(name) {
        const filePath = path.join(this.dir, `${name}.js`);
        return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    }

    list() {
        return [...this.registry.entries()].map(([name, { md5 }]) => ({ name, md5 }));
    }

    check() {
        const results = { added: [], reloaded: [], removed: [], errors: [] };

        for (const [name, entry] of [...this.registry]) {
            const filePath = path.join(this.dir, `${name}.js`);
            if (!fs.existsSync(filePath)) {
                this.unload(name);
                results.removed.push(name);
                continue;
            }
            const source = fs.readFileSync(filePath, 'utf8');
            if (this._md5(source) !== entry.md5) {
                try {
                    this.load(name);
                    results.reloaded.push(name);
                } catch (err) {
                    results.errors.push({ name, error: err.message });
                }
            }
        }

        if (fs.existsSync(this.dir)) {
            for (const file of fs.readdirSync(this.dir).filter(f => f.endsWith('.js'))) {
                const name = path.basename(file, '.js');
                if (!this.registry.has(name)) {
                    try {
                        this.load(name);
                        results.added.push(name);
                    } catch (err) {
                        results.errors.push({ name, error: err.message });
                    }
                }
            }
        }

        return results;
    }
}

module.exports = BehaviourManager;
