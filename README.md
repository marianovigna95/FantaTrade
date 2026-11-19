# FantaTrade — consigli sugli scambi di fantacalcio

Sì, si può fare — e questo è un prototipo funzionante: **un'unica pagina web** (nessun server, nessuna installazione) che valuta gli scambi di fantacalcio e propone scambi vantaggiosi per entrambe le squadre, usando **dati reali della Serie A 2026/27** aggiornati al 15/11/2026.

**Deliverable:** `fantatrade.html` — aprilo con un doppio clic nel browser. Funziona anche offline.

---

## Cosa fa

| Scheda | A cosa serve |
|---|---|
| **Lega** | Tutte le rose di una o più leghe. **Importa l'export CSV di Fantacalcio.it** (contiene gli id ufficiali: abbinamento esatto, nessun confronto di nomi) e porta dentro rose e **crediti spesi all'asta**. Da qui scegli qual è la tua squadra, vedi la spesa di ogni squadra, chi sei scoperto per ruolo e chi ti alzerebbe l'undici, con quanti punti in più. |
| **Analizza scambio** | Inserisci la tua rosa e quella dell'avversario, clicca chi dai e chi ricevi: ottieni subito il giudizio (+/- punti a giornata per entrambi), il motivo per farlo e quello per non farlo, il conguaglio in crediti se lo scambio è sbilanciato, e la tabella di confronto (fatto / proiezione / attesa, punti, sopra rincalzo). Nessun prezzo d'asta nel valore: conta solo quanto rendono. |
| **Report** | La tua squadra sotto esame: posizione in lega per punti attesi, undici reparto per reparto con il titolare più debole evidenziato e il margine recuperabile, **chi rischia la panchina** (titolari con probabilità di giocare sotto il 62%), classifica completa con distacco, e **offerte pronte** per ogni avversario (scambio pari-ruolo win-win + messaggio da copiare e incollare in chat, con "Analizza" e "Applica"). Si ricalcola da solo quando le rose cambiano. |
| **Trova scambi** | Il motore prova tutte le combinazioni 1 vs 1 e 2 vs 2 fra le rose e mostra solo quelle in cui **entrambe le squadre migliorano l'undici titolare** (win-win). Con *tutte le squadre della lega* gira su ogni avversario e ti dice a chi proporre cosa; con *scambi pari ruolo* accetta solo scambi con gli stessi ruoli da entrambe le parti (1 difensore per 1 difensore, non 1 difensore per 1 attaccante). |
| **Giocatori** | Tabella completa e ordinabile dei **603 giocatori del listone ufficiale** Fantacalcio.it: presenze, minutaggio %, fantamedia (fatto), proiezione (farà), attesa, punti attesi a giornata, valore sopra il rincalzo, forma, tendenza e facilità del calendario. |
| **Come funziona** | Metodo, formule, limiti e fonti. |

Ogni giocatore nelle due rose ha un pallino di stato: **✓ disponibile / ! in dubbio / ✕ fuori**. Cambia la probabilità di prendere il voto, quindi punti attesi, giudizio e ricerca degli scambi si aggiornano subito (es. Rabiot 7,74 → 6,96 in dubbio → 6,11 out). Lo stato viene salvato con le rose nel link e nel backup.

Funzioni pratiche: **incolla la tua rosa** (testo libero, riconoscimento dei nomi con correzione degli errori), rose di esempio pronte, **rose salvate nel browser** (le ritrovi al riavvio), impostazioni di lega (numero squadre, modulo, giornate rimaste), "applica scambio" per simulare la rosa dopo l'affare.

