# Agent Loop

Esiste **un'istanza di `Agent` per ogni admin** — non un singleton globale. Ogni admin che interagisce con WAProxy ha il proprio agente dedicato, con goal, storia conversazione e iterazioni pendenti completamente separati. L'istanza viene creata al primo messaggio dell'admin e vive per tutta la durata del processo.

La discovery dei modelli OpenRouter è invece condivisa tra tutte le istanze (una sola chiamata API).

---

## Distinzione: sincrono vs asincrono

Non ogni messaggio admin avvia un loop. È il **LLM** a decidere, durante la prima iterazione, se il task richiede continuità nel tempo.

| Tipo | Esempio | Cosa fa il LLM |
|---|---|---|
| **Sincrono** | "cos'è il rook negli scacchi?" | Risponde direttamente, non chiama tool di scheduling |
| **Asincrono** | "fammi tre domande sugli scacchi" | Chiama `add_goal` + `agent_next(memo)` |
| **Asincrono** | "mandami un messaggio tra 5 secondi" | Chiama `add_goal` + `agent_timeout(5, memo)` |
| **Event-driven** | "fai un quiz: aspetta la mia risposta" | Chiama `add_goal` + `agent_event("message", memo)` |

---

## `add_goal` — tool di registrazione

`add_goal(description)` è un tool MCP che il LLM chiama quando rileva un intento asincrono. Aggiunge la descrizione al goal cumulativo dell'agent con timestamp.

```
add_goal("invia tre domande sugli scacchi a intervalli di 10s")
```

Il goal cumulativo cresce nel tempo:

```
[2026-05-06 10:00] invia il timestamp unix ogni minuto
[2026-05-06 10:03] invia tre domande sugli scacchi a intervalli di 10s
```

Il LLM non chiama `add_goal` per richieste sincrone — il goal resta pulito, contiene solo i task asincroni attivi.

---

## Tool MCP dell'Agent

### Self-referenziali (controllo loop)

| Tool | Firma | Descrizione |
|---|---|---|
| `add_goal` | `(description)` | Registra un task asincrono nel goal cumulativo |
| `agent_next` | `(memo)` | Schedula la prossima iterazione immediatamente |
| `agent_timeout` | `(seconds, memo)` | Schedula la prossima iterazione dopo `seconds` secondi |
| `agent_event` | `(type, memo)` | Sospende la catena fino al verificarsi di un evento esterno |

Non esiste `agent_stop`: se il LLM non chiama nessun tool di continuazione, la catena si chiude naturalmente. Il silenzio significa "ho finito".

### Controllo esterno

| Tool | Firma | Descrizione |
|---|---|---|
| `agent_kill` | `(pattern)` | Cancella iterazioni pendenti e listener di eventi il cui memo fa match con `pattern` |

`agent_kill` è usato quando l'admin dice "smettila di mandarmi il timestamp" — il LLM chiama `agent_kill("timestamp")` e tutte le iterazioni e gli event listener con quel pattern nel memo vengono rimossi.

### Tool globali

- `send_whatsapp_message(to, message)`
- `list_behaviours()`, `create_behaviour(name, code)`, `delete_behaviour(name)`, `show_behaviour(name)`
- `run_shell_command(command)`

---

## Il memo

Tutti i tool di continuazione ricevono una stringa memo obbligatoria. Il memo:

- identifica a quale task appartiene quella iterazione
- descrive cosa deve fare quella specifica iterazione
- porta lo stato necessario per quella catena

Il memo è il contratto tra un'iterazione e la successiva. Non esiste `agent_set_state`: lo stato viaggia dentro il memo stesso.

---

## `agent_event` — iterazioni guidate da eventi

`agent_event(type, memo)` sospende la catena e la riprende quando si verifica un evento esterno. A differenza di `agent_timeout`, non ha scadenza: il listener rimane attivo finché l'evento non scatta o non viene ucciso da `agent_kill`.

### Tipi di evento supportati

| Tipo | Trigger | Dati passati all'iterazione |
|---|---|---|
| `"message"` | Prossimo messaggio WhatsApp dell'admin | `{ from: number, text: string }` |

Quando l'evento scatta, `smart-chat.js` intercetta il messaggio **prima** del flusso normale e chiama `runIteration(memo, { type, data })`. Il messaggio non raggiunge `handleMessage` — è consumato dall'iterazione in attesa.

I dati dell'evento sono iniettati nel messaggio utente inviato al LLM:

```
Esegui il memo: <memo>

Evento "message" ricevuto:
{ "from": "393200466987", "text": "e4" }
```

### Esempio: quiz interattivo

```
admin: "fammi un quiz di 3 domande di scacchi, aspetta le mie risposte"
         │
         ▼
  [one-shot — handleMessage]
  LLM:
  → add_goal("quiz scacchi 3 domande con attesa risposta")
  → send_whatsapp_message("Domanda 1: quante case ha la scacchiera?")
  → agent_event("message", "quiz: attendo risposta domanda 1/3")
  → risponde: "Quiz avviato, aspetto le tue risposte"
         │
         │ [admin risponde "64"]
         ▼
┌────────────────────────────────────────────────┐
│  iterazione — memo: "quiz: attendo risposta 1/3"│
│  evento: { from: "393...", text: "64" }         │
│  → valuta risposta, invia feedback              │
│  → send_whatsapp_message("Domanda 2: ...")      │
│  → agent_event("message", "quiz: attendo 2/3") │
└────────────────────────────────────────────────┘
         │ [admin risponde]
         ▼
  ... (domanda 3)
         │
         ▼
┌────────────────────────────────────────────────┐
│  iterazione — memo: "quiz: attendo risposta 3/3"│
│  → valuta ultima risposta, invia punteggio      │
│  [nessun tool di continuazione → catena chiusa] │
└────────────────────────────────────────────────┘
```

