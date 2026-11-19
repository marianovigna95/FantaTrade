# FantaTrade — aggiornamento automatico su Windows + GitHub

Obiettivo: da adesso in poi **i dati si aggiornano da soli ogni martedì mattina**, senza aprire niente.
Il tuo PC serve solo il primo giorno, per caricare il progetto su GitHub. Dopo, il lavoro lo fa GitHub.

Tempo richiesto la prima volta: **15-20 minuti**. Passaggi da fare una volta sola: 6.

---

## Passo 0 — Scarica il progetto

1. Nel workspace scarica **`FantaTrade-con-git.zip`** (è già un repository Git: GitHub Desktop lo riconosce subito). Se hai già estratto l'altro zip, va bene lo stesso: vedi la nota nel Passo 3.
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

   - Con `FantaTrade-con-git.zip` la cartella è già un repository: si apre subito.
   - Con l'altro zip compare l'avviso *"This directory does not appear to be a Git repository. Would you like to
     create a repository here instead?"* → clicca il link **create a repository** → nella schermata che appare
     lascia il nome e il percorso proposti, **togli la spunta a "Initialize with README"** → **Create repository**.
     I file non si perdono: GitHub Desktop aggiunge solo la cartella nascosta `.git`.

3. Per pubblicare hai due strade identiche: il pulsante **Publish repository** nella barra in alto (icona nuvola,
   a destra di "Current repository"), oppure il menu **Repository → Publish repository…**.
   (Se `Repository → View on GitHub` è grigio è normale: finché il repository non è su GitHub quel comando non
   ha niente da aprire. È la conferma che manca solo la pubblicazione.)
   Se non lo vedi: la barra mostra "Commit to main"? Manca il repository → torna al punto 2.
4. Nome: `fantatrade`. Lascia la spunta **Keep this code private** solo se hai scelto il repository privato al Passo 1.
5. **Publish repository** → aspetta che finisca (30-60 secondi) → **View on GitHub**.

---

## Passo 4 — Attiva la pubblicazione (GitHub Pages)

