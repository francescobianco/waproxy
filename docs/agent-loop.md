# Agent Loop

Un `Agent` è una singola istanza globale che pilota un loop interrompibile guidato da LLM. Accumula gli obiettivi ricevuti nel tempo e gestisce iterazioni concorrenti identificate da un **memo**.

---

## Istanza unica

Esiste un solo `Agent` per tutta la vita del processo. Ogni messaggio admin non crea un nuovo agent — aggiunge al goal cumulativo e potenzialmente avvia nuove iterazioni.

```
messaggio 1: "manda il timestamp ogni minuto"
messaggio 2: "chiamami tre volte ogni 5 secondi con ciao 1..3"
```

L'agent accumula entrambi gli obiettivi e gestisce le due catene di iterazioni in parallelo, ognuna identificata dal proprio memo.

---

## Goal cumulativo

Il goal non è per-messaggio ma è una stringa che cresce nel tempo:

```
[2026-05-06 10:00] manda il timestamp unix ogni minuto
[2026-05-06 10:03] chiamami tre volte ogni 5 secondi con ciao 1..3
```

Ad ogni iterazione il modello riceve il goal completo per avere il contesto di tutto ciò che è stato chiesto, ma agisce solo su ciò che il **memo** gli indica.

---

## Il memo

`next(memo)` e `timeout(seconds, memo)` ricevono una stringa memo obbligatoria. Il memo:

- identifica a quale comportamento appartiene quell'iterazione
- descrive cosa deve fare quella specifica iterazione
- porta lo stato necessario per quella catena (es. `"ciao 2/3 - dopo 5s"`)

Il memo è il contratto tra un'iterazione e la successiva. Il modello lo legge e sa esattamente cosa fare senza dover ricostruire il contesto dall'intero goal.

---

## Tool MCP self-referenziali

| Tool | Firma | Descrizione |
|---|---|---|
| `agent_next` | `(memo)` | Schedula la prossima iterazione immediatamente |
| `agent_timeout` | `(seconds, memo)` | Schedula la prossima iterazione dopo `seconds` secondi |
| `agent_stop` | `(memo)` | Termina una catena (memo descrive perché) |

Non esiste `agent_set_state` / `agent_get_state`: lo stato di una catena viaggia **dentro il memo stesso**. Il modello scrive nel memo di `agent_timeout` tutto ciò che serve all'iterazione successiva.

---

## Ciclo di vita di una catena

```
messaggio admin: "chiamami tre volte ogni 5 secondi con ciao 1..3"
         │
         ▼
  addGoal(testo)
  agent_next("ciao: step 1/3")
         │
         ▼
┌─────────────────────────────────────┐
│  iterazione — memo: "ciao: step 1/3"│
│                                     │
│  LLM legge goal cumulativo + memo   │
│  → send_whatsapp_message("ciao 1")  │
│  → agent_timeout(5, "ciao: step 2/3")│
└─────────────────────────────────────┘
         │ [attesa 5s]
         ▼
┌─────────────────────────────────────┐
│  iterazione — memo: "ciao: step 2/3"│
│  → send_whatsapp_message("ciao 2")  │
│  → agent_timeout(5, "ciao: step 3/3")│
└─────────────────────────────────────┘
         │ [attesa 5s]
         ▼
┌─────────────────────────────────────┐
│  iterazione — memo: "ciao: step 3/3"│
│  → send_whatsapp_message("ciao 3")  │
│  → agent_stop("ciao: completato")   │
└─────────────────────────────────────┘
```

---

## Iterazioni concorrenti

Due catene possono coesistere. L'agent non le serializza — ciascuna ha la propria timeline:

```
t=0   next("timestamp: iter 1")
t=0   next("ciao: step 1/3")

t=0   → iterazione "timestamp: iter 1"   → timeout(60, "timestamp: iter 2")
t=0   → iterazione "ciao: step 1/3"      → timeout(5,  "ciao: step 2/3")

t=5   → iterazione "ciao: step 2/3"      → timeout(5,  "ciao: step 3/3")
t=10  → iterazione "ciao: step 3/3"      → stop("ciao: completato")
t=60  → iterazione "timestamp: iter 2"   → timeout(60, "timestamp: iter 3")
...
```

---

## Prompt di sistema per ogni iterazione

```
Sei l'agente autonomo di WAProxy.

Obiettivo cumulativo (tutto ciò che ti è stato chiesto):
{goal}

Memo di questa iterazione:
"{memo}"

Esegui esattamente ciò che il memo descrive usando i tool disponibili.
Se la catena deve continuare, chiama agent_next(memo) o agent_timeout(seconds, memo)
con un memo che descriva il passo successivo.
Se la catena è completata, chiama agent_stop(memo).
Non puoi terminare senza chiamare uno di questi tre tool.
```

---

## Struttura dei file

```
behaviours/
  agent.js        ← classe Agent (singola istanza), tool MCP globali + self-referenziali
  smart-chat.js   ← listener messaggi admin, aggiunge al goal, avvia prima iterazione
```

### `agent.js` contiene

- Classe `Agent`: `addGoal(text)`, `scheduleNext(memo)`, `scheduleTimeout(seconds, memo)`, `runIteration(memo)`
- Tool MCP globali (refactored da `smart-chat.js`): `send_whatsapp_message`, `list/create/delete/show_behaviour`, `run_shell_command`
- Tool MCP self-referenziali: `agent_next`, `agent_timeout`, `agent_stop`
- Discovery e selezione modelli
- Contesto conversazione admin (history)

### `smart-chat.js` fa solo

- Ascoltare `chat.on('message', ...)` per messaggi admin
- Risolvere il numero (LID → numero reale)
- Chiamare `agent.addGoal(msg.body)` e `agent.scheduleNext("risposta a: " + msg.body)`

---

## Piano di implementazione

1. Creare `behaviours/agent.js` con la classe `Agent`
2. Spostare in `agent.js` i tool MCP globali e la discovery modelli da `smart-chat.js`
3. Aggiungere tool self-referenziali (`agent_next`, `agent_timeout`, `agent_stop`)
4. Aggiornare il system prompt per istruire il modello sull'uso dei tool di controllo
5. Ridurre `smart-chat.js` al solo listener + delega ad `agent`
6. Esportare un singleton: `module.exports = new Agent(...)`