Ogni analisi si chiude con due elenchi ragionati: **perché conviene** e **perché non conviene** (impatto sull'undici, reparti, ruoli che restano scoperti, calendario, fantamedia attesa, valore di mercato, numero di giocatori scambiati).

## Come valuta uno scambio (in breve)

1. **Punti attesi a giornata** di ogni giocatore:
   `Pt/g = P(gioca) × fantamedia + (1 − P(gioca)) × 6,0`
   dove la fantamedia reale è "compressa" verso l'attesa iniziale (dedotta dalla quotazione ufficiale) quando i minuti giocati sono pochi, e `P(gioca)` combina continuità di presenze e minutaggio reale (minuti/90 per presenza — uso i minuti perché il campo "partite da titolare" delle fonti è incoerente).
2. **Scarsità di ruolo:** non conta il valore assoluto ma quello **sopra il rincalzo** — il livello del giocatore che chiude il reparto in una lega con N squadre e un dato modulo. È ciò che rende confrontabili un attaccante e un difensore.
3. **Simulazione:** calcola il miglior undici possibile (nel modulo scelto) prima e dopo lo scambio per entrambe le squadre; il giudizio è la differenza di punti attesi. Nessun conguaglio: per riequilibrare si aggiunge o si toglie un giocatore.
4. **Calendario:** per ogni squadra e ruolo calcolo la difficoltà delle prossime N giornate (default 5) dalla forza offensiva/difensiva degli avversari + bonus casa, e correggo i punti attesi di ciascun giocatore. Si può escludere con l'interruttore in alto.
5. **Rispetto a cosa:** il guadagno dell'undici viene confrontato, ruolo per ruolo, con il **massimo che le altre squadre della lega ti darebbero** con un altro scambio (e, nella finestra dell'asta di riparazione, con quello che ti darebbero gli **svincolati**). Un miglioramento che puoi ottenere anche altrove non è un buon argomento per chiudere una trattativa (dettagli nella sezione *Il concorrente di uno scambio è un altro scambio*).
6. **Fantamedia attesa:** fantamedia 2026/27 + storico delle stagioni passate (pesato) + attesa della quotazione, corretta dal momento delle ultime 3 partite; l'etichetta ↗ / → / ↘ dice chi è dato in crescita, stabile o in calo.

## Uso quotidiano senza hosting (consigliato)

Apri `fantatrade.html` con un doppio clic: funziona offline, senza account e senza deploy.
Le due rose si conservano in tre modi indipendenti:

| Modo | Come | Quando usarlo |
|---|---|---|
| Memoria del browser | automatica | uso normale sullo stesso computer/telefono |
| Link con le rose dentro | pulsante **Copia link** → metti la URL nei preferiti (o la mandi all'amico della lega) | ritrovare tutto in un clic, anche da un altro dispositivo |
| File di backup | **Esporta rose** → `fantatrade-rose.json`, poi **Importa rose** | passare da un browser all'altro, o se il browser blocca il salvataggio |

Nota: da `file://` alcuni browser (Chrome) bloccano la memoria locale e la modifica dell'URL: in quel caso
usa Esporta/Importa, che funziona sempre.

## Pubblicare online (2 minuti)

`python3 build.py` genera la cartella **`dist/`** pronta da caricare su qualunque hosting statico:

```
dist/
  index.html            l'app + meta tag social, favicon e theme-color
  og.png                anteprima 1200x630 per la condivisione (WhatsApp, Telegram, X…)
  apple-touch-icon.png  icona per iOS
  manifest.webmanifest  nome, icone e colori per installarla come app
  sw.js                 service worker: apertura offline e aggiornamento in sottofondo
  icon-192/512/maskable  icone PWA
  _headers              cache e header di sicurezza (li legge Netlify)
  robots.txt
```

Su Netlify basta trascinare `dist/` in **Sites → Add new site → Deploy manually**, oppure da terminale
`netlify deploy --dir=dist --prod`.

La versione in `dist/` è una **PWA**: dal telefono si apre il link e si sceglie *Aggiungi a schermata Home*.
Da lì parte a schermo intero, con l'icona, e funziona anche senza connessione (il service worker tiene
in cache la pagina). È il modo più comodo per usarla ogni settimana senza cercare link o rifare deploy:
scarichi l'icona una volta e la usi come un'app. Quando pubblichi una nuova versione, cambia `VERSION`
dentro `sw.js` (in `build.py`) per forzare l'aggiornamento della cache. In alternativa Cloudflare Pages o GitHub Pages (stessa cosa: trascini `dist/`).

### Pubblica una volta, poi si aggiorna da solo

Se lo metti su GitHub Pages, il workflow `.github/workflows/aggiorna-pubblica.yml` è già pronto:
ogni lunedì riscarica le statistiche, ricompila l'app e ripubblica. Passi una volta sola:

1. crea un repository con tutti i file del progetto;
2. *Settings → Pages → Source: GitHub Actions*;
3. *Actions → Aggiorna dati e pubblica → Run workflow* (la prima esecuzione pubblica il sito).

Da lì in poi i dati si aggiornano senza toccare nulla. Lo stesso workflow si può copiare su Netlify
(`netlify deploy` al posto di `deploy-pages`) se preferisci restare lì.

⚠️ **Attenzione all'access control**: se il sito risponde `401` con una pagina "Login Redirect",
la pubblicazione è protetta. Si sblocca in *Site configuration → Access & security → Visitor access → Public*
(e, se il sito è in un team con SSO, va disattivata la protezione del team, non solo del sito).

## File del progetto