⚠️ **GitHub Desktop (l'app di Windows) non ha Settings né Pages.** Non è un errore tuo: quell'app serve
solo a caricare i file e sincronizzare le modifiche. Tutte le impostazioni stanno sul sito, nel browser:
in GitHub Desktop fai **Repository → View on GitHub** (scorciatoia `Ctrl+Shift+G`), si apre la pagina del
repository nel browser, e da lì **Settings** in alto → **Pages** a sinistra.

⚠️ **Da telefono si fa nel browser, non nell'app di GitHub.** L'app mobile di GitHub non ha le impostazioni
del repository: niente *Settings*, niente *Pages*, niente *Run workflow*. Se sei da telefono apri Chrome/Safari
su `github.com`, accedi e, se il menu non si apre, attiva **"Sito desktop" / "Request desktop site"** dal menu
del browser. Meglio ancora: fai questo passo dal PC, dove GitHub Desktop è già loggato.

Link diretto (sostituisci `TUONOME` con il tuo nome utente GitHub):
**`https://github.com/TUONOME/fantatrade/settings/pages`**


Solo se hai fatto il repository **pubblico**:

1. Nella pagina del repository su github.com: **Settings** (in alto) → nel menu a sinistra **Pages**.
2. Alla voce **Build and deployment → Source** scegli **GitHub Actions** (non "Deploy from a branch").

Se hai fatto il repository privato: salta questo passo.

---

## Passo 5 — Prima esecuzione (la fai partire tu, una volta)

1. Sempre nella pagina del repository: tab **Actions** (link diretto:
   `https://github.com/TUONOME/fantatrade/actions/workflows/aggiorna-pubblica.yml`).
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

Controllo degli indisponibili: nella scheda **Giocatori**, in alto, deve esserci la card
**Indisponibili adesso** con la data di oggi o di ieri. Se c'è, il giro automatico sta funzionando.
Per il dettaglio tecnico apri **`app/avail.json`**: `out` sono gli indisponibili, `lineup` le percentuali
di titolarità.

Controllo dei dati avanzati: nel repository apri **`app/extra_report.txt`**.

- Se c'è scritto `abbinati 300` o simili → gli xG sono arrivati e nella scheda **Giocatori** vedi le colonne
  `xG/90` e `Gol−xG`.
- Nella scheda **Report**, in cima, deve esserci **Formazione consigliata: 3-4-3 · giornata N**:
  è l'undici da schierare secondo le probabili formazioni e gli indisponibili. Se la giornata è
  quella giusta e l'undici ha 11 nomi, il giro automatico ha funzionato.
- Nella tabella **Giocatori** devono esserci le colonne **Schier.** (indice 0-100), **Testate**
  (fantamedia di FantaPazz/Gazzetta/CdS) e **Quota** (quotazione e variazione settimanale).
  Se "Testate" è vuota, il passo `fetch_consensus.py` non è ancora girato: Actions → Run workflow.
- Se la card **Indisponibili adesso** dice "96 giocatori · fantacalcio.it + pianetafanta.it" ha funzionato
  tutto; se dice solo "fantacalcio.it" significa che la seconda fonte era giù in quel momento (l'app funziona
  lo stesso, con qualche rientro stimato in meno).
- Se c'è scritto che la fonte non risponde ("We will come back soon", 403…) → **non è un errore tuo**:
  l'app resta con i dati della settimana prima e le colonne restano nascoste. Riprova martedì dopo.

---

## Passo alternativo — aggiornare i file dal sito, senza GitHub Desktop

Se Desktop fa i capricci, si caricano i file direttamente nel repository:

1. `https://github.com/TUONOME/FantaTrade/upload/main` → trascina dentro **`refresh_data.py`** e **`fetch_avail.py`** → *Commit changes*
2. `https://github.com/TUONOME/FantaTrade/upload/main/.github/workflows` → trascina **`aggiorna-pubblica.yml`** → *Commit changes*

Il file con lo stesso nome viene **sostituito**, non duplicato. Il commit parte da solo e il workflow si riavvia.

---

## Da qui in avanti: niente da fare

Ogni **martedì alle 06:00 UTC (08:00 in Italia)** parte il giro completo; ogni **venerdì alle 15:30 UTC
(17:30 in Italia)** un giro corto che riscarica solo **indisponibili e probabili formazioni** (quelle
cambiano durante la settimana e servono fresche per il weekend). Per controllare che sia vivo:

- tab **Actions** → deve esserci una riga verde ogni settimana;
- se è rossa, apri la riga → il passo con la ✗ → **il messaggio dice quale fonte ha fallito**. L'app non si
  rompe mai: resta sull'ultima versione buona.

Per forzare un aggiornamento prima (per esempio dopo una giornata): **Actions → Aggiorna dati e pubblica → Run workflow**.
Sono 2 minuti e 2 clic.

---

## Se qualcosa non torna

| Sintomo | Cosa fare |
|---|---|
| GitHub Desktop non vede la cartella | controlla di aver **estratto** lo zip, non di averlo solo aperto; oppure usa `FantaTrade-con-git.zip` |
| Non trovo **Publish repository** | la cartella non è ancora un repository Git: nell'avviso di GitHub Desktop clicca **create a repository**, non "Cancel" |
| **Publish repository** è grigio | manca il login: in alto a destra clicca sull'icona dell'omino → **Sign in to GitHub.com** |
| **Commit to main** è grigio anche col messaggio scritto | non ci sono modifiche da salvare: i file copiati non sono finiti nella cartella del repository (spesso sono in una sottocartella). Vedi *Repository → Show in Explorer* e confronta; oppure carica i file dal sito (Passo alternativo qui sotto) |
| **Repository → View on GitHub** è grigio e non si clicca | il repository **non è ancora su GitHub** (esiste solo sul PC): è normale. Nello stesso menu, la voce sopra, c'è **Publish repository…** → clicca quella |
| L'app online dà 404 | Settings → Pages → Source non è "GitHub Actions", oppure aspetta 1-2 minuti dopo il primo run |
| Non trovo **Settings** o **Pages** | sei nell'app del telefono: usa il browser (vedi Passo 4) |
| Il run è verde ma il job **deploy** è rosso | Pages non è attivo: fai il Passo 4. I dati intanto sono già aggiornati nel repository (su repo privato è normale e non blocca niente) |
| Il run è rosso al passo **Salva i dati aggiornati** (`exit code 128`) | Settings → Actions → General → **Workflow permissions** → *Read and write permissions* → Save, poi rilancia |
| Il run dice *refresh_data.py non riuscito* | non è bloccante: lo script riusa le quotazioni già salvate e aggiorna solo le statistiche. Il motivo esatto è scritto in `aggiorna_log.txt` nel repository |
| Il run è rosso al passo *Scarica dati aggiornati* | il sito del listone è giù o ha cambiato pagina: l'app resta valida, si sistema nel workflow |
| Colonne `xG/90` sparite | `app/extra_report.txt` dice il motivo; la fonte Understat era già risultata instabile il 19/11/2026 |
| Manca la card **Indisponibili adesso** | `app/avail.json` non è ancora stato creato: Actions → **Run workflow** una volta. Se il run è verde ma la card non c'è, il sito di Fantacalcio.it ha cambiato la pagina: il resto dell'app funziona come prima |
| Un giocatore è dato fuori ma ha giocato | la fonte si aggiorna in giornata: forzalo tu con il pallino della rosa (✓ / ! / ✕), che ha la precedenza sull'automatico |
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
