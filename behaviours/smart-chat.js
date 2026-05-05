const { exec } = require('child_process');
const managerInstance = require('./manager-instance');

const SHELL_TIMEOUT = parseInt(process.env.WAPROXY_SHELL_TIMEOUT || '30000', 10);
const SHELL_MAX_OUTPUT = parseInt(process.env.WAPROXY_SHELL_MAX_OUTPUT || '4096', 10);

function truncate(str, max) {
    const s = str.trim();
    if (s.length <= max) return s;
    return s.slice(0, max) + `\n… [troncato, ${s.length - max} caratteri omessi]`;
}

const SHELL_BLOCKED = [
    /node_modules/,
    /\.map\b/,
    /\.d\.ts\b/,
];

function shell(command) {
    const blocked = SHELL_BLOCKED.find(re => re.test(command));
    if (blocked) return Promise.resolve({
        exit_code: 1,
        stdout: '',
        stderr: `Comando bloccato: il pattern "${blocked}" non è consentito.`,
    });

    return new Promise((resolve) => {
        exec(command, { timeout: SHELL_TIMEOUT, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
            resolve({
                exit_code: err ? (err.code ?? 1) : 0,
                stdout: truncate(stdout, SHELL_MAX_OUTPUT),
                stderr: truncate(stderr, SHELL_MAX_OUTPUT),
            });
        });
    });
}

const ADMIN_NUMBERS = (process.env.WAPROXY_ADMIN || '').split(',').map(s => s.trim()).filter(Boolean);

const SYSTEM_PROMPT = `Sei l'assistente di WAProxy, un proxy WhatsApp programmabile.
Hai accesso a tool per inviare messaggi WhatsApp e gestire i behaviour mutable.

Un behaviour mutable è un modulo Node.js con questa firma esatta:
  module.exports = function(chat, web, cron) { ... }
dove:
  - chat  → client WhatsApp: chat.on('message', fn), chat.sendMessage(id, testo), chat.getNumberId(numero)
  - web   → Express Router: web.post('/path', fn), web.get('/path', fn)
  - cron  → node-cron: cron.schedule('* * * * *', fn)

Numeri di telefono admin disponibili: ${ADMIN_NUMBERS.join(', ') || '(nessuno configurato)'}
Quando il comportamento prevede di inviare messaggi all'admin, usa questi numeri reali — MAI placeholder come "tuo-numero" o "NUMERO".

Regole OBBLIGATORIE per il codice dei behaviour:
  - i numeri di telefono sono stringhe internazionali senza '+', es: "393200466987"
  - per inviare un messaggio:
      const id = await chat.getNumberId('393200466987');
      await chat.sendMessage(id._serialized, 'testo');
  - chat.sendMessage richiede id._serialized, NON il numero grezzo
  - OGNI callback async (dentro cron.schedule, chat.on, ecc.) DEVE essere wrappato in try/catch:
      cron.schedule('* * * * *', async () => {
        try {
          // logica
        } catch (err) {
          console.error('[nome-behaviour] errore:', err.message, err.stack);
        }
      });

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
    },
    {
        type: 'function',
        function: {
            name: 'run_shell_command',
            description: 'Esegue un comando shell sul server. Restituisce stdout, stderr e exit code.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Comando shell da eseguire' }
                },
                required: ['command']
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
        case 'run_shell_command':
            return shell(args.command);

        default:
            return { error: `Tool sconosciuto: ${name}` };
    }
}

const CONTEXT_TTL = parseInt(process.env.WAPROXY_CONTEXT_TTL || String(4 * 60 * 60 * 1000), 10);
const contextHistory = new Map(); // number → [{ role, content, ts }]

function loadContext(number) {
    const now = Date.now();
    const fresh = (contextHistory.get(number) || []).filter(e => now - e.ts < CONTEXT_TTL);
    contextHistory.set(number, fresh);
    return fresh.map(({ role, content }) => ({ role, content }));
}

function saveContext(number, userMessage, assistantReply) {
    const entries = contextHistory.get(number) || [];
    const ts = Date.now();
    entries.push({ role: 'user', content: userMessage, ts });
    entries.push({ role: 'assistant', content: assistantReply, ts });
    contextHistory.set(number, entries);
}

async function runAgent(userMessage, chat, debug = false, number = null) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

    const pastMessages = number ? loadContext(number) : [];
    if (debug && pastMessages.length) console.log(`[smart-chat] contesto caricato — ${pastMessages.length} messaggi precedenti da ${number}`);

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...pastMessages,
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
            const reply = assistantMsg.content || '(nessuna risposta)';
            if (number) saveContext(number, userMessage, reply);
            return reply;
        }

        for (const toolCall of assistantMsg.tool_calls) {
            const args = JSON.parse(toolCall.function.arguments);
            const result = await executeTool(toolCall.function.name, args, chat);
            if (debug) console.log(`[smart-chat] tool ${toolCall.function.name}`, JSON.stringify(args), '→', JSON.stringify(result));
            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result)
            });
        }
    }

    const reply = 'Limite di turni agente raggiunto.';
    if (number) saveContext(number, userMessage, reply);
    return reply;
}

module.exports = function(chat, web, cron) {
    const ADMIN = (process.env.WAPROXY_ADMIN || '').split(',').map(s => s.trim()).filter(Boolean);

    if (!process.env.OPENROUTER_API_KEY) {
        console.warn('[smart-chat] OPENROUTER_API_KEY non impostata — behaviour disabilitato');
        return;
    }

    const debug = process.env.WAPROXY_LOG === 'debug';

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
        const isAdmin = ADMIN.includes(number);
        if (debug) console.log(`[smart-chat] isAdmin — number: "${number}", admins: [${ADMIN.join(', ')}], result: ${isAdmin}`);
        if (!isAdmin) return;
        if (msg.body.startsWith('/')) return; // comandi espliciti gestiti da altri behaviour

        if (debug) console.log(`[smart-chat] input — from: ${number}, body: "${msg.body}"`);

        try {
            const reply = await runAgent(msg.body, chat, debug, number);
            if (debug) console.log(`[smart-chat] reply — "${reply}"`);
            await msg.reply(reply);
        } catch (err) {
            console.error('[smart-chat] errore:', err.message, err.stack);
            await msg.reply(`Errore agente: ${err.message}`);
        }
    });
};