```
fantatrade.html      ← l'app (autonoma: CSS, JS e dati incorporati)
app/
  model.js           motore di valutazione (funzioni pure, testabile con node)
  ui.js              interfaccia
  styles.css         stile
  ui.html            markup
  data.json          603 giocatori: ruolo, squadra, QA/QI/FVM ufficiali, statistiche 2026/27,
                     storico stagioni e ultime 6 partite
  context.json       calendario 38 giornate, forza offensiva/difensiva delle 20 squadre
  leagues.json       leghe importate dagli export di Fantacalcio.it (rose + crediti spesi)
import_fantacalcio.py  converte gli export CSV delle rose in app/leagues.json
build.py             ricompila fantatrade.html partendo da app/
refresh_data.py      riscarica quotazioni e statistiche e ricompila
fetch_extra.py       scarica i dati avanzati (xG, tiri) da solo e li importa
import_extra.py      import manuale di xG/infortuni da CSV o JSON
aggiorna.sh          i tre passaggi in fila, tollerante agli errori (per cron/launchd)
.github/workflows/   aggiornamento settimanale automatico su GitHub (Actions)
```

### Aggiornare i dati (automatico, una volta a settimana)

Non serve fare niente a mano. L'aggiornamento gira **da solo ogni martedì alle 8:00**:

- se il progetto è su GitHub, lo fa `.github/workflows/aggiorna-pubblica.yml` (tab **Actions** → *Run workflow* per forzarlo ora), e ripubblica anche l'app su Pages;
- se lo tieni solo in locale, lo fa `aggiorna.sh` lanciato da cron:

```bash
crontab -e
0 8 * * 2  cd /percorso/di/fantatrade && ./aggiorna.sh >> aggiorna.log 2>&1
```

`aggiorna.sh` fa in fila `refresh_data.py` → `fetch_extra.py` → `build.py` e **non si ferma se una fonte è giù**: se Understat non risponde, i dati avanzati restano quelli di prima e l'app si costruisce lo stesso. Per sapere com'è la situazione senza toccare niente: `./aggiorna.sh --check`.

A mano, se serve:

```bash
pip install beautifulsoup4 lxml
./aggiorna.sh                    # tutto (~2 minuti)
python3 refresh_data.py          # solo quotazioni + statistiche
python3 fetch_extra.py           # solo xG + tiri (poi ricompila)
```

Lo script legge il **listone ufficiale di Fantacalcio.it** (603 giocatori: ruolo classico, squadra, quotazione iniziale QI, quotazione attuale QA, FVM, id) e le statistiche della stagione in corso da fantacalcio.dev, incrocia i nomi (575 abbinati al primo colpo, altri recuperati su un secondo candidato quando ci sono omonimie o iniziali; i casi particolari stanno in `MANUAL_SLUGS`) e riscrive `app/data.json`. La quotazione serve solo come *a priori* per chi ha giocato pochissimo. Chi non ha ancora giocato resta in archivio lo stesso: è scambiabile dal primo giorno.

## Limiti attuali (dichiarati anche nell'app)

- Non conosce **infortuni e squalifiche** in tempo reale: il valore di un giocatore fuori uso è sovrastimato.
- Non prevede le **probabili formazioni** (la titolarità è stimata da presenze e minuti). Il calendario c'è, ma la forza delle squadre è stimata sui gol fatti/subiti attuali.
- Ruoli **classici** (P/D/C/A): le leghe **mantra** (12 ruoli) non sono gestite.
## Importare le tue leghe

1. Su Fantacalcio.it, nella lega: **esporta le rose** (file `*_rosters_*.csv`, righe `Squadra,id_giocatore,crediti`).
2. Nell'app: scheda **Lega** → *Importa rose CSV di Fantacalcio.it* e scegli il file (una lega per file).
   Da riga di comando: `python3 import_fantacalcio.py uploads/*_rosters_*.csv` e poi `python3 build.py` per incorporarle nella pagina.

Gli id del CSV sono gli stessi del listone ufficiale, quindi l'abbinamento è esatto. I **crediti spesi all'asta** diventano i prezzi della lega: i conguagli consigliati sono nella valuta vera della tua lega, non in un indice astratto. Per i giocatori svincolati il valore è stimato con la scala della lega (quotazione ufficiale × moltiplicatore).

## Il futuro pesa più del passato

A stagione in corso il dato che conta non è quanto un giocatore ha reso, ma quanto renderà. Il fantavoto è la somma di due componenti con affidabilità molto diversa:

- il **voto** (quanto gioca e come gioca): stabile, si stabilizza in poche partite (compressione verso il ruolo con K = 4 presenze); anche *in forma / in calo* si misura sul voto, non sul fantavoto;
- i **bonus** (gol e assist): pochissimi eventi, quindi molto rumorosi; su 8-10 partite un "3 gol in 4 gare" è in gran parte fortuna (compressione con K = 16 presenze).