---

## Ciclo di vita — esempio timeout

```
admin: "fammi tre domande sugli scacchi a distanza di 10 secondi"
         │
         ▼
  [one-shot — handleMessage]
  LLM:
  → add_goal("tre domande sugli scacchi ogni 10s")
  → risponde: "avviato, ti farò le domande"
  → agent_next("scacchi: domanda 1/3")
         │
         ▼
┌─────────────────────────────────────────┐
│  iterazione — memo: "scacchi: domanda 1/3" │
│  → send_whatsapp_message("Domanda 1: ...")  │
│  → agent_timeout(10, "scacchi: domanda 2/3")│
└─────────────────────────────────────────┘
         │ [10s]
         ▼
┌─────────────────────────────────────────┐
│  iterazione — memo: "scacchi: domanda 2/3" │
│  → send_whatsapp_message("Domanda 2: ...")  │
│  → agent_timeout(10, "scacchi: domanda 3/3")│
└─────────────────────────────────────────┘
         │ [10s]
         ▼
┌─────────────────────────────────────────┐
│  iterazione — memo: "scacchi: domanda 3/3" │
│  → send_whatsapp_message("Domanda 3: ...")  │
│  [nessun agent_next/timeout → catena chiusa]│
└─────────────────────────────────────────┘
```

---

## Iterazioni concorrenti

Più catene coesistono senza serializzazione. Timer e listener di eventi possono coesistere:

```
t=0   timeout("timestamp: iter 1")
t=0   event("message", "quiz: attendo risposta 1/3")

t=0   → "timestamp: iter 1"            → timeout(60, "timestamp: iter 2")
      → [in attesa del messaggio admin]

t=5   admin risponde "64"
      → "quiz: attendo risposta 1/3"   → event("message", "quiz: attendo 2/3")

t=60  → "timestamp: iter 2"            → timeout(60, "timestamp: iter 3")
```

---

## Prompt di sistema per ogni iterazione

```
Sei l'agente autonomo di WAProxy.

Goal cumulativo (task asincroni registrati):
{goal}

Memo di questa iterazione:
"{memo}"

Esegui esattamente ciò che il memo descrive usando i tool disponibili.
Se questa catena deve continuare, chiama agent_next(memo), agent_timeout(seconds, memo)
o agent_event(type, memo) con un memo che descriva il passo successivo.
Se hai finito, non schedulare nulla.
```

Quando l'iterazione è scattata da un evento, il messaggio utente include anche i dati dell'evento:

```
Esegui il memo: {memo}

Evento "{type}" ricevuto:
{data JSON}
```

---

## Prompt di sistema per la prima iterazione (one-shot da smart-chat)

```
Sei l'agente autonomo di WAProxy.

Goal cumulativo attuale:
{goal}

Messaggio dell'admin:
"{message}"

Se il messaggio richiede azioni asincrone o ripetute nel tempo:
  1. Chiama add_goal(description) per registrare il task
  2. Chiama agent_next(memo), agent_timeout(seconds, memo) o agent_event(type, memo)
  3. Rispondi all'admin confermando l'avvio

Se il messaggio è una richiesta sincrona, rispondi direttamente senza chiamare add_goal.
```

---

## Struttura dei file

```
behaviours/
  agent.js        ← classe Agent (singleton), tutti i tool MCP, discovery modelli
  smart-chat.js   ← listener messaggi admin, risoluzione numero, prima iterazione
```

### `agent.js` esporta

```js
// Non un singleton, ma un registry
module.exports = {
    setChat(chat),          // chiama una volta in smart-chat
    getFor(number),         // restituisce (e crea) l'Agent per quel numero
};
```

Ogni istanza `Agent` ha:
- `handleMessage(userMessage)` — one-shot dal listener WhatsApp
- `runIteration(memo, event?)` — iterazione autonoma (timer o evento)
- `scheduleNext(memo)`, `scheduleTimeout(seconds, memo)` — scheduling
- `registerEvent(type, memo)`, `fireEvent(type, data)` — gestione eventi
- `kill(pattern)` — cancella pending per pattern
- `addGoal(description)` — aggiunge al goal cumulativo
- Stato privato: `_number`, `_goal`, `_history`, `_pending`, `_pendingEvents`

La discovery dei modelli (`_candidates`, `_candidateIdx`) è condivisa a livello di modulo.

### `smart-chat.js` fa solo

- Ascoltare `chat.on('message', ...)` per messaggi admin
- Risolvere il numero (LID → numero reale)
- Ottenere l'istanza per quel numero: `agentRegistry.getFor(number)`
- Verificare se c'è un event listener attivo (`agent.fireEvent('message', ...)`) — se sì, il messaggio è consumato dall'iterazione
- Altrimenti chiamare `agent.handleMessage(msg.body)`
