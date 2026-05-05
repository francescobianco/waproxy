# Mutable Behaviours

Feature per aggiornare i behaviour di waproxy a runtime tramite chat WhatsApp, senza rebuild né riavvio del container.

---

## Struttura delle cartelle

I behaviour si dividono in due categorie:

```
behaviours/
  index.js              ← carica i behaviour statici + il manager dei mutable
  reply-to-ping.js      ← behaviour statico (immutabile, nel repo)
  web-send.js           ← behaviour statico
  ...
  mutable/              ← behaviour dinamici, modificabili via chat
    saluta-utenti.js
    daily-report.js
    ...
```

Solo i file dentro `behaviours/mutable/` sono soggetti a hot-reload. I behaviour statici vengono caricati una volta sola all'avvio e non vengono mai ricaricati.

---

## Meccanismo di rilevamento cambiamenti: MD5

Ogni behaviour mutable ha associato un **checksum MD5 del proprio sorgente**. Il sistema mantiene in memoria un registro:

```
{ nome → md5_al_momento_del_caricamento }
```

A ogni **trigger di controllo**, il manager ricalcola l'MD5 del file su disco. Se non combacia con quello memorizzato, il behaviour viene:

1. **Distrutto** — rimossi tutti i listener, i cron job e le route registrate
2. **Ricaricato** — eseguito il nuovo sorgente, aggiornato l'MD5 nel registro

Se il file non esiste più, il behaviour viene solo distrutto.

### Trigger di controllo

Il controllo MD5 può essere attivato da:
- **Cron periodico** — es. ogni minuto, configurabile via env var
- **Comando chat** — `/behaviour reload` forza il controllo immediato

---

## Il problema centrale: hot-reload con pulizia

Per poter distruggere un behaviour senza residui, ogni registrazione deve essere tracciata. Il `BehaviourManager` passa ai behaviour **proxy degli oggetti** `chat`, `web` e `cron` che intercettano e memorizzano ogni registrazione:

```
BehaviourManager
  ├── load(name)         → legge il file, calcola MD5, esegue con proxy tracciati
  ├── unload(name)       → rimuove listener, distrugge cron, resetta router
  ├── reload(name)       → unload + load se MD5 cambiato
  ├── check()            → controlla tutti i file in mutable/, rileva aggiunte/modifiche/rimozioni
  └── list()            → nomi e MD5 dei behaviour attivi
```

Cosa viene tracciato per ogni behaviour:
- **`chat.on(event, fn)`** → rimosso con `chat.off(event, fn)`
- **`cron.schedule(...)`** → distrutto con `task.destroy()`
- **Route Express** — montate su un sub-router dedicato al behaviour; il router viene sostituito al reload

---

## Protocollo chat

Flusso di interazione via WhatsApp per gestire i behaviour dinamici:

```
/behaviour list
> Attivi: saluta-utenti (a1b2c3), daily-report (d4e5f6)

/behaviour create saluta-utenti
> Pronto. Invia il codice JS, poi /behaviour save

[codice JS in un messaggio]

/behaviour save
> Behaviour "saluta-utenti" salvato. MD5: 7f3a... → ricaricato.

/behaviour reload
> Controllo MD5 completato. Ricaricati: saluta-utenti. Invariati: daily-report.

/behaviour show saluta-utenti
> [sorgente corrente del file]

/behaviour delete saluta-utenti
> Behaviour "saluta-utenti" distrutto e rimosso.
```

---

## Persistenza

I file in `behaviours/mutable/` sono salvati nel volume Docker `/var/waproxy/data/behaviours/mutable/` (o percorso configurabile via env). All'avvio, il manager carica tutti i file presenti e popola il registro MD5 — il sistema riparte sempre dallo stato persistito.

---

## Sicurezza

Questo meccanismo equivale a **RCE autorizzata via WhatsApp** — chiunque possa inviare messaggi al numero potrebbe iniettare codice arbitrario. Misure obbligatorie:

- **Whitelist di numeri autorizzati** configurata via env var `WAPROXY_ADMIN` (lista separata da virgola)
- Ogni comando `/behaviour *` viene ignorato silenziosamente se il mittente non è in whitelist
- Valutare `vm.runInContext()` con sandbox vs. `new Function()` nel processo principale

---

## Piano di implementazione

1. `behaviours/mutable-manager.js` — il `BehaviourManager` con proxy di tracciamento e logica MD5
2. Cron di controllo periodico (env `WAPROXY_MUTABLE_CHECK_INTERVAL`, default `* * * * *`)
3. Behaviour `behaviours/mutable-chat.js` — gestisce i comandi `/behaviour *` via chat
4. All'avvio, `behaviours/index.js` carica il manager e fa un primo `check()` per popolare il registro