La fantamedia proiettata somma voto atteso + bonus attesi, entrambi compressi verso la mediana del ruolo (calcolata sui dati caricati, non fissata a mano). Chi ha pochi minuti viene ancorato anche all'attesa iniziale dedotta dalla quotazione, così una riserva con tre presenze non diventa un titolare medio. Poi:

```
attesa = (1 - prospettiva) * fantamedia_fatta + prospettiva * fantamedia_proiettata
```

La **prospettiva** è uno slider in alto (default 65% futuro; 0% = solo dato di fatto, 100% = solo proiezione): muovendolo si ricalcolano punti attesi, giudizi, offerte e classifica. Effetto tipico sui dati attuali: Varela (9 gol in 10 partite) scende da 8,57 a 8,06 di proiezione, un attaccante a secco con 7 di media voto sale.

## Calendario: forza delle squadre e peso della prossimità

- **Forza delle squadre** (`teamRates`): gol fatti/subiti per partita compattati verso la media del campionato, con k = 6 partite di prior. Con 11 giornate il dato grezzo è troppo rumoroso.
- **Facilità di una partita** (`matchEase`): dipende dal ruolo — attaccanti vs quanto concede l'avversario, difensori/portieri vs quanto segna (con damping 0,85), centrocampisti 60/40 — più vantaggio casalingo (±0,035).
- **Prossime N giornate** (`scheduleEase`): media pesata con decadimento 0,88 per giornata: la prossima conta più di quella fra due mesi.
- **Scala leggibile** (`calPct` nella UI): la facilità di periodo è convertita in percentile sulle 20 squadre di Serie A, così 50 = media. Senza questa normalizzazione tutti i valori stavano tra 45 e 55 e i colori non dicevano nulla.
- **Dove si vede**: colonna *Calendario* della tabella giocatori, pannello **Il tuo calendario** nel Report (una riga per titolare: prossima avversaria, campo, facilità del periodo) e voce "calendario" nel perché sì / perché no dello scambio.

## Conguaglio in crediti

Quando lo scambio non è pari, l'app dice **chi** deve mettere crediti e **quanti**: differenza di punti a giornata × valore di un punto, arrotondata a 5. Il valore del punto non è inventato: è la pendenza della retta "crediti pagati ~ punti attesi" stimata sui prezzi realmente sborsati all'asta nella lega importata (≈ 55-60 cr per punto a giornata), corretta col livello dei giocatori scambiati (`creditRateLevel`: fino a ×2 sui top, ×0,7 sui rincalzi) perché il mercato è convesso — l'attenuazione è voluta, la curva esponenziale sui dati ha R² 0,23. Serve un solo numero, calcolato dai dati della lega (`M.creditRate`).

- Il motore (`findTrades`) restituisce **due liste con quota separata** (`limit` per i win-win, `limitB` per quelli compensati): se fossero in un'unica classifica i secondi non comparirebbero mai, perché sono sempre dietro di punti. Le proposte compensate hanno `compensated: true`.
- Attivabile con l'interruttore *conguaglio in crediti* (acceso di default): compare nel giudizio, nelle offerte pronte e nel messaggio da copiare; applicando lo scambio i saldi si aggiornano.
- Saldo di ogni squadra = **budget d'asta − spesa** (budget stimato dall'import come spesa mediana arrotondata a 250, correggibile a mano nella scheda Lega). L'app avvisa se il conguaglio supera i crediti disponibili.
- Su Fantacalcio.it lo scambio è solo di giocatori: i crediti sono un patto di lega, l'app li tiene come conto.

## Pesi stimati sui dati (split-half)

`K_VOTO` e `K_BONUS` non sono fissati a mano. Per ogni giocatore il log delle ultime partite viene diviso in due metà; la correlazione fra le due metà (364 giocatori) dà l'affidabilità a metà campione, che corretta con Spearman-Brown dà quella a campione pieno. Da lì il K implicito di una compressione `n/(n+K)`:

| grandezza | r split-half | K implicito | valore usato |
|---|---|---|---|
| voto | 0,27 | ≈ 7,6 | **7,5** |
| bonus (gol+assist) | 0,16 | ≈ 14,9 | **15** |

Il voto è affidabile circa il doppio più in fretta del bonus, misurato e non ipotizzato.

## Leva negoziale (`teamNeed`)

Se all'altro manca proprio il ruolo che riceve — il suo titolare più debole lì è molto sotto il giocatore in arrivo, o è scoperto — ha meno alternative. L'app lo misura (`need` 0..1) e lo usa per correggere il conguaglio: **+60%** se paga lui, **−50%** se paghi tu; nelle offerte compare l'etichetta *gli serve C*.

## Scambi da pareggiare con i crediti

