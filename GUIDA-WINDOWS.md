# FantaTrade — aggiornamento automatico su Windows + GitHub

Obiettivo: da adesso in poi **i dati si aggiornano da soli ogni martedì mattina**, senza aprire niente.
Il tuo PC serve solo il primo giorno, per caricare il progetto su GitHub. Dopo, il lavoro lo fa GitHub.

Tempo richiesto la prima volta: **15-20 minuti**. Passaggi da fare una volta sola: 6.

---

## Passo 0 — Scarica il progetto

1. Nel workspace scarica **`FantaTrade-per-GitHub.zip`** (pulsante di download).
2. Tasto destro sullo zip → **Estrai tutto** → scegli una cartella facile, per esempio
   `C:\Users\<tuo nome>\Documents\FantaTrade`.
3. Apri la cartella e controlla che dentro ci siano `build.py`, `refresh_data.py`, `fetch_extra.py`,
   la cartella `app` e la cartella (nascosta) `.github`.

⚠️ Non estrarre **dentro** lo zip o in Download con doppio clic: serve una cartella vera, altrimenti
GitHub Desktop non la riconosce.

---

## Passo 1 — Privacy: decidi se il repository è pubblico

Il repository contiene `app/leagues.json`, cioè **i nomi delle tue due leghe, le rose e i crediti spesi**.
Se il repository è pubblico, quei dati sono visibili a chiunque abbia il link.

- **Va bene** (consigliato, è l'unico modo per avere l'app online con un account gratuito) → vai al Passo 2.
- **Non va bene** → due strade:
  - apri `app\leagues.json` con Notepad, sostituisci i nomi veri delle leghe e delle squadre con nomi finti e salva; oppure
  - crea il repository **privato** (Passo 3, casella "Keep this code private" spuntata): l'aggiornamento automatico funziona lo stesso, ma **non** avrai l'app online — scaricherai `fantatrade.html` dal repository quando ti serve.

---

## Passo 2 — Installa GitHub Desktop

1. Vai su **https://desktop.github.com**, scarica e installa (Next, Next, Fine).
2. Aprilo → **Sign in to GitHub.com** → se non hai un account, **Create your free account** (bastano email e password).
3. Alla domanda sul nome e sull'email per i commit: vanno bene quelli proposti, **Next** → **Finish**.

---

## Passo 3 — Carica il progetto su GitHub

1. In GitHub Desktop: menu **File → Add local repository…**
2. **Choose…** → seleziona la cartella `C:\Users\<tuo nome>\Documents\FantaTrade` → **Add repository**.
   Se compare un avviso tipo *"this directory does not appear to be a Git repository"*, clicca
   **create a repository** e poi **Create repository**.
3. In alto a destra premi **Publish repository**.
4. Nome: `fantatrade`. Lascia la spunta **Keep this code private** solo se hai scelto il repository privato al Passo 1.
5. **Publish repository** → aspetta che finisca (30-60 secondi) → **View on GitHub**.

---

## Passo 4 — Attiva la pubblicazione (GitHub Pages)

Solo se hai fatto il repository **pubblico**:

1. Nella pagina del repository su github.com: **Settings** (in alto) → nel menu a sinistra **Pages**.
2. Alla voce **Build and deployment → Source** scegli **GitHub Actions** (non "Deploy from a branch").

Se hai fatto il repository privato: salta questo passo.

---

## Passo 5 — Prima esecuzione (la fai partire tu, una volta)

1. Sempre nella pagina del repository: tab **Actions**.
2. Se compare un avviso, clicca **I understand my workflows, go ahead and enable them**.
3. A sinistra clicca **Aggiorna dati e pubblica** → pulsante **Run workflow** (a destra) → **Run workflow**.
4. Aspetta 2-4 minuti e ricarica: la pallina deve diventare **verde** ✓.

Cosa è successo: ha riscaricato quotazioni e statistiche, ha provato a scaricare gli xG di Understat,
ha ricompilato l'app e ha salvato i dati nuovi nel repository.

---

## Passo 6 — Apri l'app e controlla

- **Repository pubblico:** l'indirizzo è `https://<tuo-username>.github.io/fantatrade/`
  (lo trovi anche in Settings → Pages). Apri, metti tra i preferiti, e sul telefono fai
  *Aggiungi alla schermata Home*: diventa un'icona come un'app.
- **Repository privato:** su github.com apri `fantatrade.html` → pulsante **Download** (icona ⋮ in alto a destra)
  → aprilo col doppio clic.

Controllo dei dati avanzati: nel repository apri **`app/extra_report.txt`**.

- Se c'è scritto `abbinati 300` o simili → gli xG sono arrivati e nella scheda **Giocatori** vedi le colonne
  `xG/90` e `Gol−xG`.
- Se c'è scritto che la fonte non risponde ("We will come back soon", 403…) → **non è un errore tuo**:
  l'app resta con i dati della settimana prima e le colonne restano nascoste. Riprova martedì dopo.

---

## Da qui in avanti: niente da fare

Ogni **martedì alle 06:00 UTC (08:00 in Italia)** parte da solo. Per controllare che sia vivo:

- tab **Actions** → deve esserci una riga verde ogni settimana;
- se è rossa, apri la riga → il passo con la ✗ → **il messaggio dice quale fonte ha fallito**. L'app non si
  rompe mai: resta sull'ultima versione buona.

Per forzare un aggiornamento prima (per esempio dopo una giornata): **Actions → Aggiorna dati e pubblica → Run workflow**.
Sono 2 minuti e 2 clic.

---

## Se qualcosa non torna

| Sintomo | Cosa fare |
|---|---|
| GitHub Desktop non vede la cartella | controlla di aver **estratto** lo zip, non di averlo solo aperto |
| L'app online dà 404 | Settings → Pages → Source non è "GitHub Actions", oppure aspetta 1-2 minuti dopo il primo run |
| Il run è rosso al passo *Scarica dati aggiornati* | il sito del listone è giù o ha cambiato pagina: l'app resta valida, si sistema nel workflow |
| Colonne `xG/90` sparite | `app/extra_report.txt` dice il motivo; la fonte Understat era già risultata instabile il 19/11/2026 |
| Ho sbagliato qualcosa nelle leghe | su Windows: `python import_fantacalcio.py uploads\*_rosters_*.csv` (serve Python), oppure rimetti il file `app\leagues.json` e ricarica con GitHub Desktop |

---

## Extra (facoltativo): provare in locale prima di caricare

Serve solo se vuoi vedere l'app funzionare sul PC senza aspettare GitHub.

1. Installa Python: Microsoft Store → cerca **Python 3.12** → Installa.
2. Apri il **Prompt dei comandi**, poi:
   ```bat
   cd C:\Users\<tuo nome>\Documents\FantaTrade
   python -m pip install -r requirements.txt
   python build.py
   ```
3. Doppio clic su `fantatrade.html`: si apre l'app completa, offline.
