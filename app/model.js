/* FantaTrade - motore di valutazione scambi fantacalcio
   Logica pura (nessun DOM): testabile con node.
   I coefficienti sono stimati sui dati reali Serie A 2026/27 (vedi README). */
(function (root) {
  'use strict';

  var CFG = {
    GW: 11,                        // giornate di Serie A disputate al momento dell'aggiornamento dati
    SHRINK_K: 5,                   // forza della "regressione verso la media" (in unita di 90')
    MAX_MIN: 900,                  // minuti oltre i quali non si allunga piu la fiducia nel dato
    BASE_NO_PLAY: 6.0,             // fantavoto di chi non gioca / subentra (base d'asta)
    PRIOR_PLAY_NO_DATA: 0.35,      // probabilita' di giocare per chi non ha ancora presenze
    W_AVAIL: 0.6,                  // peso della continuita' di presenze vs minutaggio nel calcolo di P(gioca)
    EASE_K: 0.9,                   // quanto pesa il calendario sui punti attesi (±0,36 pt con calendario estremo)
    EASE_SPAN: 0.45,               // sensibilita' alla forza dell'avversario
    SHRINK_TEAM: 6,                // partite di "vantaggio" date alla media: 11 giornate sono poche
    HOME_ADV: 0.035,               // vantaggio casalingo (in punti di facilita', non in classifica)
    CAL_DECAY: 0.88,               // la giornata di oggi pesa più di quella fra due mesi
    DEF_DAMP: 0.85,                // i difensori risentono meno dell'attacco avversario rispetto agli attaccanti
    TREND_TH: 0.15,                // soglia oltre la quale la proiezione indica crescita/calo
    PROSPECT: 0.6,                 // peso del "quanto fara'" rispetto al "quanto ha fatto" (0..1)
    // K stimati sui dati, non a mano: divido le partite del log di ogni giocatore in due metà,
    // misuro quanto le due metà si somigliano (split-half) e correggo con Spearman-Brown.
    // Risultato su 364 giocatori: voto r=0,27 → K≈7,6 · bonus r=0,16 → K≈14,9.
    K_VOTO: 7.5,                   // presenze oltre le quali il voto medio e' considerato affidabile
    K_BONUS: 15,                   // come sopra, ma per i bonus (gol/assist): molto piu' rumorosi
    CREDIT_RATE: 55,               // crediti per punto a giornata, se la lega non ha prezzi da cui stimarlo
    // gli svincolati si possono prendere solo all'asta di riparazione: fuori da questa finestra
    // il mercato libero non e' un'alternativa reale a uno scambio (mesi 0-based: 0 = gennaio)
    FREE_WINDOW: { fromMonth: 0, fromDay: 20, toMonth: 1, toDay: 20 },
    BATTLE_GAP: 0.35,              // quanto vicino deve stare un rivale (in pt/g) perche' sia ballottaggio
    BATTLE_MIN_MIN: 300,           // minuti minimi del rivale perche' il ballottaggio sia reale
    STARTER_MS: 0.72,              // quota minuti da "titolare"
    STARTER_AVAIL: 0.7,            // presenza minima (giornate giocate / giornate) da titolare fisso
    W_XG: 0.45,                    // quanto pesano i gol attesi (xG) rispetto ai gol fatti, se disponibili
    W_XA: 0.45,                    // idem per gli assist attesi (xA)
    BONUS_GOAL: 3,                 // bonus fantacalcio per gol
    BONUS_ASSIST: 1,               // bonus per assist
    K_INJ: 0.35,                   // quanto pesa lo storico infortuni nella probabilita' di giocare
    INJ_WINDOW_DAYS: 730,          // finestra dello storico infortuni (due stagioni)
    CREDIT_TILT: 0.35,             // il punto vale di più sui giocatori forti (mercato convesso)
    // fantamedia attesa "a priori" dalla quotazione ufficiale QA: fm = a + b * ln(1 + QA)
    // (stimata sui giocatori 2026/27 con almeno 6 presenze: R2 0,56-0,80)
    PRIOR: {
      P: { a: 2.5949, b: 1.2337 },
      D: { a: 4.3107, b: 0.8053 },
      C: { a: 3.5619, b: 1.2113 },
      A: { a: 3.1122, b: 1.4028 }
    },
    FORMATIONS: {
      '3-4-3': { P: 1, D: 3, C: 4, A: 3 },
      '4-3-3': { P: 1, D: 4, C: 3, A: 3 },
      '4-4-2': { P: 1, D: 4, C: 4, A: 2 },
      '3-5-2': { P: 1, D: 3, C: 5, A: 2 },
      '4-5-1': { P: 1, D: 4, C: 5, A: 1 }
    },
    ROLE_ORDER: ['P', 'D', 'C', 'A']
  };

  function num(x) { return (typeof x === 'number' && isFinite(x)) ? x : 0; }

  /* ---------- 1. valore del singolo giocatore ---------- */

  // fantamedia attesa a priori dalla sola quotazione ufficiale (nessun prezzo d'asta)
  function priorFm(p) {
    var c = CFG.PRIOR[p.r] || CFG.PRIOR.C;
    var qa = Math.max(0, num(p.qa) || num(p.q) || 1);   // quotazione ufficiale Fantacalcio.it
    return c.a + c.b * Math.log(1 + qa);
  }

  // fantamedia "vera" stimata: unisce forma 2026/27, storico delle stagioni passate
  // e attesa iniziale dedotta dal prezzo. Chi ha giocato poco non e' un fenomeno.
  function historicalFm(p) {
    var h = p.hist || {};
    var keys = Object.keys(h).sort().slice(-3);
    if (!keys.length) return null;
    var num = 0, den = 0;
    keys.forEach(function (k, i) { var w = i + 1; num += h[k] * w; den += w; });   // stagioni recenti pesano di piu'
    return num / den;
  }

  // "momento": confronto tra le ultime 3 partite e la media stagionale del fantavoto
  // "momento" misurato sul VOTO (log[i][1]), non sul fantavoto: se lo usassi sul fantavoto
  // starei raccontando la fortuna dei bonus nelle ultime tre partite, che e' proprio la parte
  // che abbiamo deciso di non inseguire.
  function momentum(p) {
    var log = p.log || [];
    if (log.length < 3) return null;
    var sum = function (arr) { return arr.reduce(function (a, x) { return a + (typeof x[1] === 'number' ? x[1] : x[2]); }, 0); };
    var last3 = sum(log.slice(-3)) / 3;
    var season = sum(log) / log.length;
    return { last3: last3, season: season, delta: last3 - season };
  }

  function clampNum(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------- 1-bis. proiezione: quanto fara', non solo quanto ha fatto ---------- */
  // Il fantavoto e' la somma di due cose diverse: il voto (quanto gioca e come gioca), che
  // si stabilizza in poche partite, e i bonus (gol/assist), che su campioni piccoli sono in
  // larga parte fortuna. Per questo il bonus viene compresso verso la media del ruolo molto
  // piu' forte del voto: chi ha segnato 3 gol in 4 partite non diventa un fenomeno, e chi e'
  // a secco ma gioca, prende voti e ha il posto garantito non viene svenduto.
  var ROLE_BASE_FALLBACK = {
    P: { voto: 6.13, bonus: -0.64 },
    D: { voto: 5.91, bonus: 0.07 },
    C: { voto: 6.07, bonus: 0.36 },
    A: { voto: 6.07, bonus: 0.67 }
  };
  var roleBase = null;

  function median(arr) {
    if (!arr.length) return null;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  // calibrata sui dati caricati: mediana di voto e bonus per ruolo
  function calibrate(pool) {
    var out = {};
    CFG.ROLE_ORDER.forEach(function (r) {
      var sub = (pool || []).filter(function (p) {
        return p && p.r === r && num(p.pres) >= 6 && num(p.min) >= 400 && num(p.fm);
      });
      var voti = sub.map(function (p) { return num(p.voto) || num(p.fm); });
      var bonus = sub.map(function (p) { return num(p.fm) - (num(p.voto) || num(p.fm)); });
      var fb = ROLE_BASE_FALLBACK[r] || ROLE_BASE_FALLBACK.C;
      out[r] = { voto: median(voti) || fb.voto, bonus: bonus.length ? median(bonus) : fb.bonus };
    });
    roleBase = out;
    return out;
  }
  function baseOf(r) { return (roleBase && roleBase[r]) || ROLE_BASE_FALLBACK[r] || ROLE_BASE_FALLBACK.C; }

  // fantamedia proiettata: voto atteso + bonus attesi, con i bonus compressi sul ruolo
  /* ---------- dati avanzati opzionali (xG, tiri) ---------- */
  // arrivano da app/data.json se il file di arricchimento e' stato importato:
  // campi p.xg, p.npxg, p.shots, p.sot (totali di stagione). Se mancano, tutto resta com'era.
  function hasAdv(p) {
    return !!p && (p.xg != null || p.npxg != null || p.shots != null);
  }

  function advStats(p) {
    if (!hasAdv(p)) return null;
    var min = num(p.min);
    var m90 = min > 0 ? min / 90 : 0;
    var xg = p.npxg != null ? num(p.npxg) : num(p.xg);
    var shots = p.shots != null ? num(p.shots) : null;
    return {
      xg: xg, penal: p.xg != null && p.npxg != null ? num(p.xg) - num(p.npxg) : null,
      shots: shots,
      sot: p.sot != null ? num(p.sot) : null,
      xa: p.xa != null ? num(p.xa) : null,
      xa90: (p.xa != null && m90 > 0) ? num(p.xa) / m90 : null,
      // assist fatti meno assist attesi: > 0 sta servendo piu' di quanto crea
      assVsXa: (p.ass != null && p.xa != null) ? num(p.ass) - num(p.xa) : null,
      xg90: m90 > 0 ? xg / m90 : null,
      shots90: (shots != null && m90 > 0) ? shots / m90 : null,
      // gol fatti meno gol attesi: > 0 sta finalizzando sopra le aspettative
      finishing: (p.gol != null && xg != null) ? num(p.gol) - xg : null
    };
  }

  // bonus per partita giocata dedotto dai tiri: gol attesi (xG) + assist attesi (xA)
  function xgBonusPerMatch(p) {
    var a = advStats(p);
    if (!a || !a.xg90) return null;
    var m90 = num(p.min) / 90;
    if (!(m90 > 0)) return null;
    var ms = minuteShare(p);
    // piu' minuti giocati, piu' xG/xA sono credibili
    var conf = num(p.min) / (num(p.min) + CFG.MAX_MIN);
    var w = 0.5 + 0.5 * Math.min(1, conf * 2);
    var ass90 = num(p.ass) / m90;
    var assEff = ass90;
    if (a.xa90 != null) assEff = (1 - CFG.W_XA * w) * ass90 + (CFG.W_XA * w) * a.xa90;
    return (a.xg90 * CFG.BONUS_GOAL + assEff * CFG.BONUS_ASSIST) * ms;
  }

  function projectedFm(p) {
    var b = baseOf(p.r);
    var pres = num(p.pres);
    if (!pres || !num(p.fm)) return priorFm(p);            // senza dati: resta l'a priori
    var voto = num(p.voto) || num(p.fm);
    var bonusApp = num(p.fm) - voto;
    var wv = pres / (pres + CFG.K_VOTO);
    var wb = pres / (pres + CFG.K_BONUS);
    // ancoraggio del voto: per chi ha giocato poco vale anche l'a priori (quotazione ufficiale),
    // altrimenti ogni riserva con tre presenze diventerebbe un titolare medio
    var priorVoto = clampNum(priorFm(p) - b.bonus, 4.5, 8.2);
    var anchorVoto = 0.6 * priorVoto + 0.4 * b.voto;
    var pv = wv * voto + (1 - wv) * anchorVoto;
    // il bonus "vero" del giocatore: se ho le stagioni passate, il ruolo non e' l'unico ancoraggio
    var hist = historicalFm(p);
    var bBase = b.bonus;
    if (hist != null) bBase = 0.5 * b.bonus + 0.5 * clampNum(hist - b.voto, b.bonus - 0.5, b.bonus + 1.2);
    // con gli xG: il bonus "giusto" e' quello dei tiri, non quello dei gol gia' fatti
    var bx = xgBonusPerMatch(p);
    var bonusAppEff = bonusApp;
    if (bx != null) {
      var conf = num(p.min) / (num(p.min) + CFG.MAX_MIN);      // piu' minuti, piu' xG credibili
      var w = CFG.W_XG * (0.5 + 0.5 * Math.min(1, conf * 2));
      bonusAppEff = (1 - w) * bonusApp + w * bx;
    }
    var pb = wb * bonusAppEff + (1 - wb) * bBase;
    var out = pv + pb;
    var mo = momentum(p);
    if (mo) out += clampNum(mo.delta * 0.12, -0.15, 0.15) * Math.min(1, pres / 6);
    return clampNum(out, 4.0, 10.5);
  }

  // "quanto ha fatto" puro: la fantamedia reale compressa verso l'attesa iniziale
  function settledFm(p) {
    var prior = priorFm(p);
    var hist = historicalFm(p);
    var anchor = hist == null ? prior : clampNum(0.45 * prior + 0.55 * hist, 5.0, 9.5);
    if (!p.fm) return anchor;
    var n90 = Math.min(num(p.min), CFG.MAX_MIN) / 90;
    var k = CFG.SHRINK_K;
    var blended = (p.fm * n90 + anchor * k) / (n90 + k);
    var mo = momentum(p);
    if (mo) blended += clampNum(mo.delta * 0.25, -0.25, 0.25) * Math.min(1, n90 / 6);
    return clampNum(blended, 4.0, 10.5);
  }

  // sintesi: quanto pesa il futuro (CFG.PROSPECT) rispetto al gia' fatto
  function expectedFm(p) {
    var w = clampNum(typeof CFG.PROSPECT === 'number' ? CFG.PROSPECT : 0.6, 0, 1);
    if (w <= 0) return settledFm(p);
    return clampNum((1 - w) * settledFm(p) + w * projectedFm(p), 4.0, 10.5);
  }
  function setProspect(w) { CFG.PROSPECT = clampNum(num(w), 0, 1); return CFG.PROSPECT; }

  /* ---------- 1-ter. conguaglio in crediti: quanto vale un punto a giornata ---------- */
  // Tariffa stimata sui prezzi realmente pagati all'asta nella lega (pendenza della retta
  // "crediti spesi ~ punti attesi"). Non e' una valutazione del singolo giocatore: e' solo
  // il tasso di cambio usato per pareggiare i conti tra due pacchetti.
  function creditRate(samples) {
    var s = (samples || []).filter(function (x) { return x && num(x.paid) >= 8 && isFinite(num(x.ev)); });
    if (s.length < 20) return CFG.CREDIT_RATE;
    var n = s.length;
    var mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += num(s[i].ev); my += num(s[i].paid); }
    mx /= n; my /= n;
    var num2 = 0, den = 0;
    for (i = 0; i < n; i++) {
      var dx = num(s[i].ev) - mx;
      num2 += dx * (num(s[i].paid) - my);
      den += dx * dx;
    }
    if (den < 1e-6) return CFG.CREDIT_RATE;
    return clampNum(num2 / den, 15, 140);
  }

  // Il mercato non è lineare: un punto a giornata su un top costava molto più di un punto
  // su un giocatore medio (la retta prezzo ~ punti è convessa). La pendenza stimata sui
  // prezzi reali è la media; qui la correggo col livello dei giocatori scambiati.
  // Il tilt è volutamente attenuato: la curva esponenziale sui dati ha R2 0,23, quindi
  // esagerare vorrebbe dire inseguire il rumore.
  function creditRateLevel(baseRate, level) {
    var r = num(baseRate) || CFG.CREDIT_RATE;
    var lv = isFinite(num(level)) && num(level) > 0 ? num(level) : 6.5;
    var mult = clampNum(1 + CFG.CREDIT_TILT * (lv - 6.5), 0.6, 2.0);
    return r * mult;
  }

  // quanti crediti servono perche' lo scambio sia pari, e chi li mette
  function creditsFor(dA, dB, rate, level) {
    var gap = num(dA) - num(dB);
    if (Math.abs(gap) < 0.06) return { credits: 0, payer: null, gap: Math.abs(gap) };
    var r = creditRateLevel(rate, level);
    var c = Math.round(Math.abs(gap) * r / 5) * 5;
    return { credits: Math.max(5, c), payer: gap > 0 ? 'me' : 'him', gap: Math.abs(gap), rate: r };
  }

  // quota di partita effettivamente giocata (0 = solo panchina, 1 = sempre 90 minuti)
  // uso i minuti e non il campo "partite da titolare", che nelle fonti e' incoerente
  function minuteShare(p) {
    if (!num(p.pres)) return 0;
    return Math.min(num(p.min) / (num(p.pres) * 90), 1);
  }

  /* ---------- storico infortuni (opzionale) ---------- */
  // p.inj = [{ days: 21, type: 'muscolare' }, ...] oppure p.injDays (numero di giorni fuori)
  function injuryProfile(p) {
    if (!p) return null;
    var days = 0, eps = 0, known = false;
    if (Array.isArray(p.inj) && p.inj.length) {
      p.inj.forEach(function (e) {
        var d = num(e && e.days);
        if (d > 0) { days += d; if (d >= 3) eps++; known = true; }
      });
      known = true;
    } else if (p.injDays != null) {
      days = Math.max(0, num(p.injDays)); eps = Math.max(0, num(p.injEpisodes)); known = true;
    }
    if (!known) return null;
    var win = CFG.INJ_WINDOW_DAYS;
    var missFrac = Math.min(0.6, days / win);        // quota di calendario persa
    return {
      days: Math.round(days), episodes: Math.round(eps),
      missFrac: missFrac, availPrior: 1 - missFrac,
      // probabilita' di essere indisponibile in una giornata a caso = quota di calendario persa
      perGw: missFrac,
      perSeason: eps / (win / 365)
    };
  }

  // probabilita' di prendere il voto in una giornata: continuita' di presenze + minutaggio
  function playProb(p) {
    var base;
    if (!num(p.pres)) base = CFG.PRIOR_PLAY_NO_DATA;
    else {
      var availability = Math.min(num(p.pres) / CFG.GW, 1);
      // lo storico infortuni corregge solo la parte "disponibilita'": chi si rompe spesso
      // ha un a priori piu' basso, ma i dati di questa stagione restano la fonte principale
      var inj = injuryProfile(p);
      if (inj) {
        // lo storico puo' solo abbassare la stima, mai alzarla: chi ha gia' giocato tanto
        // quest'anno non diventa piu' affidabile perche' due anni fa stava bene
        var blended = (1 - CFG.K_INJ) * availability + CFG.K_INJ * inj.availPrior;
        availability = Math.min(availability, blended);
      }
      var w = CFG.W_AVAIL;
      base = Math.max(0, Math.min(1, w * availability + (1 - w) * minuteShare(p)));
    }
    // stato dichiarato a mano dall'utente (infortunio, squalifica, ballottaggio):
    // e' l'informazione che i dati storici non possono contenere
    var st = p.statusManual;
    if (st === 'out') return Math.min(base, 0.05);
    if (st === 'dubbio') return base * 0.55;
    if (st === 'certo') return Math.min(1, base * 1.15 + 0.05);
    return base;
  }

  // punteggio atteso per giornata: mix fra giocare (fantamedia) e non giocare (base),
  // corretto dal calendario (p.easeOverride, 0..1, 0,5 = avversario medio)
  function matchdayPoints(p) {
    var pw = playProb(p), f = expectedFm(p);
    var base = pw * f + (1 - pw) * CFG.BASE_NO_PLAY;
    if (typeof p.easeOverride === 'number') {
      base += (p.easeOverride - 0.5) * CFG.EASE_K * pw;
    }
    return base;
  }

  /* ---------- concorrenza interna: chi gli sta davanti, chi dietro ---------- */
  // nello stesso club e nello stesso ruolo: serve per capire se uno e' titolare
  // senza rivali, in ballottaggio, o il primo cambio di qualcun altro
  function clubCompetition(pool, id) {
    var p = pool[id];
    if (!p) return null;
    var me = { p: p, id: id, ev: matchdayPoints(p) };
    var mates = [];
    for (var i = 0; i < pool.length; i++) {
      var q = pool[i];
      if (!q || i === id) continue;
      if (q.t !== p.t || q.r !== p.r) continue;
      mates.push({ p: q, id: i, ev: matchdayPoints(q) });
    }
    mates.sort(function (a, b) { return b.ev - a.ev; });
    var ahead = mates.filter(function (x) { return x.ev > me.ev + 0.02; });
    var behind = mates.filter(function (x) { return x.ev <= me.ev + 0.02; });
    return { self: me, ahead: ahead, behind: behind, all: mates };
  }

  // tiri/starter/infortuni non sono nei dati: quello che si puo' dire con onestà
  // e' la quota minuti, la continuita' di presenze e chi gli contende il posto
  function starterProfile(pool, id) {
    var p = pool[id];
    if (!p) return null;
    var ms = minuteShare(p), pres = num(p.pres) || 0;
    var avail = Math.min(pres / CFG.GW, 1);
    var myEv = matchdayPoints(p);
    var comp = clubCompetition(pool, id);
    function close(x) {
      return !!x && (num(x.p.min) || 0) >= CFG.BATTLE_MIN_MIN && Math.abs(x.ev - myEv) <= CFG.BATTLE_GAP;
    }
    var rival = (comp && comp.behind.length) ? (close(comp.behind[0]) ? comp.behind[0] : null) : null;
    var aheadOf = (comp && comp.ahead.length) ? (close(comp.ahead[0]) ? comp.ahead[0] : null) : null;

    var label;
    if (pres < 1) label = 'mai visto';
    else if (ms >= CFG.STARTER_MS && avail >= CFG.STARTER_AVAIL) label = rival ? 'titolare in ballottaggio' : 'titolare fisso';
    else if (ms >= CFG.STARTER_MS) label = 'titolare a intermittenza';
    else if (ms >= 0.4) label = 'mezza partita';
    else label = aheadOf ? 'primo cambio' : 'riserva';

    return {
      label: label, ms: ms, avail: avail, pres: pres,
      missed: Math.max(0, Math.round(CFG.GW - pres)),   // giornate saltate: osservate, non previste
      battle: !!rival, rival: rival, aheadOf: aheadOf,
      fallback: rival ? rival.ev : null
    };
  }

  // bonus per 90 minuti: l'unico surrogato onesto della "media tiri" con questi dati
  function bonusPer90(p) {
    var min = num(p.min);
    if (!min || min < 90) return null;
    return ((num(p.gol) || 0) + (num(p.ass) || 0)) / (min / 90);
  }

  // giornate saltate sul totale: fragilità osservata (non una probabilità di infortunio)
  function absenceRate(p) {
    var pres = num(p.pres) || 0;
    return Math.max(0, Math.min(1, (CFG.GW - pres) / CFG.GW));
  }

  /* ---------- proiezione: crescera', calera' o stabile? ---------- */
  // confronta la fantamedia reale con quella "attesa" (che incorpora la regressione verso
  // la media e il prezzo): chi sta sovraperformando tende a calare, chi sottoperforma a salire.
  function projection(p) {
    var exp = expectedFm(p);
    var cur = num(p.fm);
    var delta = cur > 0 ? exp - cur : 0;
    var mo = momentum(p);
    var minutes = Math.min(num(p.min), CFG.MAX_MIN) / CFG.MAX_MIN;
    var conf = Math.round(100 * Math.max(0, Math.min(1, 0.3 + 0.55 * minutes + (historicalFm(p) != null ? 0.15 : 0))));
    var label = 'stabile', why = 'Rendimento in linea con le attese.';
    if (mo && mo.delta >= 0.35) { label = 'crescita'; why = 'In forma: nelle ultime 3 partite ha preso ' + round2(mo.last3) + ' di voto contro ' + round2(mo.season) + ' di media stagionale.'; }
    else if (mo && mo.delta <= -0.35) { label = 'calo'; why = 'In flessione: nelle ultime 3 partite ha preso ' + round2(mo.last3) + ' di voto contro ' + round2(mo.season) + ' di media stagionale.'; }
    else if (cur > 0 && delta >= CFG.TREND_TH) { label = 'crescita'; why = 'Sta rendendo meno di quanto vale: atteso un recupero verso ' + round2(exp) + '.'; }
    else if (cur > 0 && delta <= -CFG.TREND_TH) { label = 'calo'; why = 'Sta rendendo sopra le sue medie: atteso un assestamento verso ' + round2(exp) + '.'; }
    return { current: cur || null, expected: exp, delta: delta, label: label, confidence: conf,
             momentum: mo, historical: historicalFm(p), why: why };
  }

  /* ---------- calendario: difficolta' delle prossime giornate ---------- */
  // ctx = {rounds:[{round, matches:[[casa, ospite], ...]}], ratings:{Squadra:{att,def}}, currentRound}
  function clamp01(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---------- calendario ----------
  // Forza delle squadre: gol fatti/subiti per partita, "compattati" verso la media del
  // campionato. Con 11 giornate un 4-0 falsa tutto: il peso del dato reale cresce con le
  // partite giocate (k=6), così a fine stagione conta solo quello che è successo davvero.
  var teamRatesCache = null;
  function teamRates(ctx) {
    if (!ctx || !ctx.ratings) return null;
    if (teamRatesCache && teamRatesCache.ref === ctx) return teamRatesCache.out;
    var avg = ctx.avg || { gf: 1.4, ga: 1.4 };
    var agf = num(avg.gf) || 1.4, aga = num(avg.ga) || 1.4, k = CFG.SHRINK_TEAM;
    var out = {};
    Object.keys(ctx.ratings).forEach(function (t) {
      var r = ctx.ratings[t], g = num(r.g) || 1;
      var att = (num(r.gf) + k * agf) / (g + k);
      var def = (num(r.gs) + k * aga) / (g + k);
      out[t] = { att: att / agf, def: def / aga, attRate: att, defRate: def, g: g };
    });
    teamRatesCache = { ref: ctx, out: out };
    return out;
  }

  // facilita' (0..1) di una singola partita, diversa per ruolo:
  // attaccare e' facile contro chi concede molto, difendere contro chi segna poco.
  function matchEase(ctx, opponent, isHome, role) {
    var rates = teamRates(ctx);
    var r = rates && rates[opponent];
    if (!r) return 0.5;
    var home = isHome ? CFG.HOME_ADV : -CFG.HOME_ADV;
    var easeAtt = 0.5 + CFG.EASE_SPAN * (r.def - 1) + home;                        // avversario che concede
    var easeDef = 0.5 - CFG.EASE_SPAN * CFG.DEF_DAMP * (r.att - 1) + home * 0.9;   // avversario che attacca forte
    var ease;
    if (role === 'A') ease = easeAtt;
    else if (role === 'D' || role === 'P') ease = easeDef;
    else ease = 0.6 * easeAtt + 0.4 * easeDef;      // il centrocampista fa le due fasi
    return clamp01(ease, 0.05, 0.95);
  }

  // media delle prossime partite, con le giornate vicine che pesano piu' di quelle lontane:
  // il calendario di marzo conta meno di quello di domenica.
  function scheduleEase(ctx, team, role, horizon, fromRound) {
    if (!ctx || !ctx.rounds) return { ease: 0.5, list: [] };
    var start = fromRound || ctx.currentRound || 1;
    var list = [];
    for (var i = 0; i < ctx.rounds.length && list.length < horizon; i++) {
      var round = ctx.rounds[i];
      if (round.round < start) continue;
      for (var j = 0; j < round.matches.length; j++) {
        var m = round.matches[j];
        if (m[0] === team) list.push({ round: round.round, opponent: m[1], home: true, ease: matchEase(ctx, m[1], true, role) });
        else if (m[1] === team) list.push({ round: round.round, opponent: m[0], home: false, ease: matchEase(ctx, m[0], false, role) });
      }
    }
    var sum = 0, wsum = 0;
    list.forEach(function (x, i) {
      var w = Math.pow(CFG.CAL_DECAY, i);
      x.weight = w;
      sum += x.ease * w; wsum += w;
    });
    return { ease: wsum ? sum / wsum : 0.5, list: list };
  }

  // classifica dei calendari della lega: chi ha le prossime partite piu' morbide
  function calendarBoard(ctx, teams, role, horizon, fromRound) {
    var rows = (teams || []).map(function (t) {
      var sc = scheduleEase(ctx, t, role, horizon, fromRound);
      return { team: t, ease: sc.ease, list: sc.list };
    }).sort(function (a, b) { return b.ease - a.ease; });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  }

  /* ---------- perche' si' / perche' no ---------- */
  function explainTrade(res, opt) {
    var pool = opt.pool, ctx = opt.ctx;
    // res porta gli id dei giocatori: qui servono gli oggetti
    function obj(id) { return typeof id === 'number' ? pool[id] : id; }
    var giveIds = res.giveA || [], recvIds = res.giveB || [];
    var give = giveIds.map(obj).filter(Boolean);
    var receive = recvIds.map(obj).filter(Boolean);
    var pros = [], cons = [];
    var rep = { P: 'in porta', D: 'in difesa', C: 'a centrocampo', A: 'in attacco' };
    var slots = CFG.FORMATIONS[opt.formation] || CFG.FORMATIONS['3-4-3'];

    function sum(ids, fn) { return ids.reduce(function (a, id) { return a + fn(pool[id]); }, 0); }
    function avg(ids, fn) { return ids.length ? sum(ids, fn) / ids.length : 0; }

    // 1. impatto sull'undici
    if (res.dA > 0.05) pros.push({ t: 'Il tuo undici migliora di ' + round2(res.dA) + ' pt a giornata',
      d: 'Da ' + round2(res.beforeA.total) + ' a ' + round2(res.afterA.total) + ' punti attesi: ' + round2(res.dA * (opt.gwLeft || 27), 1) + ' punti in più sulle ' + (opt.gwLeft || 27) + ' giornate che restano.' });
    else if (res.dA < -0.05) cons.push({ t: 'Il tuo undici peggiora di ' + round2(-res.dA) + ' pt a giornata',
      d: 'Da ' + round2(res.beforeA.total) + ' a ' + round2(res.afterA.total) + ': sono ' + round2(-res.dA * (opt.gwLeft || 27), 1) + ' punti in meno fino a fine stagione.' });

    // 2. reparti
    var before = {}, after = {};
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      before[r] = roleSum(pool, opt.A, r, slots);
      after[r] = roleSum(pool, res.newA, r, slots);
    });
    ['D', 'C', 'A'].forEach(function (r) {
      var d = after[r] - before[r];
      if (d > 0.04) pros.push({ t: 'Guadagni ' + round2(d) + ' pt ' + rep[r], d: 'Il tuo reparto diventa più produttivo senza toccare gli altri.' });
      if (d < -0.04) cons.push({ t: 'Perdi ' + round2(-d) + ' pt ' + rep[r], d: 'Il reparto si indebolisce: controlla di avere una copertura decente in panchina.' });
    });

    // 3. ruoli scoperti
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      var n = res.newA.filter(function (id) { return pool[id].r === r; }).length;
      if (n < slots[r]) cons.push({ t: 'Resti con ' + n + ' giocatori in ' + roleName(r).toLowerCase() + ' (ne servono ' + slots[r] + ')',
        d: 'Non potresti schierare il modulo ' + opt.formation + ': dovresti pescare uno svincolato.' });
    });

    // 4. calendario (in percentuale sulle altre squadre, se chi chiama lo passa)
    if (ctx) {
      var calVal = typeof opt.calPct === 'function' ? opt.calPct
        : function (t, r) { return scheduleEase(ctx, t, r, opt.horizon || 5).ease; };
      var easeIn = avg(recvIds, function (p) { return calVal(p.t, p.r); });
      var easeOut = avg(giveIds, function (p) { return calVal(p.t, p.r); });
      var diff = easeIn - easeOut;
      if (Math.abs(diff) >= 0.03) {
        var item = { t: 'Calendario ' + (diff > 0 ? 'più favorevole' : 'più duro') + ' per chi arriva (' + Math.round(easeIn * 100) + '/100 vs ' + Math.round(easeOut * 100) + '/100)',
          d: 'Nelle prossime ' + (opt.horizon || 5) + ' giornate: ' + describeSchedule(ctx, receive, opt.horizon || 5) };
        (diff > 0 ? pros : cons).push(item);
      }
    }

    // 5. proiezione fantamedia
    var projIn = avg(recvIds, projection), projOut = avg(giveIds, projection);
    if (receive.length && give.length && projIn - projOut >= 0.1) {
      pros.push({ t: 'Fantamedia attesa più alta (' + round2(projIn) + ' vs ' + round2(projOut) + ')',
        d: 'Chi arriva ha un rendimento proiettato superiore a chi parte, al netto di alti e bassi.' });
    } else if (receive.length && give.length && projOut - projIn >= 0.1) {
      cons.push({ t: 'Fantamedia attesa più bassa (' + round2(projIn) + ' vs ' + round2(projOut) + ')',
        d: 'Chi arriva ha un rendimento proiettato inferiore a chi parte.' });
    }
    receive.forEach(function (p) {
      var pr = projection(p);
      var fmTxt = '';
      if (p.fm) {
        var coerente = pr.label === 'crescita' ? pr.expected >= pr.current + 0.05 : pr.expected <= pr.current - 0.05;
        if (coerente) fmTxt = ' (FM ' + round2(pr.current) + ' → attesa ' + round2(pr.expected) + ')';
      }
      if (pr.label === 'calo' && pr.confidence >= 50)
        cons.push({ t: p.n + ' è dato in calo' + fmTxt, d: pr.why + ' Comprarlo adesso significa pagarlo al massimo.' });
      if (pr.label === 'crescita' && pr.confidence >= 50)
        pros.push({ t: p.n + ' è dato in crescita' + fmTxt, d: pr.why + ' È il momento di prenderlo.' });
    });
    give.forEach(function (p) {
      var pr = projection(p);
      var fmTxt = '';
      if (p.fm) {
        var coerente = pr.label === 'crescita' ? pr.expected >= pr.current + 0.05 : pr.expected <= pr.current - 0.05;
        if (coerente) fmTxt = ' (FM ' + round2(pr.current) + ' → attesa ' + round2(pr.expected) + ')';
      }
      if (pr.label === 'crescita' && pr.confidence >= 50)
        cons.push({ t: 'Cedi ' + p.n + ', che è dato in crescita' + fmTxt, d: pr.why + ' Venderlo ora rischia di essere vendere basso.' });
      if (p.statusManual === 'out' || p.statusManual === 'dubbio')
        pros.push({ t: 'Ti liberi di ' + p.n + ', che non è al meglio', d: 'Cedendo un giocatore in dubbio o fuori trasformi un problema in un titolare avversario.' });
    });
    receive.forEach(function (p) {
      if (p.statusManual === 'out' || p.statusManual === 'dubbio')
        cons.push({ t: p.n + ' non è al meglio (stato: ' + (p.statusManual === 'out' ? 'fuori' : 'in dubbio') + ')',
          d: 'Stai prendendo un giocatore che potrebbe non scendere in campo.' });
    });

    // 6. numerico
    var nIn = receive.length, nOut = give.length;
    if (nOut > nIn) cons.push({ t: 'Accorpi ' + nOut + ' giocatori in ' + nIn, d: 'La rosa si accorcia: ti serve una panchina che regga gli infortuni.' });
    if (nIn > nOut) pros.push({ t: 'Allarghi la rosa (' + nIn + ' in entrata, ' + nOut + ' in uscita)', d: 'Più copertura nei ruoli e più margine nei ballottaggi.' });

    return { pros: pros, cons: cons };
  }

  function round2(v, d) { d = d == null ? 2 : d; return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }
  function roleName(r) { return ({ P: 'portieri', D: 'difensori', C: 'centrocampisti', A: 'attaccanti' })[r] || r; }
  function roleSum(pool, ids, role, slots) {
    var arr = ids.filter(function (id) { return pool[id] && pool[id].r === role; })
      .map(function (id) { return matchdayPoints(pool[id]); })
      .sort(function (a, b) { return b - a; });
    var need = slots[role], out = 0;
    for (var i = 0; i < Math.min(need, arr.length); i++) out += arr[i];
    return out;
  }
  function describeSchedule(ctx, ids, horizon) {
    var first = ids[0];
    if (!first) return '';
    var sch = scheduleEase(ctx, first.t, first.r, horizon);
    return sch.list.map(function (m) { return (m.home ? '' : '@') + m.opponent; }).join(', ');
  }

  /* ---------- 2. scarsita' di ruolo: livello "sostituto" ---------- */

  // per ogni ruolo calcola il punteggio del giocatore che chiude il reparto
  // (tante squadre x quanti titolari per ruolo), cioe' il livello del "rincalzo" della lega
  function replacementLevels(pool, teams, formation) {
    var slots = CFG.FORMATIONS[formation] || CFG.FORMATIONS['3-4-3'];
    var out = {};
    CFG.ROLE_ORDER.forEach(function (r) {
      var arr = pool.filter(function (p) { return p.r === r; })
        .map(matchdayPoints)
        .sort(function (x, y) { return y - x; });
      var idx = Math.min(arr.length - 1, Math.max(0, teams * slots[r] - 1));
      out[r] = arr.length ? arr[idx] : CFG.BASE_NO_PLAY;
    });
    return out;
  }

  // valore "sopra il rincalzo": rende confrontabili ruoli diversi
  function vorp(p, repl) {
    return Math.max(0, matchdayPoints(p) - repl[p.r]);
  }

  /* ---------- 3. formazione migliore ---------- */

  function teamScore(pool, ids, formation) {
    var slots = CFG.FORMATIONS[formation] || CFG.FORMATIONS['3-4-3'];
    var by = { P: [], D: [], C: [], A: [] };
    ids.forEach(function (id) {
      var p = pool[id];
      if (p) by[p.r].push(matchdayPoints(p));
    });
    var total = 0, missing = {}, complete = true;
    CFG.ROLE_ORDER.forEach(function (r) {
      var arr = by[r].sort(function (x, y) { return y - x; });
      var need = slots[r];
      var use = Math.min(need, arr.length);
      for (var i = 0; i < use; i++) total += arr[i];
      if (arr.length < need) { complete = false; missing[r] = need - arr.length; }
    });
    return { total: total, complete: complete, missing: missing, size: ids.length };
  }

  /* ---------- 4. analisi di uno scambio ---------- */

  function analyzeTrade(opt) {
    var pool = opt.pool, formation = opt.formation, teams = opt.teams;
    var A = opt.A.slice(), B = opt.B.slice();
    var giveA = opt.giveA || [], giveB = opt.giveB || [];
    var repl = replacementLevels(pool, teams, formation);

    function without(arr, ids) { return arr.filter(function (x) { return ids.indexOf(x) === -1; }); }
    var newA = without(A, giveA).concat(giveB);
    var newB = without(B, giveB).concat(giveA);

    var beforeA = teamScore(pool, A, formation), afterA = teamScore(pool, newA, formation);
    var beforeB = teamScore(pool, B, formation), afterB = teamScore(pool, newB, formation);

    function sumVorp(ids) {
      return ids.reduce(function (s, id) { return s + vorp(pool[id], repl); }, 0);
    }

    var dA = afterA.total - beforeA.total;      // punti/giornata guadagnati da A
    var dB = afterB.total - beforeB.total;      // punti/giornata guadagnati da B
    var vorpA = sumVorp(giveB) - sumVorp(giveA);

    // copertura dei reparti prima/dopo: se lo scambio ti lascia senza ricambi, va detto
    var covBeforeA = coverage(pool, A, repl, formation);
    var covAfterA = coverage(pool, newA, repl, formation);
    var covBeforeB = coverage(pool, B, repl, formation);
    var covAfterB = coverage(pool, newB, repl, formation);

    var warns = [];
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      if (!afterA.complete && afterA.missing[r]) warns.push('Dopo lo scambio resti corto in ' + labelRole(r) + ' (' + afterA.missing[r] + ')');
      else if (covAfterA[r].useful <= covAfterA[r].need && covAfterA[r].useful < covBeforeA[r].useful) {
        warns.push('Resti senza ricambi in ' + labelRole(r) + ': ' + covAfterA[r].useful + ' giocatore/i utile/i per ' + covAfterA[r].need + ' maglie, la prima assenza ti scopre');
      }
      if (!afterB.complete && afterB.missing[r] && !(beforeB.missing[r] >= afterB.missing[r])) warns.push('L\'avversario resta corto in ' + labelRole(r));
    });

    return {
      dA: dA, dB: dB, vorpA: vorpA,
      coverage: { beforeA: covBeforeA, afterA: covAfterA, beforeB: covBeforeB, afterB: covAfterB },
      beforeA: beforeA, afterA: afterA, beforeB: beforeB, afterB: afterB,
      giveA: giveA, giveB: giveB, newA: newA, newB: newB, warns: warns
    };
  }

  function labelRole(r) {
    return ({ P: 'porta', D: 'difesa', C: 'centrocampo', A: 'attacco' })[r] || r;
  }

  /* ---------- 4-quater. il mercato gratis: svincolati e valore netto ---------- */
  // Il criterio "il mio undici migliora" è incompleto: se in quel ruolo c'è uno svincolato
  // forte, lo stesso guadagno lo ottieni senza dare via niente. Qui misuro quanto vale,
  // in punti, la migliore alternativa gratuita in ogni ruolo.
  function freeMarket(pool, ownedIds, formation) {
    var owned = ownedIds || {};
    var out = {};
    CFG.ROLE_ORDER.forEach(function (r) {
      var best = null;
      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        if (!p || p.r !== r || owned[p._i != null ? p._i : i]) continue;
        var v = matchdayPoints(p);
        if (!best || v > best.ev) best = { id: p._i != null ? p._i : i, ev: v, name: p.n, team: p.t };
      }
      out[r] = best;
    });
    return out;
  }

  // quanto guadagnerei, al massimo, prendendo gratis il miglior svincolato (un solo acquisto)
  // guadagno del miglior svincolato, ruolo per ruolo: quanto alzerebbe l'undici
  function freeGains(pool, teamIds, freeByRole, formation) {
    var slots = CFG.FORMATIONS[formation] || CFG.FORMATIONS['3-4-3'];
    var by = { P: [], D: [], C: [], A: [] };
    (teamIds || []).forEach(function (id) {
      var p = pool[id];
      if (p && by[p.r]) by[p.r].push(matchdayPoints(p));
    });
    var out = {};
    CFG.ROLE_ORDER.forEach(function (r) {
      var f = freeByRole && freeByRole[r];
      var res = { gain: 0, player: null, weakest: 0, role: r };
      if (f) {
        var mine = by[r].sort(function (a, b) { return b - a; });
        var need = slots[r] || 0;
        var weakest = mine.length >= need ? mine[need - 1] : 0;
        res = { gain: f.ev - weakest, player: f, weakest: weakest, role: r };
      }
      out[r] = res;
    });
    return out;
  }

  function freeBoost(pool, teamIds, freeByRole, formation) {
    var g = freeGains(pool, teamIds, freeByRole, formation);
    var best = { gain: 0, role: null, player: null, weakest: 0 };
    CFG.ROLE_ORDER.forEach(function (r) {
      if (g[r] && g[r].gain > best.gain) best = { gain: g[r].gain, role: r, player: g[r].player, weakest: g[r].weakest };
    });
    return best;
  }

  // copertura per ruolo: quanti giocatori sopra il livello del rincalzo ho in ogni reparto
  function coverage(pool, teamIds, replacement, formation) {
    var slots = CFG.FORMATIONS[formation] || CFG.FORMATIONS['3-4-3'];
    var out = {};
    CFG.ROLE_ORDER.forEach(function (r) {
      var vals = (teamIds || []).filter(function (id) { return pool[id] && pool[id].r === r; })
        .map(function (id) { return matchdayPoints(pool[id]); });
      var need = slots[r] || 0;
      var useful = vals.filter(function (v) { return v > (replacement[r] || 0); }).length;
      out[r] = { have: vals.length, useful: useful, need: need };
    });
    return out;
  }

  /* ---------- 4-bis. quanto gli serve: la leva negoziale ---------- */
  // Se all'altro manca proprio quel ruolo, il suo titolare più debole lì è molto sotto il
  // livello del giocatore che riceve: non ha alternative, quindi accetterà condizioni peggiori.
  // need = 0..1 (0 = ha già chi gioca, 1 = è scoperto o quasi)
  function teamNeed(pool, teamIds, incomingIds, formation) {
    var slots = CFG.FORMATIONS[formation] || CFG.FORMATIONS['3-4-3'];
    var by = { P: [], D: [], C: [], A: [] };
    (teamIds || []).forEach(function (id) {
      var p = pool[id]; if (p && by[p.r]) by[p.r].push(matchdayPoints(p));
    });
    var out = { need: 0, role: null, gap: 0, short: false, weakest: 0, incoming: 0 };
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      var inc = (incomingIds || []).filter(function (id) { return pool[id] && pool[id].r === r; })
        .map(function (id) { return matchdayPoints(pool[id]); });
      if (!inc.length) return;
      var best = Math.max.apply(null, inc);
      var mine = by[r].sort(function (a, b) { return b - a; });
      var need = slots[r] || 0;
      var weakest = mine.length >= need ? mine[need - 1] : 0;
      var short = mine.length < need;
      var gap = best - weakest;
      var n = short ? 1 : clampNum(gap / 0.8, 0, 1);
      if (n > out.need) out = { need: n, role: r, gap: gap, short: short, weakest: weakest, incoming: best };
    });
    return out;
  }

  /* ---------- 5. ricerca automatica di scambi vantaggiosi ---------- */

  // regola "pari ruolo": in ogni scambio i ruoli ceduti devono corrispondere a quelli ricevuti
  function roleCounts(pool, ids) {
    var c = { P: 0, D: 0, C: 0, A: 0 };
    ids.forEach(function (id) { var p = pool[id]; if (p) c[p.r]++; });
    return c;
  }
  function roleParityOk(pool, give, receive) {
    var a = roleCounts(pool, give), b = roleCounts(pool, receive);
    return a.P === b.P && a.D === b.D && a.C === b.C && a.A === b.A;
  }

  function combinations(arr, size) {
    if (size === 1) return arr.map(function (x) { return [x]; });
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      for (var j = i + 1; j < arr.length; j++) out.push([arr[i], arr[j]]);
    }
    return out;
  }

  function findTrades(opt) {
    var pool = opt.pool, formation = opt.formation, teams = opt.teams;
    var A = opt.A.slice(), B = opt.B.slice();
    var minGain = opt.minGain == null ? 0.05 : opt.minGain;
    var minGainB = opt.minGainB == null ? minGain : opt.minGainB;   // soglia per l'altro: più bassa se paga in crediti
    var maxSize = opt.maxSize || 2;
    var limit = opt.limit || 8;
    var limitB = opt.limitB || 0;      // quante proposte "da pareggiare con i crediti" tenere
    var rule = opt.tradeRule || 'parity';   // 'parity' = stessi ruoli da entrambi i lati, 'free' = liberi

    var repl = replacementLevels(pool, teams, formation);

    // punteggi pre-calcolati per velocita'
    var ev = pool.map(matchdayPoints);
    var slots = CFG.FORMATIONS[formation];

    function scoreOf(ids) {
      var by = { P: [], D: [], C: [], A: [] };
      for (var i = 0; i < ids.length; i++) { var p = pool[ids[i]]; by[p.r].push(ev[ids[i]]); }
      var t = 0, complete = true;
      for (var k = 0; k < 4; k++) {
        var r = CFG.ROLE_ORDER[k];
        var arr = by[r].sort(function (x, y) { return y - x; });
        var need = slots[r], use = Math.min(need, arr.length);
        for (var j = 0; j < use; j++) t += arr[j];
        if (arr.length < need) complete = false;
      }
      return { t: t, complete: complete };
    }

    var baseA = scoreOf(A).t, baseB = scoreOf(B).t;
    var sizes = maxSize === 2 ? [1, 2] : [1];
    var results = [];

    sizes.forEach(function (sa) {
      var combA = combinations(A, sa);
      sizes.forEach(function (sb) {
        var combB = combinations(B, sb);
        combA.forEach(function (ga) {
          for (var i = 0; i < combB.length; i++) {
            var gb = combB[i];
            var dA = scoreOf(A.filter(function (x) { return ga.indexOf(x) === -1; }).concat(gb)).t - baseA;
            var dB = scoreOf(B.filter(function (x) { return gb.indexOf(x) === -1; }).concat(ga)).t - baseB;
            if (rule === 'parity' && !roleParityOk(pool, ga, gb)) continue;
            if (dA >= minGain && dB >= minGainB) {
              results.push({
                giveA: ga.slice(), giveB: gb.slice(), dA: dA, dB: dB,
                compensated: dB < minGain,     // a lui i punti non tornano: si pareggia in crediti
                score: Math.min(dA, dB) * 2 + (dA + dB) * 0.5
              });
            }
          }
        });
      });
    });

    results.sort(function (x, y) {
      // prima gli scambi buoni per entrambi, poi quelli da pareggiare con i crediti
      if (!!x.compensated !== !!y.compensated) return x.compensated ? 1 : -1;
      return y.score - x.score;
    });

    // deduplica: non voglio 6 proposte che ruotano attorno allo stesso giocatore.
    // Le due liste (win-win e da pareggiare in crediti) hanno una quota separata, altrimenti
    // i secondi non comparirebbero mai: sono sempre dietro in classifica.
    var out = [], used = {};
    function pick(arr, n) {
      var count = 0;
      for (var i = 0; i < arr.length && count < n; i++) {
        var r = arr[i];
        var key = r.giveA.concat(r.giveB).sort().join('-');
        var touching = r.giveA.concat(r.giveB).some(function (id) { return used[id]; });
        if (used[key] || touching) continue;
        used[key] = true;
        r.giveA.forEach(function (id) { used[id] = true; });
        r.giveB.forEach(function (id) { used[id] = true; });
        out.push(r); count++;
      }
    }
    var wins = [], comps = [];
    results.forEach(function (r) { (r.compensated ? comps : wins).push(r); });
    pick(wins, limit);
    if (limitB) pick(comps, limitB);
    return out;
  }

  var API = {
    CFG: CFG,
    priorFm: priorFm,
    expectedFm: expectedFm,
    settledFm: settledFm,
    projectedFm: projectedFm,
    setProspect: setProspect,
    calibrate: calibrate,
    creditRate: creditRate,
    creditsFor: creditsFor,
    teamNeed: teamNeed,
    freeMarket: freeMarket,
    freeBoost: freeBoost,
    clubCompetition: clubCompetition,
    hasAdv: hasAdv,
    advStats: advStats,
    xgBonusPerMatch: xgBonusPerMatch,
    injuryProfile: injuryProfile,
    starterProfile: starterProfile,
    bonusPer90: bonusPer90,
    absenceRate: absenceRate,
    freeGains: freeGains,
    coverage: coverage,
    creditRateLevel: creditRateLevel,
    playProb: playProb,
    minuteShare: minuteShare,
    matchdayPoints: matchdayPoints,
    replacementLevels: replacementLevels,
    vorp: vorp,
    teamScore: teamScore,
    analyzeTrade: analyzeTrade,
    findTrades: findTrades,
    labelRole: labelRole,
    projection: projection,
    historicalFm: historicalFm,
    momentum: momentum,
    scheduleEase: scheduleEase,
    teamRates: teamRates,
    calendarBoard: calendarBoard,
    matchEase: matchEase,
    explainTrade: explainTrade,
    roleParityOk: roleParityOk,
    roleCounts: roleCounts
  };

  root.Model = API;
})(typeof window !== 'undefined' ? window : global);