Il motore non chiede più che **entrambi** guadagnino punti: con `minGainB` accetta anche scambi in cui l'altro perde (fino a −0,45 pt/g) purché i crediti compensino, e li marca `compensated`. Nel Report escono in una sezione separata (*Da pareggiare con i crediti*), con il conguaglio già calcolato. È il caso classico "campione per due buoni giocatori + crediti", che prima era invisibile.

## Probabili formazioni incollate

Le probabili formazioni non si possono scaricare da soli in un file HTML offline: cambiano fino a un'ora prima e ogni sito le pubblica a modo suo. Per questo ci sono due strade, e solo la prima funziona senza internet:

1. **Incolla** (implementata): pulsante *Probabili formazioni* → `parseProbabili` riconosce righe tipo `Roma (3-4-2-1): Svilar; Mancini, N'Dicka, …`, anche con percentuali (`Svilar 65%`). Chi è in lista → `certo`; chi in quella squadra gioca di solito (≥3 presenze) e non è in lista → `dubbio`; sotto il 55% → `dubbio`. Gli stati finiscono in `state.avail` e da lì in `statusManual`, quindi tutto ricalcola. *Azzera tutti gli stati* riporta a disponibile.
2. **Script di aggiornamento** (non implementata): `refresh_data.py` gira sul computer con internet e ricompila il file — potrebbe scaricare le probabili formazioni e cucirle dentro. Non l'ho fatto perché dipende da un sito che cambia formato e dalla volontà di lanciare un comando prima di ogni giornata; l'incolla fa la stessa cosa in dieci secondi.

## Copia riepilogo

Pulsante nel Report: genera un testo (posizione, reparti, punto debole, calendario, prime tre offerte con conguagli) da incollare in chat.

## Annulla scambio

`applyTrade` salva prima una fotografia di rose, crediti e spese (ultime 5): il pulsante *Annulla scambio* (scheda Analizza scambio e offerte del Report) ripristina tutto. Senza undo l'unico rimedio a un errore era reimportare i CSV.

## Migliori svincolati

Nel Report: per ogni ruolo, i giocatori liberi in lega (nessuno li ha in rosa, ≥ 3 presenze) ordinati per punti attesi, con il **guadagno** che darebbero al tuo undici (differenza col tuo titolare più debole in quel ruolo). Serve dopo uno scambio che ti lascia corto in un reparto, e come termine di paragone per qualsiasi trattativa.

## Dati avanzati: xG e storico infortuni

Due dati che il listone non ha e che cambiano le previsioni: **quanto tira** un giocatore (gol attesi) e **quanto si rompe**. L'app li accetta, li usa solo se ci sono, e non li inventa mai.

### Cosa serve da fuori

| dato | fonte | come |
|---|---|---|
| xG / npxG / tiri / tiri in porta | **Understat** | una sola pagina per lega (`/league/Serie_A/<anno>`), i dati sono in un JSON dentro l'HTML (`playersData`) |
| idem (alternativa) | **FBref** | tabella *Shooting* → *Share & Export → CSV*; gli script diretti vengono bloccati (403), l'export manuale funziona |
| storico infortuni | **Transfermarkt** | pagina *Verletzungen* del giocatore: tipo, da/a, giorni fuori |
| storico infortuni (alternativa) | i tuoi appunti / Transfermarkt per squadra | basta un CSV con i giorni fuori |

### Come si importa

**xG: automatico.** `fetch_extra.py` legge la pagina Understat della Serie A, estrae il blocco `playersData` (JSON dentro l'HTML), tiene chi ha almeno 180 minuti e abbina per **cognome + squadra**, con l'iniziale quando serve (`Konè M.` ↔ `Manu Koné`). Nomi senza iniziale nel listone (`Pulisic`, `Krstovic`) vengono riconosciuti lo stesso; i doppi cognomi (`Kevin Carlos`) sono provati in tutte le forme. Chi resta fuori **non viene indovinato**: finisce in `app/extra_report.txt` e si sistema una volta sola con un `sid` esplicito in `import_extra.py`.

```bash
python3 fetch_extra.py                        # scarica, importa, ricompila
python3 fetch_extra.py --dry-run              # mostra gli abbinamenti, non scrive
python3 fetch_extra.py --source fbref_csv --file shooting.csv   # CSV esportato da FBref
python3 fetch_extra.py --from-file pagina.html                  # file già scaricato
cat app/extra_report.txt                      # abbinati e non riconosciuti
```

**Infortuni: due volte l'anno, a mano.** Transfermarkt blocca gli script (challenge 202) e i giorni fuori non stanno in nessuna API libera: il CSV resta l'unico modo pulito. Si fa a inizio stagione e a gennaio, non ogni settimana.

```bash
python3 import_extra.py extra_template.csv --dry-run   # report, non scrive
python3 import_extra.py extra_template.csv             # scrive in app/data.json e ricompila
python3 import_extra.py --report                       # quanti hanno i dati
python3 import_extra.py --reset                        # toglie tutto e torna com'era
```

Colonne del CSV (le trovi in `extra_template.csv`):

```
sid,nome,squadra,npxg,xg,shots,sot,inj_days,inj_episodes
,Konè M.,Roma,2.6,3.0,18,7,42,2
```

L'identificativo è `sid` (l'id Fantacalcio, la chiave affidabile: sta in `app/data.json`); se manca, lo script prova `nome + squadra` normalizzati (accenti, maiuscole, punteggiatura). **Ambigui e non trovati vengono saltati e stampati**: meglio un buco che un dato attribuito al giocatore sbagliato.

