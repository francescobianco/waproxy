const { exec } = require('child_process');
const managerInstance = require('./manager-instance');

// --- Shell ---

const SHELL_TIMEOUT = parseInt(process.env.WAPROXY_SHELL_TIMEOUT || '30000', 10);
const SHELL_MAX_OUTPUT = parseInt(process.env.WAPROXY_SHELL_MAX_OUTPUT || '4096', 10);
const SHELL_BLOCKED = [/node_modules/, /\.map\b/, /\.d\.ts\b/];

function truncate(str, max) {
    const s = str.trim();
    if (s.length <= max) return s;
    return s.slice(0, max) + `\n… [troncato, ${s.length - max} caratteri omessi]`;
}

function shell(command) {
    const blocked = SHELL_BLOCKED.find(re => re.test(command));
    if (blocked) return Promise.resolve({
        exit_code: 1, stdout: '',
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

// --- Shared state (model discovery, chat reference) ---

const ADMIN_NUMBERS = (process.env.WAPROXY_ADMIN || '').split(',').map(s => s.trim()).filter(Boolean);

let _sharedChat = null;
let _candidates = null;
let _candidateIdx = 0;

function modelCost(m) {
    return parseFloat(m.pricing?.prompt || '0') + parseFloat(m.pricing?.completion || '0');
}

async function loadCandidates(apiKey) {
    if (_candidates !== null) return;
    console.log('[agent] discovery modelli su OpenRouter...');
    const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!res.ok) throw new Error(`OpenRouter models API: ${res.status}`);
    const { data } = await res.json();

    const hasTools = m => m.supported_parameters?.includes('tools');
    const free = data.filter(m => modelCost(m) === 0);
    const freeWithTools = free.filter(hasTools);
    const freeTier = freeWithTools.length ? freeWithTools : free;
    freeTier.sort((a, b) => (b.context_length || 0) - (a.context_length || 0));

    const paid = data.filter(m => modelCost(m) > 0 && hasTools(m));
    paid.sort((a, b) => modelCost(a) - modelCost(b));

    _candidates = [...freeTier, ...paid];
    _candidateIdx = 0;

    console.log(`[agent] candidati: ${freeTier.length} free + ${paid.length} paid`);
    if (freeTier.length) console.log(`[agent] primo free: ${freeTier[0].id}`);
    if (paid.length) console.log(`[agent] primo paid: ${paid[0].id} (~${modelCost(paid[0]).toExponential(2)}/tok)`);
}

function currentModel() {
    if (process.env.OPENROUTER_MODEL) return process.env.OPENROUTER_MODEL;
    if (!_candidates || _candidateIdx >= _candidates.length) return null;
    return _candidates[_candidateIdx].id;
}

function advanceModel(label) {
    if (process.env.OPENROUTER_MODEL || !_candidates) return false;
    _candidateIdx++;
    if (_candidateIdx >= _candidates.length) {
        console.warn(`[agent:${label}] nessun altro modello disponibile`);
        return false;
    }
    const next = _candidates[_candidateIdx];
    const cost = modelCost(next);
    console.log(`[agent:${label}] fallback → ${next.id} [${cost === 0 ? 'free' : `~${cost.toExponential(2)}/tok`}]`);
    return true;
}

// --- System prompts ---

const BEHAVIOUR_RULES = `Regole OBBLIGATORIE per il codice dei behaviour:
  - i numeri di telefono sono stringhe internazionali senza '+', es: "393200466987"
  - per inviare un messaggio:
      const id = await chat.getNumberId('393200466987');
      await chat.sendMessage(id._serialized, 'testo');
  - chat.sendMessage richiede id._serialized, NON il numero grezzo
  - OGNI callback async (dentro cron.schedule, chat.on, ecc.) DEVE essere wrappato in try/catch`;

function oneshotPrompt(number, goal, message) {
    return `Sei l'agente autonomo di WAProxy per l'admin ${number}.

Goal cumulativo attuale:
${goal || '(nessun goal attivo)'}

Messaggio dell'admin:
"${message}"

Numeri di telefono admin disponibili: ${ADMIN_NUMBERS.join(', ') || '(nessuno configurato)'}
Quando il comportamento prevede di inviare messaggi all'admin, usa questi numeri reali — MAI placeholder.

${BEHAVIOUR_RULES}

REGOLE DI COMPORTAMENTO:

Richiesta sincrona (risposta immediata, nessun loop):
  → Rispondi direttamente. Non chiamare add_goal né tool di scheduling.

Richiesta asincrona (azioni future, ripetute o posticipate):
  1. Chiama add_goal(description) per registrare il task
  2. Genera in anticipo TUTTO il contenuto dei messaggi futuri e includilo nei memo
     — il LLM nelle iterazioni successive NON ha contesto su questa conversazione,
       quindi il memo deve essere autosufficiente (es: "invia esattamente questo testo: ...")
  3. Chiama agent_next(memo), agent_timeout(seconds, memo) o agent_event(type, memo)
  4. Rispondi all'admin con una conferma di AVVIO breve (es: "▶ avviato")
     — MAI descrivere azioni future come già accadute
     — MAI ripetere il contenuto che verrà inviato nelle iterazioni

Rispondi in italiano, in modo conciso.`;
}

function iterationPrompt(number, goal, memo) {
    return `Sei l'agente autonomo di WAProxy per l'admin ${number}.

Goal cumulativo (task asincroni registrati):
${goal || '(nessun goal attivo)'}

Memo di questa iterazione:
"${memo}"

Numeri di telefono admin disponibili: ${ADMIN_NUMBERS.join(', ') || '(nessuno configurato)'}

Esegui ESATTAMENTE ciò che il memo descrive. Il memo è autosufficiente: non inventare
contenuti non specificati. Se il memo dice "invia questo testo: ...", invia quel testo
preciso senza modifiche o integrazioni.

Se la catena deve continuare, chiama agent_next(memo), agent_timeout(seconds, memo)
o agent_event(type, memo). Il memo del passo successivo deve includere tutto il contenuto
necessario — non fare affidamento su contesto esterno al memo stesso.
Se hai finito, non schedulare nulla.`;
}

// --- Tools ---

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
                    name: { type: 'string', description: 'Nome del behaviour, solo lettere minuscole e trattini' },
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
    },
    {
        type: 'function',
        function: {
            name: 'add_goal',
            description: 'Registra un task asincrono nel goal cumulativo. Chiamare SOLO per task che richiedono azioni ripetute o posticipate nel tempo.',
            parameters: {
                type: 'object',
                properties: {
                    description: { type: 'string', description: 'Descrizione del task asincrono da registrare' }
                },
                required: ['description']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'agent_next',
            description: 'Schedula la prossima iterazione dell\'agente immediatamente.',
            parameters: {
                type: 'object',
                properties: {
                    memo: { type: 'string', description: 'Memo che identifica e descrive il passo successivo' }
                },
                required: ['memo']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'agent_timeout',
            description: 'Schedula la prossima iterazione dell\'agente dopo un ritardo in secondi.',
            parameters: {
                type: 'object',
                properties: {
                    seconds: { type: 'number', description: 'Secondi da attendere prima della prossima iterazione' },
                    memo: { type: 'string', description: 'Memo che identifica e descrive il passo successivo' }
                },
                required: ['seconds', 'memo']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'agent_kill',
            description: 'Cancella iterazioni pendenti e listener di eventi il cui memo contiene il pattern dato.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Pattern da cercare nel memo delle iterazioni pendenti' }
                },
                required: ['pattern']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'agent_event',
            description: 'Sospende la catena e riprende quando si verifica un evento esterno. Tipo supportato: "message" (prossimo messaggio admin). I dati dell\'evento vengono passati all\'iterazione successiva.',
            parameters: {
                type: 'object',
                properties: {
                    type: { type: 'string', description: 'Tipo di evento da attendere. Valore supportato: "message"' },
                    memo: { type: 'string', description: 'Memo che descrive cosa fare quando l\'evento si verifica' }
                },
                required: ['type', 'memo']
            }
        }
    },
];

// --- Context TTL ---

const CONTEXT_TTL = parseInt(process.env.WAPROXY_CONTEXT_TTL || String(4 * 60 * 60 * 1000), 10);

// --- Agent class (one instance per admin number) ---

class Agent {
    constructor(number) {
        this._number = number;
        this._goal = '';
        this._pending = new Map(); // id → { memo, handle, type }
        this._pendingEvents = new Map(); // eventType → [{ memo }]
        this._nextId = 0;
        this._history = []; // conversation history for this user
    }

    addGoal(description) {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        this._goal += `[${ts}] ${description}\n`;
    }

    scheduleNext(memo) {
        const id = this._nextId++;
        const handle = setImmediate(() => {
            this._pending.delete(id);
            this.runIteration(memo);
        });
        this._pending.set(id, { memo, handle, type: 'immediate' });
    }

    scheduleTimeout(seconds, memo) {
        const id = this._nextId++;
        const handle = setTimeout(() => {
            this._pending.delete(id);
            this.runIteration(memo);
        }, seconds * 1000);
        this._pending.set(id, { memo, handle, type: 'timeout' });
    }

    kill(pattern) {
        let count = 0;
        for (const [id, { memo, handle, type }] of [...this._pending]) {
            if (memo.includes(pattern)) {
                if (type === 'immediate') clearImmediate(handle);
                else clearTimeout(handle);
                this._pending.delete(id);
                count++;
            }
        }
        for (const [eventType, queue] of [...this._pendingEvents]) {
            const before = queue.length;
            const filtered = queue.filter(e => !e.memo.includes(pattern));
            count += before - filtered.length;
            if (filtered.length) this._pendingEvents.set(eventType, filtered);
            else this._pendingEvents.delete(eventType);
        }
        return count;
    }

    registerEvent(type, memo) {
        const queue = this._pendingEvents.get(type) || [];
        queue.push({ memo });
        this._pendingEvents.set(type, queue);
    }

    // Returns true if an event was consumed and an iteration was launched.
    fireEvent(type, data = {}) {
        const queue = this._pendingEvents.get(type);
        if (!queue || !queue.length) return false;
        const { memo } = queue.shift();
        if (!queue.length) this._pendingEvents.delete(type);
        this.runIteration(memo, { type, data });
        return true;
    }

    // --- Context ---

    _loadContext() {
        const now = Date.now();
        this._history = this._history.filter(e => now - e.ts < CONTEXT_TTL);
        return this._history.map(({ role, content }) => ({ role, content }));
    }

    _saveContext(userMessage, assistantReply) {
        const ts = Date.now();
        this._history.push({ role: 'user', content: userMessage, ts });
        this._history.push({ role: 'assistant', content: assistantReply, ts });
    }

    // --- Tool execution ---

    async _executeTool(name, args) {
        const manager = managerInstance.get();
        const chat = _sharedChat;

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
            case 'add_goal':
                this.addGoal(args.description);
                return { ok: true };
            case 'agent_next':
                this.scheduleNext(args.memo);
                return { ok: true, scheduled: 'immediate' };
            case 'agent_timeout':
                this.scheduleTimeout(args.seconds, args.memo);
                return { ok: true, scheduled: `${args.seconds}s` };
            case 'agent_kill': {
                const count = this.kill(args.pattern);
                return { ok: true, cancelled: count };
            }
            case 'agent_event':
                this.registerEvent(args.type, args.memo);
                return { ok: true, waiting_for: args.type };
            default:
                return { error: `Tool sconosciuto: ${name}` };
        }
    }

    // --- LLM loop ---

    async _runLoop(messages, apiKey, debug) {
        const label = this._number;
        while (true) {
            const model = currentModel();
            if (!model) throw new Error('Nessun modello disponibile dopo i tentativi');

            if (debug) console.log(`[agent:${label}] uso modello: ${model}`);

            let rateLimited = false;

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

                if (res.status === 429) {
                    console.warn(`[agent:${label}] modello ${model} rate-limited (429), provo il prossimo...`);
                    rateLimited = !advanceModel(label);
                    break;
                }

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
                    const result = await this._executeTool(toolCall.function.name, args);
                    if (debug) console.log(`[agent:${label}] tool ${toolCall.function.name}`, JSON.stringify(args), '→', JSON.stringify(result));
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(result)
                    });
                }
            }

            if (rateLimited) throw new Error('Tutti i modelli sono rate-limited. Riprova tra qualche minuto.');
            if (!rateLimited) break;
        }

        return 'Limite di turni agente raggiunto.';
    }

    // --- Public API ---

    async handleMessage(userMessage) {
        const apiKey = process.env.OPENROUTER_API_KEY;
        const debug = process.env.WAPROXY_LOG === 'debug';

        await loadCandidates(apiKey);

        const pastMessages = this._loadContext();
        if (debug && pastMessages.length) {
            console.log(`[agent:${this._number}] contesto caricato — ${pastMessages.length} messaggi`);
        }

        const messages = [
            { role: 'system', content: oneshotPrompt(this._number, this._goal, userMessage) },
            ...pastMessages,
            { role: 'user', content: userMessage }
        ];

        const reply = await this._runLoop(messages, apiKey, debug);
        this._saveContext(userMessage, reply);
        return reply;
    }

    async runIteration(memo, event = null) {
        const apiKey = process.env.OPENROUTER_API_KEY;
        const debug = process.env.WAPROXY_LOG === 'debug';

        if (debug) console.log(`[agent:${this._number}] runIteration — memo: "${memo}"${event ? `, event: ${event.type}` : ''}`);

        try {
            await loadCandidates(apiKey);

            const userContent = event
                ? `Esegui il memo: ${memo}\n\nEvento "${event.type}" ricevuto:\n${JSON.stringify(event.data, null, 2)}`
                : `Esegui il memo: ${memo}`;

            const messages = [
                { role: 'system', content: iterationPrompt(this._number, this._goal, memo) },
                { role: 'user', content: userContent }
            ];

            await this._runLoop(messages, apiKey, debug);
        } catch (err) {
            console.error(`[agent:${this._number}] errore in iterazione "${memo}":`, err.message, err.stack);
        }
    }
}

// --- Registry (one Agent per admin number) ---

const _instances = new Map(); // number → Agent

module.exports = {
    setChat(chat) {
        _sharedChat = chat;
    },

    getFor(number) {
        if (!_instances.has(number)) {
            _instances.set(number, new Agent(number));
        }
        return _instances.get(number);
    },
};
