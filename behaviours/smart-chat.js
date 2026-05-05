const managerInstance = require('./manager-instance');

const SYSTEM_PROMPT = `Sei l'assistente di WAProxy, un proxy WhatsApp programmabile.
Hai accesso a tool per inviare messaggi WhatsApp e gestire i behaviour mutable.

Un behaviour mutable è un modulo Node.js con questa firma esatta:
  module.exports = function(chat, web, cron) { ... }
dove:
  - chat  → client WhatsApp: chat.on('message', fn), chat.sendMessage(id, testo), chat.getNumberId(numero)
  - web   → Express Router: web.post('/path', fn), web.get('/path', fn)
  - cron  → node-cron: cron.schedule('* * * * *', fn)

Regole per il codice dei behaviour:
  - usa await/async quando chiami chat.getNumberId o chat.sendMessage
  - i numeri di telefono sono stringhe internazionali senza '+', es: "393200466987"
  - per inviare un messaggio: const id = await chat.getNumberId(numero); await chat.sendMessage(id._serialized, testo)

Rispondi in italiano, in modo conciso. Dopo aver eseguito un tool conferma l'esito all'utente.`;

const TOOLS = [
    {
        type: 'function',
        function: {
            name: 'send_whatsapp_message',
            description: 'Invia un messaggio WhatsApp a un numero di telefono',
            parameters: {
                type: 'object',
                properties: {
                    to: { type: 'string', description: 'Numero internazionale senza +, es: 393200466987' },
                    message: { type: 'string', description: 'Testo del messaggio' }
                },
                required: ['to', 'message']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_behaviours',
            description: 'Elenca i behaviour mutable attivi con nome e MD5',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_behaviour',
            description: 'Crea o aggiorna un behaviour mutable. Attivo immediatamente senza riavvio.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Nome del behaviour, solo lettere minuscole e trattini, es: unix-timestamp' },
                    code: { type: 'string', description: 'Codice JavaScript completo del behaviour' }
                },
                required: ['name', 'code']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_behaviour',
            description: 'Elimina un behaviour mutable',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Nome del behaviour da eliminare' }
                },
                required: ['name']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'show_behaviour',
            description: 'Mostra il codice sorgente di un behaviour mutable',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Nome del behaviour' }
                },
                required: ['name']
            }
        }
    }
];

async function executeTool(name, args, chat) {
    const manager = managerInstance.get();

    switch (name) {
        case 'send_whatsapp_message': {
            const numberId = await chat.getNumberId(args.to);
            await chat.sendMessage(numberId._serialized, args.message);
            return { ok: true, to: args.to };
        }
        case 'list_behaviours':
            return { behaviours: manager ? manager.list() : [] };

        case 'create_behaviour': {
            if (!manager) return { error: 'BehaviourManager non disponibile' };
            const md5 = manager.save(args.name, args.code);
            return { ok: true, name: args.name, md5 };
        }
        case 'delete_behaviour': {
            if (!manager) return { error: 'BehaviourManager non disponibile' };
            manager.delete(args.name);
            return { ok: true, name: args.name };
        }
        case 'show_behaviour': {
            if (!manager) return { error: 'BehaviourManager non disponibile' };
            const source = manager.show(args.name);
            return source ? { code: source } : { error: `"${args.name}" non trovato` };
        }
        default:
            return { error: `Tool sconosciuto: ${name}` };
    }
}

async function runAgent(userMessage, chat) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
    ];

    for (let turn = 0; turn < 10; turn++) {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/francescobianco/waproxy'
            },
            body: JSON.stringify({ model, messages, tools: TOOLS })
        });

        if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);

        const data = await res.json();
        const choice = data.choices[0];
        const assistantMsg = choice.message;
        messages.push(assistantMsg);

        if (choice.finish_reason === 'stop' || !assistantMsg.tool_calls?.length) {
            return assistantMsg.content || '(nessuna risposta)';
        }

        for (const toolCall of assistantMsg.tool_calls) {
            const args = JSON.parse(toolCall.function.arguments);
            const result = await executeTool(toolCall.function.name, args, chat);
            console.log(`[smart-chat] tool ${toolCall.function.name}`, args, '→', result);
            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result)
            });
        }
    }

    return 'Limite di turni agente raggiunto.';
}

module.exports = function(chat, web, cron) {
    const ADMIN = (process.env.WAPROXY_ADMIN || '').split(',').map(s => s.trim()).filter(Boolean);

    if (!process.env.OPENROUTER_API_KEY) {
        console.warn('[smart-chat] OPENROUTER_API_KEY non impostata — behaviour disabilitato');
        return;
    }

    const isAdmin = (msg) => ADMIN.includes(msg.from.replace('@c.us', ''));

    chat.on('message', async msg => {
        if (!isAdmin(msg)) return;
        if (msg.body.startsWith('/')) return; // comandi espliciti gestiti da altri behaviour

        try {
            const reply = await runAgent(msg.body, chat);
            await msg.reply(reply);
        } catch (err) {
            console.error('[smart-chat] errore:', err.message);
            await msg.reply(`Errore agente: ${err.message}`);
        }
    });
};