### Cosa fa il modello con questi dati

**xG → bonus proiettato.** `xgBonusPerMatch` calcola i bonus attesi dai tiri (`xG/90 × 3 + assist/90 × 1` × quota minuti) e `projectedFm` lo miscela al bonus dei gol veri con peso `CFG.W_XG = 0,45`, ridotto da un fattore di fiducia basato sui minuti. Effetto su dati di prova: Malen (8 gol con 5,0 di xG) scende da 8,33 a 8,27; Kvernadze (3 gol con 5,2 di xG) sale da 7,25 a 7,33. Il `projection()` esistente continua a dire "in crescita / in calo" ma ora con un motivo che non è solo il prezzo.

**Infortuni → disponibilità attesa.** `injuryProfile` divide i giorni fuori (ultime due stagioni) per 730: ne esce `perGw`, la percentuale di giornate che quel giocatore ha passato ai box. In `playProb` questo prior **può solo abbassare** la disponibilità calcolata su questa stagione (`K_INJ = 0,35`), mai alzarla: chi ha già giocato tanto non diventa più affidabile perché due anni fa stava bene. Chi si è fermato 42 giorni in due stagioni si vede scritto *"42 giorni fuori in 2 stagioni (2 episodi)"* e, sopra il 15%, una riga nei *contro* dello scambio.

**Dove si vedono:** colonne `xG/90`, `Gol−xG`, `Rischio inf.` nella scheda Giocatori (compaiono **solo** se i dati ci sono), riga di profilo nella tabella di confronto degli scambi, riga nei *contro* quando la fragilità è alta.

### Validazione, prima di fidarsi

Con i dati veri va rifatto quello che abbiamo fatto per voto e bonus (split-half): la fantamedia delle giornate successive è prevista meglio da `xG/90` o da `gol/90`? Se il guadagno non c'è, `W_XG` va abbassato. Stessa logica per `K_INJ`: se il prior sugli infortuni peggiora la previsione di disponibilità, va a zero.

**Cadenza:** xG ogni settimana insieme a `refresh_data.py` (automatico); infortuni a inizio stagione e a gennaio. **Regola:** se i campi mancano, restano nulli e l'app non mostra nulla — nessun numero stimato senza fonte.

**Perché non tutto da solo:** le fonti gratuite che non bloccano gli script sono poche. Understat è l'unica affidabile per gli xG, e ogni tanto sparisce (nell'estate 2026 la pagina di lega era un segnaposto "We will come back soon"): per questo la pipeline ha tre livelli — fetch diretto, CSV esportato a mano, dati precedenti che restano in piedi — e in nessun caso la build si rompe.

## Titolarità, ballottaggi, "panchinaro di chi"

Tre delle cose che contano davvero in uno scambio non sono nei numeri del listone: chi gioca, chi gli contende il posto e quanto è fragile. Le ricavo dai dati che ci sono (`pres`, `min`, `tit`, club e ruolo), senza inventare nulla.

**`starterProfile(pool, id)`** — profilo del giocatore:

| etichetta | quando |
|---|---|
| `titolare fisso` | ≥ 72% dei minuti a partita **e** ha giocato ≥ 70% delle giornate, senza rivali vicini |
| `titolare in ballottaggio` | come sopra, ma un compagno di club/ruolo gli sta a ≤ 0,35 pt/g (con ≥ 300 minuti giocati) |
| `titolare a intermittenza` | ≥ 72% dei minuti ma ha già saltato più del 30% delle giornate |
| `mezza partita` | 40-72% dei minuti (entra spesso a gara in corso) |
| `primo cambio` / `riserva` | < 40% dei minuti e c'è uno davanti (`aheadOf`) |
| `mai visto` | zero presenze |

