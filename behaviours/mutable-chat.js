const BehaviourManager = require('./mutable-manager');
const managerInstance = require('./manager-instance');

const CHECK_INTERVAL = process.env.WAPROXY_MUTABLE_CHECK_INTERVAL || '* * * * *';

const HELP = 'Comandi: list | create <nome> | save | cancel | reload | show <nome> | delete <nome>';

module.exports = function(chat, web, cron, options = {}) {
    const ADMIN = options.admin
        || (process.env.WAPROXY_ADMIN || '').split(',').map(s => s.trim()).filter(Boolean);

    const manager = new BehaviourManager(chat, web, cron, options);
    managerInstance.set(manager);
    manager.check();

    cron.schedule(CHECK_INTERVAL, () => manager.check());

    // sender → { name, buffer }
    const sessions = new Map();

    const isAdmin = (msg) => {
        if (ADMIN.length === 0) return true;
        return ADMIN.includes(msg.from.replace('@c.us', ''));
    };

    chat.on('message', async msg => {
        if (!isAdmin(msg)) return;

        const session = sessions.get(msg.from);

        // Collect code while in a create session
        if (session && !msg.body.startsWith('/behaviour')) {
            session.buffer = msg.body;
            return msg.reply(`Codice ricevuto per "${session.name}". Usa /behaviour save per attivarlo o /behaviour cancel per annullare.`);
        }

        if (!msg.body.startsWith('/behaviour')) return;

        const parts = msg.body.slice('/behaviour'.length).trim().split(/\s+/);
        const [cmd, name] = parts;

        try {
            switch (cmd) {

                case 'list': {
                    const items = manager.list();
                    if (!items.length) return msg.reply('Nessun behaviour mutable attivo.');
                    return msg.reply('Attivi:\n' + items.map(i => `- ${i.name} (${i.md5.slice(0, 8)})`).join('\n'));
                }

                case 'create': {
                    if (!name) return msg.reply('Usa: /behaviour create <nome>');
                    sessions.set(msg.from, { name, buffer: null });
                    return msg.reply(`Pronto. Invia il codice JS per "${name}", poi /behaviour save.`);
                }

                case 'save': {
                    if (!session?.buffer) return msg.reply('Nessun codice in attesa. Usa prima /behaviour create <nome>.');
                    const md5 = manager.save(session.name, session.buffer);
                    const savedName = session.name;
                    sessions.delete(msg.from);
                    return msg.reply(`Behaviour "${savedName}" salvato e attivo. MD5: ${md5.slice(0, 8)}`);
                }

                case 'cancel': {
                    sessions.delete(msg.from);
                    return msg.reply('Operazione annullata.');
                }

                case 'reload': {
                    const result = manager.check();
                    const lines = [];
                    if (result.added.length)    lines.push(`Aggiunti: ${result.added.join(', ')}`);
                    if (result.reloaded.length) lines.push(`Ricaricati: ${result.reloaded.join(', ')}`);
                    if (result.removed.length)  lines.push(`Rimossi: ${result.removed.join(', ')}`);
                    if (result.errors.length)   lines.push('Errori:\n' + result.errors.map(e => `- ${e.name}: ${e.error}`).join('\n'));
                    return msg.reply(lines.length ? lines.join('\n') : 'Nessuna modifica rilevata.');
                }

                case 'show': {
                    if (!name) return msg.reply('Usa: /behaviour show <nome>');
                    const source = manager.show(name);
                    if (!source) return msg.reply(`Behaviour "${name}" non trovato.`);
                    return msg.reply('```\n' + source + '\n```');
                }

                case 'delete': {
                    if (!name) return msg.reply('Usa: /behaviour delete <nome>');
                    manager.delete(name);
                    return msg.reply(`Behaviour "${name}" eliminato.`);
                }

                default:
                    return msg.reply(HELP);
            }
        } catch (err) {
            return msg.reply(`Errore: ${err.message}`);
        }
    });
};
