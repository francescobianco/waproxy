const agent = require('./agent');

const ADMIN_NUMBERS = (process.env.WAPROXY_ADMIN || '').split(',').map(s => s.trim()).filter(Boolean);

module.exports = function(chat, web, cron) {
    if (!process.env.OPENROUTER_API_KEY) {
        console.warn('[smart-chat] OPENROUTER_API_KEY non impostata — behaviour disabilitato');
        return;
    }

    const debug = process.env.WAPROXY_LOG === 'debug';

    agent.setChat(chat);

    const resolveNumber = async (msg) => {
        if (debug) {
            const allProps = {};
            for (const k of Object.keys(msg)) {
                try { allProps[k] = msg[k]; } catch (_) {}
            }
            console.log('[smart-chat] msg keys:', Object.keys(msg).join(', '));
            console.log('[smart-chat] msg dump:', JSON.stringify(allProps, null, 2));
            try {
                const contact = await msg.getContact();
                console.log('[smart-chat] contact dump:', JSON.stringify({
                    number: contact.number,
                    name: contact.name,
                    pushname: contact.pushname,
                    shortName: contact.shortName,
                    id: contact.id,
                }, null, 2));
            } catch (e) {
                console.log('[smart-chat] getContact error:', e.message);
            }
        }

        // contact.id.user contiene il numero reale anche quando msg.from è un LID
        try {
            const contact = await msg.getContact();
            if (contact?.id?.user) return contact.id.user;
        } catch (_) {}
        return msg.from.replace(/@.*$/, '');
    };

    chat.on('message', async msg => {
        const number = await resolveNumber(msg);
        const isAdmin = ADMIN_NUMBERS.includes(number);
        if (debug) console.log(`[smart-chat] isAdmin — number: "${number}", admins: [${ADMIN_NUMBERS.join(', ')}], result: ${isAdmin}`);
        if (!isAdmin) return;
        if (msg.body.startsWith('/')) return;

        if (debug) console.log(`[smart-chat] input — from: ${number}, body: "${msg.body}"`);

        // Se c'è un'iterazione in attesa di un evento 'message', la priorità va a quella.
        if (agent.fireEvent('message', { from: number, text: msg.body })) return;

        try {
            const reply = await agent.handleMessage(msg.body, number);
            if (debug) console.log(`[smart-chat] reply — "${reply}"`);
            await msg.reply(reply);
        } catch (err) {
            console.error('[smart-chat] errore:', err.message, err.stack);
            await msg.reply(`Errore agente: ${err.message}`);
        }
    });
};