**`clubCompetition(pool, id)`** — confronta il giocatore con i compagni **dello stesso club e dello stesso ruolo**, ordinati per punti attesi: `ahead` (chi sta davanti) e `behind` (chi preme dietro). Il "panchinaro di chi" è esattamente `aheadOf`: *"primo cambio dietro a Zaccagni"*.

**`bonusPer90(p)`** — (gol + assist) / (minuti/90). È il surrogato onesto della **media tiri**: i tiri non sono nel listone ufficiale, e inventarli sarebbe peggio che non averli. Chi ha 1,37 bonus/90 (Malen) è un giocatore che produce anche quando non segna.

**`absenceRate(p)` / `missed`** — giornate saltate su quelle disputate. **Non è una probabilità di infortunio**: quella non esiste come dato pubblico per giocatore, e un numero inventato sarebbe esattamente ciò che abbiamo eliminato dal resto dell'app. È fragilità *osservata*.

Dove finiscono:

- **tabella di confronto** dello scambio: sotto il nome, `titolare fisso · ballottaggio con Pulisic · 2 giornate saltate · 1,22 bonus/90`;
- **"perché non conviene"**: righe nuove tipo *"Konè M. è in ballottaggio con Pisilli — oggi vale 6,66 contro 6,47: se il posto lo perde scende verso 6,47, un rischio che i punti attesi non prezzano"*;
- **offerte pronte**: chip `ballottaggio` / `titolare sicuro` sul giocatore che entra nell'undici, e **spareggio**: a parità di guadagno (entro 0,05 pt/g) vince la proposta con meno giocatori a rischio;
- **scheda Giocatori**: colonna `Profilo` (ordinabile), con il dettaglio nel tooltip.

## Spiegazioni concrete (nomi, non decimali)

Il verdetto non dice solo "+0,44 pt/g": quello è il motore, non la spiegazione. In cima compare una frase **in parole povere** generata da `plainLead(res)` in `app/ui.js`:

> *In parole povere: Konè M. prende il posto di Koopmeiners a centrocampo — gioca il 77% dei minuti contro il 59%, e finora ha fatto 2 gol e 0 assist contro 1 gol e 1 assist. Tradotto in classifica: circa 12 punti in più nelle 27 giornate, e allarghi il margine su BERLUSCA DORTMUND.*

Sotto, il riquadro **Cosa succede davvero** (`concretePanel`):

- i due **undici a confronto** (`poolByRole` + slot del modulo), con le pedine nuove evidenziate;
- **chi entra al posto di chi** con i fatti che contano per la domenica: presenze, % dei minuti, gol e assist (`factsOf`);
- il **primo cambio dalla panchina** prima/dopo per ogni reparto toccato: è la misura vera del rischio;
- **cosa cambia in classifica**: punti teorici (`dA × giornate rimaste`) e confronto con la squadra immediatamente sopra (`strengths()`), cioè se lo scambio ti fa passare davanti o di quanto resti dietro;
- **cosa succede a lui**, in una riga.

Anche il **messaggio da copiare** (`offerMessage`) è ora concreto, non un elenco di pacchetti:

> *Ciao! Ti propongo: Atta + Adams C. per Romero D. + Konè M.*
>
> *Per te: entra Adams C. al posto di Romero D. in attacco (Adams C.: 9 presenze su 11, 76% dei minuti con 4 gol — Romero D.: 9 presenze su 11, 55% dei minuti con 2 gol).*
> *Per me: entra Konè M. al posto di Koopmeiners a centrocampo.*
> *Nell'undici titolare ci guadagniamo entrambi: +0,38 pt/g per te, +0,44 per me (sono circa 10 e 12 punti nelle 27 giornate che restano).*
>
> *Punti attesi a giornata: Atta 6,11 + Adams C. 7,00 contro Romero D. 6,54 + Konè M. 6,66.*

`swapsForOpp` calcola chi entra nell'undici dell'altro se accetta (`swapsOf` sulla sua rosa), `swapSentence` costruisce la frase con i fatti veri (presenze, minuti, gol). Anche la scheda **Trova scambi** mostra sotto ogni proposta `a te: entra X al posto di Y` e `a lui: entra Z al posto di W`, così si capisce il senso di ogni combinazione prima di aprirla.

Le voci *Perché conviene / non conviene* vengono arricchite a posteriori: `concreteName()` riconosce le righe "Guadagni/Perdi X pt <reparto>" e ci attacca i nomi ("— Konè M. al posto di Koopmeiners"), sostituendo la descrizione generica con il cambio dalla panchina. Nelle **offerte pronte** ogni card mostra `entra X per Y`, calcolato con `xiSwapsFor`.

## Il concorrente di uno scambio è un altro scambio

