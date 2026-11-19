# Cose da fare

Promemoria delle cose decise ma non ancora fatte, così non si perdono per strada.
Ogni voce dice **quando** va fatta, non solo cosa.

---

## 🔴 Da fare in periodi di asta (agosto, e asta di riparazione di gennaio/febbraio)

### Fasce d'asta

**Cosa**: una sezione "Asta" con i giocatori divisi in **fasce** (1ª fascia, 2ª fascia, …),
il budget residuo per reparto, i crediti consigliati per fascia e la lista degli obiettivi
("se non arriva X, il piano B è Y della stessa fascia").

**Perché**: oggi l'app serve a **scambiare** durante il campionato, non a **costruire** una rosa.
All'asta le domande sono altre: quanto posso pagare un attaccante di prima fascia se ho 500
crediti e 8 squadre? Meglio un top in porta o due buoni in difesa? L'idea viene da **FantaLab**
(fasce, prezzi, budget, obiettivi, import delle strategie dei creator), che però è un tool
d'asta a sé: a noi serve la versione integrata con i dati che già abbiamo (QA/FVM, punti attesi,
scarsità di ruolo, tasso di cambio crediti stimato sui prezzi reali della lega).

**Cosa abbiamo già** (da riusare, non da rifare):
- `creditRate()` e `creditRateLevel()` in `app/model.js` — il "tasso di cambio" crediti ↔ punti,
  stimato sui prezzi realmente pagati nella lega (`log(paid) = 0,29 + 0,77 · ev`, R² 0,23, e la
  curva è convessa: un punto su un top costa molto più di un punto su un giocatore medio);
- `vorpOf()` — il valore sopra il rincalzo, che è esattamente il criterio per ordinare le fasce;
- i budget per squadra già importati da `leagues.json` (crediti spesi, residui);
- `roleCounts()` / `bestLineup()` per sapere quanti giocatori servono per ruolo.

**Quando**: verso fine luglio (asta iniziale) e a **gennaio**, prima dell'asta di riparazione.
Non prima: dall'asta di agosto a oggi l'app è passata a ragionare sui punti reali, e le fasce
non servono a niente a stagione in corso.

---

## 🟡 Idee valutate e messe in pausa

- **Storico infortuni** (giorni fuori nelle ultime due stagioni, colonna "Rischio inf."):
  resta da importare a mano due volte l'anno, perché chi tiene quel conto (Transfermarkt)
  blocca gli script. Il dato "chi è fuori adesso" invece è automatico (`fetch_avail.py`).
- **Andamento quotazioni** dal sito di PianetaFanta: le sue schede giocatore mostrano le stesse
  due cifre che abbiamo già nel listone (QA e QI), quindi non vale scaricare 600 pagine per
  riottenerle. Il trend settimanale lo ricaviamo già da `changes.json` + QA (colonna **Quota**).
- **Formazioni ufficiali** il giorno della partita: servirebbe un aggiornamento a poche ore dal
  calcio d'inizio (domenica mattina), non il martedì. Da valutare se vale il rumore.
- **Consenso delle testate come fonte primaria**: oggi è un controllo, non la fonte. Spostare la
  fantamedia sulla mediana delle tre testate è un cambio di modello da validare su più giornate
  (`validate_xg.py` è il posto dove farlo).