Il primo criterio ordinava gli scambi per guadagno **lordo**. Due buchi: (1) un guadagno di 0,05 pt/g vale 1,4 punti su 27 giornate, cioè niente; (2) non diceva **rispetto a cosa**.

**Cosa c'è davvero sul mercato, oggi.** Nel fantacalcio gli svincolati si possono tesserare solo all'**asta di riparazione** (febbraio): per il resto della stagione le rose sono chiuse, quindi l'unica alternativa a uno scambio è **un altro scambio**. L'app lo sa: `CFG.FREE_WINDOW = {fromMonth:0, fromDay:20, toMonth:1, toDay:20}` (20 gennaio – 20 febbraio) e `freeWindowOpen()` in `app/ui.js` accendono il confronto col mercato libero **solo in quella finestra**. Fuori, l'interruttore *confronta con gli svincolati* parte spento.

**Il confronto che vale tutto l'anno** (`myRoleDeltas` + il calcolo delle alternative in `renderOffers`):

- per ogni proposta si calcolano i **delta per ruolo** sull'undici (prima → dopo);
- il guadagno di un ruolo viene preso **al netto di quello che lo scambio costa negli altri reparti** (`o.nr[r] = delta[r] + Σ min(0, delta[k≠r])`) — così uno scambio che guadagna 1,44 a centrocampo ma ne perde 1,29 in attacco non risulta "il migliore del ruolo";
- per ogni ruolo si prende il **massimo ottenibile dalle altre squadre** e si mostra lo scarto: chip `1° in lega per C` oppure `0,07 dal meglio (C)`;
- nel verdetto: *"in lega c'è di meglio a centrocampo: con Molina Bianco arriveresti a +0,51 (qui +0,44)"*, oppure *"in lega non c'è di meglio: il massimo è +0,51, differenza dentro il margine di errore"* (soglia 0,11 pt/g, sotto la quale non si consiglia di cambiare).

**Nella finestra dell'asta di riparazione** torna invece il confronto col mercato libero (`freeGains` + `netOf`): per ogni ruolo il guadagno del miglior svincolato è `ev(svincolato) − ev(tuo titolare più debole)`, e il netto somma `max(0, delta − guadagno_svincolato_del_ruolo)` per i ruoli in cui guadagni, i delta negativi per intero. Se il mercato copre il guadagno, le offerte mostrano `≈ svincolato` e il verdetto cambia titolo in *"Il mercato batte questo scambio"*.

Il pannello **migliori svincolati per ruolo** resta in piedi tutto l'anno come lista di obiettivi (con la colonna *guadagno*), ma dichiara che fino a febbraio non è un'alternativa praticabile.

## Niente prezzi d'asta nell'analisi degli scambi

A stagione in corso il prezzo pagato ad agosto non è un argomento: chi ha pagato tanto un giocatore che rende poco non lo valuta di più. Per questo nessun giudizio sul valore — né il verdetto, né il consiglio, né le offerte — usa il prezzo: contano solo i **punti attesi a giornata** (fantamedia proiettata, titolarità, calendario). La quotazione ufficiale resta usata solo come *a priori* per chi ha giocato pochissimo. Il prezzo compare solo come **tasso di cambio** nel conguaglio in crediti, che è un'altra cosa: non dice quanto vale un giocatore, dice quanti crediti servono per pareggiare due pacchetti.

## Fonti

| Dato | Fonte |
|---|---|
| Listone, ruoli, squadre, QI/QA/FVM | Fantacalcio.it (listone ufficiale 2026/27, 603 giocatori) |
| Presenze, minuti, gol, assist, voto, fantamedia, storico stagioni, ultime 6 partite | fantacalcio.dev |
| Calendario 38 giornate e gol fatti/subiti per squadra | astafantacalcio.com (pagine calendario e classifica) |

- I dati sono **incorporati** nel file: per un aggiornamento automatico serve un piccolo backend (cron settimanale che esegue `refresh_data.py` e ripubblica la pagina).

## Se vuoi trasformarlo in un vero sito

Tre passi, in ordine di utilità:

1. **Ospitare questa pagina** così com'è (Netlify, GitHub Pages, Cloudflare Pages): è un solo file statico, zero costi.
2. **Automatizzare i dati**: spostare `refresh_data.py` su un cron/GitHub Action settimanale che rigenera `fantatrade.html` e lo pubblica. A quel punto l'app è sempre aggiornata senza toccare nulla.
3. **Aggiungere le cose che spostano davvero l'ago**: infortuni/squalifiche (API tipo API-Football), probabili formazioni, import delle rose reali delle tue leghe (incollando il testo si fa già). Le leghe mantra restano fuori scope per scelta.

Il modello è già isolato in `app/model.js` proprio per poterci attaccare questi pezzi senza riscrivere l'interfaccia.
