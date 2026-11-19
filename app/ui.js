/* FantaTrade - interfaccia (vanilla JS, nessuna dipendenza) */
(function () {
  'use strict';

  var M = window.Model;
  var CTX = window.FANTATRADE_CTX || null;   // calendario + forza squadre (context.json)
  var SEED_LEAGUES = window.FANTATRADE_LEAGUES || [];   // leghe importate dagli export di Fantacalcio.it
  var POOL = window.FANTATRADE_DATA || [];
  var ROLE_NAME = { P: 'Portieri', D: 'Difensori', C: 'Centrocampisti', A: 'Attaccanti' };
  var REP = { P: 'in porta', D: 'in difesa', C: 'a centrocampo', A: 'in attacco' };

  /* ---------- utility ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function fmt(v, d) {
    d = d == null ? 2 : d;
    if (v == null || !isFinite(v)) return '–';
    return v.toFixed(d).replace('.', ',');
  }
  function sgn(v, d) { return (v > 0 ? '+' : '') + fmt(v, d); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function norm(s) {
    return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function esc(s) { return (s || '').replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  var toastTimer;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------- stato ---------- */
  var state = {
    teams: 10,
    formation: '3-4-3',
    gwLeft: 27,
    horizon: 5,                 // quante partite guardare avanti per il calendario
    tradeRule: 'parity',        // 'parity' = scambi pari ruolo, 'free' = ruoli misti liberi
    useCal: true,               // il calendario entra nei punti attesi
    findAll: false,             // 'trova scambi' su tutte le squadre della lega
    leagueSel: 0,               // lega mostrata nella scheda Lega
    leagues: [],                // [{name, teams:[{name, players:[], me:true}]}]
    active: 0,                  // lega attiva
    my: 0,                      // indice della mia squadra nella lega attiva
    opp: 1,                     // indice dell'avversario selezionato
    sel: { A: [], B: [] },
    depth: 2,
    dataRole: 'ALL',
    dataQuery: '',
    cmpA: '', cmpB: '',
    dataSort: { key: 'ev', dir: -1 },
    prospect: 0.65,     // quanto pesa il "farà" rispetto al "ha fatto" (0..1)
    useCredits: true,   // conguaglio in crediti per pareggiare gli scambi
    useFree: freeWindowOpen(),   // confronto col mercato libero: solo nella finestra dell'asta di riparazione
    offersAsym: true,   // cerca anche scambi in cui l'altro perde punti, ma incassa crediti
    history: [],        // ultimi scambi applicati, per poterli annullare
    avail: {}          // id giocatore -> 'certo' | 'dubbio' | 'out'
  };

  // indice per id -> giocatore
  var byId = POOL.map(function (p, i) { p._i = i; return p; });
  var bySid = {};
  POOL.forEach(function (p, i) { if (p.sid) bySid[p.sid] = i; });
  function P(id) { return POOL[id]; }

  // applico gli stati dichiarati a mano sui giocatori (il modello li legge come statusManual)
  function curLeague() { return state.leagues[state.active] || state.leagues[0]; }
  function teamA() { var L = curLeague(); return L.teams[state.my] || L.teams[0]; }
  function teamB() { var L = curLeague(); return L.teams[state.opp] || L.teams[1] || L.teams[0]; }
  function R(side) { return (side === 'A' ? teamA() : teamB()).players; }
  function setR(side, arr) { (side === 'A' ? teamA() : teamB()).players = arr; }

  // calendario: quanto e' facile la prossima serie di partite, per squadra e ruolo (0..1, 0,5 = media)
  var easeCache = {};
  var calDistCache = {};
  function resetEaseCache() { easeCache = {}; calDistCache = {}; }
  function easeOf(team, role) {
    var k = team + '|' + role;
    var v = easeCache[k];
    if (v == null) { v = M.scheduleEase(CTX, team, role, state.horizon).ease; easeCache[k] = v; }
    return v;
  }
  function applyEase() {
    var use = state.useCal && CTX && CTX.rounds;
    for (var i = 0; i < POOL.length; i++) {
      var p = POOL[i];
      p.easeOverride = use ? easeOf(p.t, p.r) : null;
    }
  }

  // I crediti spesi all'asta non entrano nel valore dei giocatori: servono solo a calcolare
  // quanti crediti restano a ogni squadra per un eventuale conguaglio.


  function applyAvail() {
    for (var i = 0; i < POOL.length; i++) POOL[i].statusManual = state.avail[i] || null;
  }
  function ev(id) { return M.matchdayPoints(P(id)); }

  // facilità del calendario in percentile sulle 20 squadre di Serie A: 50 = media,
  // 80 = tra i calendari più morbidi. La facilità grezza di 5 giornate varia poco:
  // senza normalizzare, tutti i valori sembrano uguali.
  function calDist(role) {
    var key = role + '|' + state.horizon;
    if (!calDistCache[key]) {
      var names = Object.keys(M.teamRates(CTX) || {});
      calDistCache[key] = names.map(function (t) { return M.scheduleEase(CTX, t, role, state.horizon).ease; })
        .sort(function (a, b) { return a - b; });
    }
    return calDistCache[key];
  }
  function calPct(team, role) {
    if (!CTX) return 0.5;
    var arr = calDist(role);
    var v = M.scheduleEase(CTX, team, role, state.horizon).ease;
    var below = 0;
    for (var i = 0; i < arr.length; i++) if (arr[i] <= v) below++;
    return arr.length ? below / arr.length : 0.5;
  }

  // crediti disponibili di una squadra: budget di lega meno quello che ha speso all'asta.
  // Man mano che si applicano scambi con conguaglio, il saldo si aggiorna.
  function spentOf(t) {
    var spent = 0;
    Object.keys((t && t.paid) || {}).forEach(function (k) { spent += t.paid[k]; });
    return spent;
  }
  // budget di lega: se non è noto lo deduco dalla squadra che ha speso di più (arrotondato
  // per eccesso a 250, minimo 500). Prima qui c'era un 500 fisso di ripiego: nelle leghe
  // importate dentro l'app, che arrivavano con budget 0, TUTTI i residui venivano calcolati
  // su 500 e sembravano sbagliati (una lega da 1000 mostrava metà dei crediti).
  function leagueBudget() {
    var L = curLeague() || {}, b = +L.budget || 0;
    if (b > 0) return b;
    var mx = 0;
    (L.teams || []).forEach(function (t) { mx = Math.max(mx, spentOf(t)); });
    return mx ? Math.max(500, Math.ceil(mx / 250) * 250) : 500;
  }
  function availCredits(t) {
    if (!t) return 0;
    if (typeof t.credits === 'number') return t.credits;
    return Math.max(0, leagueBudget() - spentOf(t));
  }
  // speso più del budget: succede quando i crediti si sono mossi negli scambi, o quando
  // i prezzi importati non sono quelli della lega. Meglio dirlo che mostrare 0 e basta.
  function overBudget(t) { var b = leagueBudget(); return b > 0 && spentOf(t) > b + 1; }
  function setCredits(t, v) { if (t) t.credits = Math.max(0, Math.round(v)); }

  // tariffa crediti/punto stimata sui prezzi davvero pagati in questa lega
  var rateCache = null;
  function creditRateNow() {
    if (rateCache != null) return rateCache;
    var L = curLeague(), samples = [];
    (L.teams || []).forEach(function (t) {
      Object.keys(t.paid || {}).forEach(function (k) {
        var i = +k;
        if (POOL[i]) samples.push({ ev: ev(i), paid: t.paid[k] });
      });
    });
    rateCache = M.creditRate(samples);
    return rateCache;
  }

  // livello dei giocatori scambiati: serve al tasso di cambio (il punto vale più sui top)
  function levelOf(groups) {
    var all = [];
    groups.forEach(function (g) { (g || []).forEach(function (id) { if (POOL[id]) all.push(ev(id)); }); });
    if (!all.length) return 6.5;
    return all.reduce(function (a, b) { return a + b; }, 0) / all.length;
  }

  // gli svincolati si prendono solo all'asta di riparazione (febbraio): fuori da quella
  // finestra il mercato libero non e' un'alternativa vera a uno scambio
  function freeWindowOpen(d) {
    var w = (M.CFG && M.CFG.FREE_WINDOW) || { fromMonth: 0, fromDay: 20, toMonth: 1, toDay: 20 };
    d = d || new Date();
    var m = d.getMonth(), day = d.getDate();
    return (m === w.fromMonth && day >= w.fromDay) || (m === w.toMonth && day <= w.toDay);
  }

  // migliori svincolati per ruolo nella lega (cache: cambia solo se cambiano le rose)
  var freeCache = null;
  function freeMarketNow() {
    if (freeCache) return freeCache;
    var owned = {};
    curLeague().teams.forEach(function (t) { t.players.forEach(function (id) { owned[id] = 1; }); });
    freeCache = M.freeMarket(POOL, owned, state.formation);
    return freeCache;
  }

  // guadagno NETTO: tolgo quello che otterrei gratis dal mercato degli svincolati
  // quanto alzerebbero l'undici i titolari di un ruolo (somma dei migliori "need")
  function roleTop(ids, r, slots) {
    var vals = ids.filter(function (id) { return POOL[id] && POOL[id].r === r; })
      .map(function (id) { return ev(id); }).sort(function (a, b) { return b - a; });
    return vals.slice(0, slots[r] || 0).reduce(function (a, b) { return a + b; }, 0);
  }

  // migliore alternativa concreta in lega per un ruolo: la migliore offerta gia' calcolata
  function altForRole(role) {
    var L = offerCache && offerCache.list;
    if (!L || !L.length) return null;
    var best = null;
    L.forEach(function (o) {
      var v = (o.nr && o.nr[role] != null) ? o.nr[role] : -9;
      if (o.dl && o.dl[role] > 0.02 && v > (best ? best.v : -9)) best = { o: o, v: v };
    });
    if (!best || best.v <= 0.02) return null;
    return { gain: best.v, opp: best.o.opp };
  }

  // delta dell'undici, ruolo per ruolo (prima -> dopo lo scambio)
  function myRoleDeltas(giveIds, recvIds, teamIds) {
    var slots = M.CFG.FORMATIONS[state.formation] || M.CFG.FORMATIONS['3-4-3'];
    var team = teamIds || teamA().players;
    var give = giveIds || [], recv = recvIds || [];
    var after = team.filter(function (id) { return give.indexOf(id) < 0; }).concat(recv);
    var d = {};
    ['P', 'D', 'C', 'A'].forEach(function (r) { d[r] = roleTop(after, r, slots) - roleTop(team, r, slots); });
    return d;
  }

  // guadagno NETTO di uno scambio: i miglioramenti valgono solo nella misura in cui
  // il mercato degli svincolati non me li dia già, ruolo per ruolo; le perdite contano tutte
  function netOf(trade, oppIndex) {
    if (!trade) return { netA: 0, netB: 0, freeA: { gain: 0 }, freeB: { gain: 0 }, roles: [] };
    var slots = M.CFG.FORMATIONS[state.formation] || M.CFG.FORMATIONS['3-4-3'];
    var opp = curLeague().teams[oppIndex == null ? state.opp : oppIndex];
    var free = freeMarketNow();
    var give = trade.giveA || [], recv = trade.giveB || [];
    var giveB2 = trade.giveB || [], recvB2 = trade.giveA || [];   // speculare per l'altro
    var mine = teamA().players, theirs = opp ? opp.players : [];
    if (!state.useFree) {
      // confronto spento: il guadagno lordo e' l'unico metro
      return { netA: trade.dA || 0, netB: trade.dB || 0, freeA: { gain: 0 }, freeB: { gain: 0 }, roles: [], off: true };
    }

    function deltas(team, outIds, inIds) {
      var after = team.filter(function (id) { return outIds.indexOf(id) < 0; }).concat(inIds);
      var d = {};
      ['P', 'D', 'C', 'A'].forEach(function (r) { d[r] = roleTop(after, r, slots) - roleTop(team, r, slots); });
      return d;
    }
    void slots;
    function net(d, fg) {
      var tot = 0, roles = [];
      ['P', 'D', 'C', 'A'].forEach(function (r) {
        var g = d[r] || 0;
        var freeG = Math.max(0, (fg[r] && fg[r].gain) || 0);
        var n = g > 0 ? Math.max(0, g - freeG) : g;
        tot += n;
        if (Math.abs(g) > 0.02) roles.push({ role: r, gain: g, free: freeG, net: n, freePlayer: fg[r] && fg[r].player });
      });
      return { tot: tot, roles: roles };
    }
    var fa = M.freeGains(POOL, mine, free, state.formation);
    var fb = M.freeGains(POOL, theirs, free, state.formation);
    var na = net(deltas(mine, give, recv), fa);
    var nb = net(deltas(theirs, recvB2, giveB2), fb);
    var bestFreeA = { gain: 0, player: null, role: null };
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      if (fa[r] && fa[r].gain > bestFreeA.gain) bestFreeA = { gain: fa[r].gain, player: fa[r].player, role: r };
    });
    var bestFreeB = { gain: 0, player: null, role: null };
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      if (fb[r] && fb[r].gain > bestFreeB.gain) bestFreeB = { gain: fb[r].gain, player: fb[r].player, role: r };
    });
    return { netA: na.tot, netB: nb.tot, freeA: bestFreeA, freeB: bestFreeB, roles: na.roles, rolesB: nb.roles };
  }

  // quanto serve all'avversario il ruolo che riceve: è la leva negoziale
  function needFor(oppIndex, myPlayers) {
    var opp = curLeague().teams[oppIndex == null ? state.opp : oppIndex];
    if (!opp || !opp.players.length) return { need: 0 };
    return M.teamNeed(POOL, opp.players, myPlayers || [], state.formation);
  }

  // conguaglio per pareggiare lo scambio: chi guadagna più punti mette i crediti
  function creditFor(dA, dB, oppIndex, groups) {
    if (!state.useCredits) return { credits: 0, payer: null, off: true };
    var c = M.creditsFor(dA, dB, creditRateNow(), levelOf(groups || [state.sel.A, state.sel.B]));
    // leva: se a lui serve proprio quel ruolo, ha meno alternative
    var nd = needFor(oppIndex, (groups && groups[0]) || state.sel.A);
    c.need = nd;
    if (c.credits > 0 && nd.need > 0) {
      var mult = c.payer === 'him' ? 1 + 0.6 * nd.need : 1 - 0.5 * nd.need;
      c.credits = Math.max(5, Math.round(c.credits * mult / 5) * 5);
      c.leverage = mult;
    }
    if (!c.credits) return c;
    var opp = curLeague().teams[oppIndex == null ? state.opp : oppIndex];
    var payer = c.payer === 'me' ? teamA() : opp;
    c.avail = availCredits(payer);
    c.over = c.credits > c.avail;
    return c;
  }

  function repl() { return M.replacementLevels(POOL, state.teams, state.formation); }
  function vorpOf(id) { return M.vorp(P(id), repl()); }

  // titolari non garantiti: probabilità di giocare bassa, quindi punti attesi fragili.
  // Niente prezzi: il criterio è solo la probabilità di scendere in campo.
  function riskyOf(ids) {
    var slots = M.CFG.FORMATIONS[state.formation] || M.CFG.FORMATIONS['3-4-3'];
    var out = [];
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      (ids || []).filter(function (id) { return POOL[id] && POOL[id].r === r; })
        .map(function (id) { return { id: id, pts: ev(id), pp: M.playProb(P(id)), pres: P(id).pres || 0 }; })
        .sort(function (a, b) { return b.pts - a.pts; })
        .slice(0, slots[r] || 0)
        .forEach(function (x) {
          if (x.pp < 0.62) out.push({ p: POOL[x.id], pp: x.pp, pts: x.pts });
        });
    });
    out.sort(function (a, b) { return a.pp - b.pp; });
    return out.slice(0, 8);
  }


  /* ---------- memoria locale (se il browser la consente) ---------- */
  var STORE_KEY = 'fantatrade.v1';

  function snapshot() {
    return {
      v: 3,
      lg: state.leagues.map(function (L) {
        return { n: L.name, k: L.k, b: L.budget,
                 t: L.teams.map(function (t) { return { n: t.name, me: !!t.me, p: t.players, pp: t.paid, cr: t.credits }; }) };
      }),
      pr: state.prospect, uc: state.useCredits,
      my: state.my, opp: state.opp, la: state.active,
      t: state.teams, f: state.formation, g: state.gwLeft, h: state.horizon, r: state.tradeRule,
      av: state.avail
    };
  }
  function applySnapshot(d) {
    if (!d) return false;
    if (d.lg && d.lg.length) {
      state.leagues = d.lg.map(function (L) {
        return {
          name: L.n || 'Lega', k: L.k || 1, budget: L.b || 0,
          teams: (L.t || []).map(function (t) {
            var paid = {};
            Object.keys(t.pp || {}).forEach(function (x) { paid[+x] = t.pp[x]; });
            return { name: t.n || 'Squadra', me: !!t.me, paid: paid, credits: (typeof t.cr === 'number' ? t.cr : undefined),
                     players: (t.p || []).filter(function (i) { return POOL[i]; }) };
          })
        };
      });
      state.my = d.my || 0;
      state.opp = d.opp == null ? 1 : d.opp;
    } else {
      // formato vecchio (due sole rose): lo converto in una lega
      state.leagues = [{ name: 'La mia lega', teams: [
        { name: d.na || 'La mia squadra', me: true, players: (d.a || []).filter(function (i) { return POOL[i]; }) },
        { name: d.nb || 'Avversario', me: false, players: (d.b || []).filter(function (i) { return POOL[i]; }) }
      ] }];
      state.my = 0; state.opp = 1;
    }
    state.active = Math.max(0, Math.min(d.la || 0, state.leagues.length - 1));
    state.teams = d.t || state.teams;
    state.formation = d.f || state.formation;
    state.gwLeft = d.g || state.gwLeft;
    state.horizon = d.h || state.horizon;
    state.tradeRule = d.r || state.tradeRule;
    if (typeof d.pr === 'number') state.prospect = d.pr;
    if (typeof d.uc === 'boolean') state.useCredits = d.uc;
    state.avail = d.av || {};
    return true;
  }

  // codifica UTF-8 -> base64, per mettere le rose dentro il link
  function enc(str) {
    try { return btoa(unescape(encodeURIComponent(str))).replace(/=+$/, ''); } catch (e) { return ''; }
  }
  function dec(b64) {
    try { return decodeURIComponent(escape(atob(b64))); } catch (e) { return ''; }
  }
  function stateToHash() {
    var json = JSON.stringify(snapshot());
    return '#s=' + enc(json);
  }

  function saveState() {
    var snap = snapshot();
    var json = JSON.stringify({
      lg: snap.lg, my: snap.my, opp: snap.opp,
      teams: snap.t, formation: snap.f, gwLeft: snap.g, horizon: snap.h, tradeRule: snap.r, avail: snap.av,
      pr: snap.pr, uc: snap.uc
    });
    try { localStorage.setItem(STORE_KEY, json); } catch (e) { /* storage non disponibile */ }
    try { history.replaceState(null, '', stateToHash()); } catch (e) { /* iframe sandbox */ }
  }
  function loadState() {
    // 1. il link ha la precedenza
    try {
      var m = /[#&]s=([A-Za-z0-9+/=_-]+)/.exec(window.location.hash || '');
      if (m) {
        var fromHash = JSON.parse(dec(m[1]));
        if (applySnapshot(fromHash)) return true;
      }
    } catch (e) { /* hash non valido */ }
    // 2. memoria del browser
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (!d) return false;
      if (d.lg) {
        var snap = {
          lg: d.lg, my: d.my, opp: d.opp, la: d.la,
          na: d.na, nb: d.nb, a: d.a, b: d.b,
          t: d.teams, f: d.formation, g: d.gwLeft, h: d.horizon, r: d.tradeRule, av: d.avail
        };
        return applySnapshot(snap);
      }
      return applySnapshot(d);
    } catch (e) { return false; }
  }

  /* ---------- rose di esempio (asimmetriche: serve a far vedere scambi sensati) ---------- */
  function rankIds(role) {
    return POOL.map(function (p, i) { return { i: i, ev: M.matchdayPoints(p) }; })
      .filter(function (x) { return POOL[x.i].r === role; })
      .sort(function (a, b) { return b.ev - a.ev; })
      .map(function (x) { return x.i; });
  }
  function pickFrom(arr, idxs) { return idxs.filter(function (k) { return arr[k] != null; }).map(function (k) { return arr[k]; }); }
  function prng(seed) {
    var s = seed;
    return function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  }
  function shuffled(arr, rnd) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // lega demo: 10 squadre costruite come dopo un'asta vera — chi ha speso in attacco
  // resta corto in difesa e viceversa. Cosi' gli scambi hanno davvero senso.
  function demoLeague() {
    var rank = { P: rankIds('P'), D: rankIds('D'), C: rankIds('C'), A: rankIds('A') };
    var shapes = [
      { P: 2, D: 3, C: 8, A: 7 },   // la tua: corta in difesa, lunga davanti
      { P: 2, D: 8, C: 6, A: 4 },
      { P: 2, D: 5, C: 7, A: 6 },
      { P: 2, D: 7, C: 6, A: 5 },
      { P: 2, D: 6, C: 6, A: 6 },
      { P: 2, D: 9, C: 5, A: 4 },
      { P: 2, D: 6, C: 8, A: 4 },
      { P: 2, D: 7, C: 7, A: 4 },
      { P: 3, D: 6, C: 7, A: 4 },
      { P: 2, D: 5, C: 8, A: 5 }
    ];
    var n = Math.min(shapes.length, Math.max(6, state.teams));
    var rnd = prng(20261115);
    var teams = [];
    for (var i = 0; i < n; i++) {
      teams.push({ name: i === 0 ? 'I Tuoi' : 'Squadra ' + (i + 1), players: [], me: i === 0 });
    }
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      var pool = rank[r].slice(), order = shuffled(teams.map(function (t, i) { return i; }), rnd), cur = 0;
      order.forEach(function (i) {
        for (var k = 0; k < shapes[i][r]; k++) { var id = pool[cur++]; if (id != null) teams[i].players.push(id); }
      });
    });
    return { name: 'Lega demo (' + n + ' squadre)', teams: teams };
  }

  // carico le leghe esportate da Fantacalcio.it (rose + crediti spesi)
  function syncTeamsCount() {
    var L = curLeague();
    if (L && L.teams && L.teams.length) {
      state.teams = L.teams.length;
      var el = $('#valTeams');
      if (el) el.textContent = state.teams;
    }
  }

  function loadLeagues(list) {
    state.leagues = list.map(function (L) {
      var paid = {};
      Object.keys(L.paid || {}).forEach(function (k) { paid[+k] = L.paid[k]; });
      var teams = (L.teams || []).map(function (t) {
        var p2 = {};
        var ids = [];
        var fromSids = false;
        if (t.sids && t.sids.length) {
          // le rose salvate con gli id ufficiali: se il listone è stato riordinato, le
          // posizioni non valgono più, gli id sì
          var ps = {}, ok = 0;
          t.sids.forEach(function (sid) {
            var i2 = bySid[sid];
            if (i2 != null && POOL[i2]) { ids.push(i2); ok++; }
          });
          if (ok >= t.sids.length - 2) {
            fromSids = true;
            Object.keys(t.paidSid || {}).forEach(function (sid) {
              var i3 = bySid[+sid];
              if (i3 != null) ps[i3] = t.paidSid[sid];
            });
          }
        }
        if (!fromSids) {
          ids = (t.players || []).filter(function (i) { return POOL[i]; });
          Object.keys(t.paid || {}).forEach(function (k) { p2[+k] = t.paid[k]; });
        } else {
          p2 = ps;
        }
        // i crediti dichiarati (quelli veri, letti su Fantacalcio.it) viaggiano con la lega:
        // senza questo campo l'app li perdeva al caricamento e ricalcolava la stima
        return { name: t.name || 'Squadra', me: !!t.me, players: ids, paid: p2,
                 credits: (typeof t.credits === 'number' ? t.credits : undefined) };
      });
      var hasMe = teams.some(function (t) { return t.me; });
      if (!hasMe && teams.length) teams[0].me = true;
      return { name: L.name || 'Lega', k: L.k || 1, budget: L.budget || 0, paid: paid, teams: teams };
    });
    state.active = 0; state.sel = { A: [], B: [] };
    var L0 = state.leagues[0];
    if (L0) {
      L0.teams.forEach(function (t, i) { if (t.me) state.my = i; });
      state.opp = state.my === 0 ? (L0.teams.length > 1 ? 1 : 0) : 0;
    }
    syncTeamsCount();
  }

  function loadDemo() {
    state.leagues = [demoLeague()];
    state.active = 0; state.my = 0; state.opp = 1;
    state.sel = { A: [], B: [] };
    renderAll();
  }

  /* ---------- ricerca giocatori ---------- */
  function searchPool(q, exclude) {
    var nq = norm(q);
    if (!nq) return [];
    var out = POOL.map(function (p, i) {
      var n = norm(p.n + ' ' + p.t);
      var score = -1;
      var np = norm(p.n);
      if (np === nq) score = 100;
      else if (np.indexOf(nq) === 0) score = 80;
      else if (n.indexOf(nq) >= 0) score = 60;
      else if (nq.split(' ').every(function (w) { return n.indexOf(w) >= 0; })) score = 40;
      return score < 0 ? null : { i: i, score: score, p: p };
    }).filter(Boolean).filter(function (x) { return exclude.indexOf(x.i) === -1; });
    out.sort(function (a, b) { return b.score - a.score || M.matchdayPoints(b.p) - M.matchdayPoints(a.p); });
    return out.slice(0, 8);
  }

  function attachSearch(inputEl, sugEl, side) {
    function render() {
      var list = searchPool(inputEl.value, R(side));
      sugEl.innerHTML = list.map(function (x) {
        return '<div class="item" data-id="' + x.i + '"><span class="badge ' + x.p.r + '">' + x.p.r + '</span>' +
          '<span>' + esc(x.p.n) + ' <span style="color:var(--dim);font-size:11.5px">' + esc(x.p.t) + '</span></span>' +
          '<span class="meta">' + fmt(M.matchdayPoints(x.p), 2) + ' pt/g</span></div>';
      }).join('');
    }
    inputEl.addEventListener('input', render);
    inputEl.addEventListener('focus', render);
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var first = sugEl.querySelector('.item');
        if (first) first.click();
      }
      if (e.key === 'Escape') { sugEl.innerHTML = ''; inputEl.blur(); }
    });
    document.addEventListener('click', function (e) {
      if (!sugEl.contains(e.target) && e.target !== inputEl) sugEl.innerHTML = '';
    });
    sugEl.addEventListener('click', function (e) {
      var item = e.target.closest('.item');
      if (!item) return;
      var id = +item.getAttribute('data-id');
      if (R(side).indexOf(id) === -1) R(side).push(id);
      inputEl.value = ''; sugEl.innerHTML = '';
      renderAll();
    });
  }

  /* ---------- rendering rose ---------- */
  function renderRoster(side) {
    var ul = side === 'A' ? $('#rosA') : $('#rosB');
    var ids = R(side).slice();
    var order = { P: 0, D: 1, C: 2, A: 3 };
    ids.sort(function (a, b) { return order[P(a).r] - order[P(b).r] || ev(b) - ev(a); });
    $('#count' + side).textContent = ids.length;
    if (!ids.length) {
      ul.innerHTML = '<li class="empty">Rosa vuota: cerca un giocatore qui sopra oppure <b>incolla la tua rosa</b>.</li>';
      return;
    }
    ul.innerHTML = ids.map(function (id) {
      var p = P(id), on = state.sel[side].indexOf(id) >= 0;
      return '<li data-id="' + id + '" data-side="' + side + '" class="' + (on ? 'sel' : '') + '">' +
        '<span class="mark">✓</span>' +
        '<span class="badge ' + p.r + '">' + p.r + '</span>' +
        '<span style="min-width:0"><span class="nm">' + esc(p.n) + '</span> <span class="tm">' + esc(p.t) + '</span>' +
          fuoriBadge(id) + '</span>' +
        '<span class="avail ' + (state.avail[id] || '') + '" data-avail="' + id + '" title="Stato: clicca per cambiare (disponibile → in dubbio → out)">' +
          (state.avail[id] === 'out' ? '✕' : state.avail[id] === 'dubbio' ? '!' : '✓') + '</span>' +
        (function () {
          var pr = M.projection(p);
          var ar = pr.label === 'crescita' ? '↗' : pr.label === 'calo' ? '↘' : '→';
          return '<span class="tr ' + pr.label + '" data-trend="' + id + '" title="' + esc(pr.why) + ' (fiducia ' + pr.confidence + '%)">' + ar + '</span>';
        })() +
        '<span class="nums">' +
        '<span class="fm" title="fantamedia attesa: da ' + fmt(p.fm, 2) + ' a ' + fmt(M.expectedFm(p), 2) + '">' + (p.fm ? fmt(p.fm, 2) : '–') + '</span>' +
        '<span class="pts">' + fmt(ev(id), 2) + '</span>' +
        '<span class="del" data-del="' + id + '" title="Togli dalla rosa">×</span></span></li>';
    }).join('');
  }

  function currentResult() {
    return M.analyzeTrade({
      pool: POOL,
      A: R('A'), B: R('B'),
      giveA: state.sel.A, giveB: state.sel.B,
      formation: state.formation, teams: state.teams
    });
  }

  function roleSums(ids) {
    var slots = M.CFG.FORMATIONS[state.formation], out = {};
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      var arr = ids.filter(function (id) { return P(id).r === r; }).map(ev).sort(function (a, b) { return b - a; });
      var s = 0; for (var i = 0; i < Math.min(slots[r], arr.length); i++) s += arr[i];
      out[r] = s;
    });
    return out;
  }

  function renderSummary() {
    var gA = state.sel.A, gB = state.sel.B;

    function chips(ids, side) {
      if (!ids.length) return '<span class="emptyc">nessuno</span>';
      return ids.map(function (id) {
        var p = P(id);
        return '<span class="chip"><span class="badge ' + p.r + '">' + p.r + '</span><b>' + esc(p.n) + '</b>' +
          '<span class="mt">' + esc(p.t) + '</span>' + fuoriBadge(id) +
          '<span class="x" data-remove="' + id + '" data-side="' + side + '">×</span></span>';
      }).join('');
    }
    $('#giveChips').innerHTML = chips(gA, 'A');
    $('#getChips').innerHTML = chips(gB, 'B');

    function totals(ids) {
      var pts = ids.reduce(function (t, id) { return t + ev(id); }, 0);
      var vo = ids.reduce(function (t, id) { return t + vorpOf(id); }, 0);
      return '<b>' + ids.length + '</b> giocator' + (ids.length === 1 ? 'e' : 'i') +
        ' · <b>' + fmt(pts, 2) + '</b> pt/g totali' +
        (ids.length ? ' · <b>' + fmt(vo, 2) + '</b> sopra il rincalzo' : '');
    }
    $('#giveTot').innerHTML = totals(gA);
    $('#getTot').innerHTML = totals(gB);
    $('#btnApply').disabled = !(gA.length || gB.length);

    // chips: rimozione
    $$('.x', $('#giveChips').parentNode).forEach(function (x) {
      x.addEventListener('click', function () {
        var id = +x.getAttribute('data-remove'), side = x.getAttribute('data-side');
        state.sel[side] = state.sel[side].filter(function (i) { return i !== id; });
        renderAll();
      });
    });
    $$('.x', $('#getChips').parentNode).forEach(function (x) {
      x.addEventListener('click', function () {
        var id = +x.getAttribute('data-remove'), side = x.getAttribute('data-side');
        state.sel[side] = state.sel[side].filter(function (i) { return i !== id; });
        renderAll();
      });
    });
  }


  // profilo del giocatore: titolare/ballottaggio/riserva, chi ha davanti, quante giornate ha saltato
  function profileOf(id) { return M.starterProfile(POOL, id); }

  function profileNote(id) {
    // fuori / probabile titolare vengono prima del profilo: contano piu' di tutto il resto
    var out = [];
    var fuori = M.outNote(POOL[id]);
    if (fuori) out.push(fuori.tipo === 'squalificato' ? 'squalificato'
      : fuori.tipo === 'dubbio' ? 'in dubbio' : 'fuori (infortunio)');
    var lu = M.starterProb(POOL[id]);
    if (lu != null) out.push('titolare ' + Math.round(lu * 100) + '%');
    var sp = profileOf(id); if (!sp) return out.join(' · ');
    if (sp.rival) out.push('ballottaggio con ' + esc(POOL[sp.rival.id].n));
    else if (sp.aheadOf && (sp.label === 'primo cambio' || sp.label === 'riserva')) out.push('dietro ' + esc(POOL[sp.aheadOf.id].n));
    if (sp.missed >= 2) out.push(sp.missed + ' giornate saltate');
    var b90 = M.bonusPer90(POOL[id]);
    if (b90 != null && b90 >= 0.15) out.push(fmt(b90, 2) + ' bonus/90');
    var a = M.advStats(POOL[id]);
    if (a && a.finishing != null && Math.abs(a.finishing) >= 1) {
      out.push(Math.abs(a.finishing) >= 0.01
        ? Math.round(POOL[id].gol || 0) + ' gol con ' + fmt(a.xg, 1) + ' di xG'
        : '');
    }
    if (a && a.assVsXa != null && Math.abs(a.assVsXa) >= 0.8) {
      out.push(Math.round(POOL[id].ass || 0) + ' assist con ' + fmt(a.xa, 1) + ' di xA');
    }
    var inj = M.injuryProfile(POOL[id]);
    if (inj && inj.days > 0) out.push(inj.days + ' giorni fuori in 2 stagioni (' + inj.episodes + ' episodi)');
    return out.filter(Boolean).join(' · ');
  }

  // riga "contro" quando il giocatore che arriva ha il posto in bilico
  function riskLine(id) {
    // chi e' fuori oggi e' il rischio numero uno, prima di qualunque ragionamento sui numeri
    var fuori = outBody(POOL[id]);
    if (fuori.tipo) {
      var quando = fuori.rientro
        ? ' Rientro previsto: ' + fuori.rientro.charAt(0).toLowerCase() + fuori.rientro.slice(1) + '.'
        : '';
      if (fuori.giorni != null) {
        quando += ' Sono circa ' + Math.max(1, Math.round(fuori.giorni / 7)) + ' giornate di stop: ' +
          'i punti attesi qui sopra sono già mediati su questo, non sono quelli di quando rientra.';
      }
      return {
        t: esc(POOL[id].n) + (fuori.tipo === 'squalificato' ? ' è squalificato'
          : fuori.tipo === 'dubbio' ? ' è in dubbio' : ' è fuori (infortunio)'),
        d: (fuori.text || 'Indisponibile secondo Fantacalcio.it.') + quando +
          ' I punti attesi qui sopra scontano già lo stop (probabilità di giocare al ' +
          Math.round(M.playProb(POOL[id]) * 100) + '%): se rientra prima valgono di più, ' +
          'ma finché è fuori non ti dà niente.'
      };
    }
    var sp = profileOf(id); if (!sp) return null;
    if (sp.rival) return { t: esc(POOL[id].n) + ' è in ballottaggio con ' + esc(POOL[sp.rival.id].n),
      d: 'Stesso ruolo, stesso club: tu lo paghi ' + fmt(ev(id), 2) + ' pt/g, il concorrente ne vale ' + fmt(sp.rival.ev, 2) + '. Se il posto lo perde, scende verso ' + fmt(sp.fallback, 2) + ': è un rischio che i punti attesi non prezzano.' };
    if (sp.aheadOf && (sp.label === 'primo cambio' || sp.label === 'riserva')) return { t: esc(POOL[id].n) + ' oggi è ' + sp.label + ' dietro ' + esc(POOL[sp.aheadOf.id].n),
      d: 'Lo prendi per la panchina: nell\'undici ci metti ' + esc(POOL[sp.aheadOf.id].n) + ' (' + fmt(sp.aheadOf.ev, 2) + ').' };
    var inj = M.injuryProfile(POOL[id]);
    if (inj && inj.perGw >= 0.15) return { t: esc(POOL[id].n) + ' è fragile: ' + inj.days + ' giorni fuori in due stagioni',
      d: Math.round(inj.perGw * 100) + '% delle giornate perse per infortunio, ' + inj.episodes + ' episodi: è un rischio in più rispetto a chi non si ferma mai.' };
    if (sp.missed >= 4) return { t: esc(POOL[id].n) + ' ha già saltato ' + sp.missed + ' giornate su ' + M.CFG.GW,
      d: 'Non è un problema di rendimento ma di presenza: nel conteggio dei punti attesi pesa già, qui te lo dico in chiaro.' };
    return null;
  }

  function comparisonTable(res) {
    var rows = state.sel.A.map(function (id) { return { id: id, out: true }; })
      .concat(state.sel.B.map(function (id) { return { id: id, out: false }; }));
    if (!rows.length) return '';
    return '<div class="cmp"><table><thead><tr><th>Movimento</th><th>Giocatore</th><th>Pres</th><th>Min%</th><th>FM fatta</th><th>Proiez.</th><th>Attesa</th><th>Pt/g</th><th>Sopra rincalzo</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var p = P(r.id);
        return '<tr><td><span class="side ' + (r.out ? 'out' : 'in') + '">' + (r.out ? 'DAI' : 'RICEVI') + '</span></td>' +
          '<td class="nm"><span class="badge ' + p.r + '" style="display:inline-flex;margin-right:6px">' + p.r + '</span>' + esc(p.n) + ' <span style="color:var(--dim);font-weight:400">' + esc(p.t) + '</span>' +
            '<div style="font-size:10.5px;color:var(--dim);font-weight:400;margin-top:2px">' + profileNote(r.id) + '</div></td>' +
          '<td>' + Math.round(p.pres || 0) + '</td>' +
          '<td>' + (p.pres ? Math.round(M.minuteShare(p) * 100) + '%' : '–') + '</td>' +
          '<td>' + (p.fm ? fmt(p.fm, 2) : '–') + '</td>' +
          '<td>' + fmt(M.projectedFm(p), 2) + '</td>' +
          '<td><b>' + fmt(M.expectedFm(p), 2) + '</b></td>' +
          '<td><b>' + fmt(ev(r.id), 2) + '</b></td>' +
          '<td>' + fmt(vorpOf(r.id), 2) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---------- "cosa succede davvero": undici, titolari, classifica ---------- */
  // giocatori per ruolo, ordinati per punti attesi
  function poolByRole(ids) {
    var out = {};
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      out[r] = (ids || []).filter(function (id) { return POOL[id] && POOL[id].r === r; })
        .map(function (id) { return { id: id, ev: ev(id) }; })
        .sort(function (a, b) { return b.ev - a.ev; });
    });
    return out;
  }
  function slotsNow() { return M.CFG.FORMATIONS[state.formation] || M.CFG.FORMATIONS['3-4-3']; }

  // "9 presenze su 11 (76% dei minuti), 4 gol e 1 assist"
  function factsOf(id) {
    var p = POOL[id]; if (!p) return '';
    var pres = Math.round(p.pres || 0);
    if (pres < 1) return 'non ha ancora giocato in campionato';
    var parts = [pres + (pres === 1 ? ' presenza' : ' presenze') + ' su ' + M.CFG.GW];
    var ms = M.minuteShare ? Math.round(M.minuteShare(p) * 100) : null;
    if (ms != null) parts.push(ms + '% dei minuti');
    var g = Math.round(p.gol || 0), a = Math.round(p.ass || 0);
    var b = [];
    if (g) b.push(g + (g === 1 ? ' gol' : ' gol'));
    if (a) b.push(a + (a === 1 ? ' assist' : ' assist'));
    var txt = parts.join(', ');
    return txt + (b.length ? ' con ' + b.join(' e ') : ', senza bonus');
  }

  // scambi di titolarità dentro l'undici: per ogni ruolo chi entra e chi esce
  function xiSwaps(res) { return xiSwapsFor(res.giveA, res.newA); }

  function xiSwapsFor(giveIds, newIds) { return swapsOf(R('A'), giveIds, null, newIds); }

  // chi entra e chi esce dall'undici di una squadra qualsiasi (base -> base - give + recv)
  function swapsOf(baseIds, giveIds, recvIds, newIds) {
    var slots = slotsNow();
    var newArr = newIds || (baseIds.filter(function (id) { return (giveIds || []).indexOf(id) < 0; }).concat(recvIds || []));
    var byA = poolByRole(baseIds), byA2 = poolByRole(newArr);
    var out = [];
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      var b = byA[r].slice(0, slots[r] || 0).map(function (x) { return x.id; });
      var a = byA2[r].slice(0, slots[r] || 0).map(function (x) { return x.id; });
      var outs = b.filter(function (id) { return a.indexOf(id) < 0; });
      var ins = a.filter(function (id) { return b.indexOf(id) < 0; });
      if (outs.length || ins.length) out.push({ r: r, 'in': ins[0] || null, out: outs[0] || null,
        gain: roleTop(newArr, r, slots) - roleTop(baseIds, r, slots) });
    });
    return out;
  }

  // "in parole povere": due frasi senza decimali
  function plainLead(res) {
    var sw = xiSwaps(res);
    var st = strengths(), pos = -1;
    st.forEach(function (x, i) { if (x.me) pos = i; });
    var frase = [];
    var main = null;
    sw.forEach(function (x) { if (x['in'] && x.out && (!main || x.gain > main.gain)) main = x; });
    if (main) {
      var pi = POOL[main['in']], po = POOL[main.out];
      var mi = Math.round((M.minuteShare ? M.minuteShare(pi) : 0) * 100);
      var mo = Math.round((M.minuteShare ? M.minuteShare(po) : 0) * 100);
      var s1 = 'In parole povere: ' + pi.n + ' prende il posto di ' + po.n + ' ' + REP[main.r] +
        ' — gioca il ' + mi + '% dei minuti contro il ' + mo + '%';
      var gi = Math.round(pi.gol || 0), go = Math.round(po.gol || 0);
      var ai = Math.round(pi.ass || 0), ao = Math.round(po.ass || 0);
      if (gi !== go || ai !== ao) s1 += ', e finora ha fatto ' + gi + ' gol e ' + ai + ' assist contro ' + go + ' gol e ' + ao + ' assist';
      frase.push(s1 + '.');
    } else if (sw.length && sw[0]['in'] && !sw[0].out) {
      frase.push('In parole povere: entra ' + POOL[sw[0]['in']].n + ' ' + REP[sw[0].r] + ', dove non avevi un titolare da schierare.');
    } else if (sw.length && sw[0].out && !sw[0]['in']) {
      frase.push('In parole povere: cedi ' + POOL[sw[0].out].n + ' e ' + REP[sw[0].r] + ' non lo sostituisce nessuno.');
    }
    if (res.dA > 0.03) {
      var pts = res.dA * state.gwLeft;
      var s2 = 'Tradotto in classifica: circa ' + fmt(pts, 0) + ' punti in più nelle ' + state.gwLeft + ' giornate';
      if (pos > 0) {
        var above = st[pos - 1];
        s2 += res.beforeA.total + res.dA >= above.tot
          ? ', abbastanza per metterti davanti a ' + above.name + ' già adesso'
          : '; ' + above.name + ' resterebbe comunque avanti di ' + fmt(above.tot - (res.beforeA.total + res.dA), 2) + ' pt/g';
      } else if (pos === 0 && st.length > 1) {
        s2 += ', e allarghi il margine su ' + st[1].name;
      }
      frase.push(s2 + '.');
    } else if (res.dA < -0.03) {
      frase.push('Tradotto in classifica: circa ' + fmt(-res.dA * state.gwLeft, 0) + ' punti in meno nelle ' + state.gwLeft + ' giornate.');
    }
    return frase.join(' ');
  }

  function concretePanel(res) {
    var slots = slotsNow();
    var idsA = R('A'), idsB = R('B');
    var byA = poolByRole(idsA), byA2 = poolByRole(res.newA);
    var byB = poolByRole(idsB), byB2 = poolByRole(res.newB);
    var xi = function (by, r) { return by[r].slice(0, slots[r] || 0); };
    var ids = function (arr) { return arr.map(function (x) { return x.id; }); };

    function col(by, r, isAfter, beforeIds) {
      return xi(by, r).map(function (x) {
        var isNew = isAfter && beforeIds.indexOf(x.id) < 0;
        return '<span class="xiname' + (isNew ? ' isnew' : '') + '">' + esc(POOL[x.id].n) + '<i>' + fmt(x.ev, 2) + '</i></span>';
      }).join('<span class="xsep">·</span>');
    }
    function xiRows(by, isAfter, other) {
      return ['P', 'D', 'C', 'A'].map(function (r) {
        return '<div class="xirow"><span class="badge ' + r + '">' + r + '</span>' +
          '<div class="xilist">' + col(by, r, isAfter, isAfter ? ids(xi(other, r)) : []) + '</div></div>';
      }).join('');
    }

    var lines = [];
    // chi entra al posto di chi, ruolo per ruolo
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      var bIds = ids(xi(byA, r)), aIds = ids(xi(byA2, r));
      var outs = bIds.filter(function (id) { return aIds.indexOf(id) < 0; });
      var ins = aIds.filter(function (id) { return bIds.indexOf(id) < 0; });
      if (!outs.length && !ins.length) return;
      var rg = roleTop(res.newA, r, slots) - roleTop(idsA, r, slots);
      var txt = '';
      if (outs.length && ins.length) {
        txt = '<b>' + esc(POOL[ins[0]].n) + ' al posto di ' + esc(POOL[outs[0]].n) + '</b> ' + REP[r] + ' (' + sgn(rg, 2) + ' pt/g nel reparto): ' +
          esc(POOL[ins[0]].n) + ' ' + factsOf(ins[0]) + '; ' + esc(POOL[outs[0]].n) + ' ' + factsOf(outs[0]) + '.';
      } else if (outs.length) {
        txt = '<b>Esce ' + esc(POOL[outs[0]].n) + '</b> ' + REP[r] + ' (' + factsOf(outs[0]) + '): il posto lo prende chi era già in rosa e il reparto scende di ' + fmt(-rg, 2) + ' pt/g.';
      } else {
        txt = '<b>Entra ' + esc(POOL[ins[0]].n) + '</b> ' + REP[r] + ' (' + factsOf(ins[0]) + ').';
      }
      lines.push(txt);
    });

    // se salta un titolare: chi entra dalla panchina, prima e dopo
    var panch = [];
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      var bIds = ids(xi(byA, r)), aIds = ids(xi(byA2, r));
      if (bIds.join() === aIds.join()) return;
      var subB = byA[r][slots[r] || 0], subA = byA2[r][slots[r] || 0];
      if (!subB && !subA) return;
      panch.push(REP[r] + ' ' + (subB ? esc(POOL[subB.id].n) + ' ' + fmt(subB.ev, 2) : 'nessuno') +
        ' → ' + (subA ? esc(POOL[subA.id].n) + ' ' + fmt(subA.ev, 2) : 'nessuno'));
    });
    if (panch.length) lines.push('<b>Se salta un titolare</b> (primo cambio dalla panchina): ' + panch.join(' · ') + '.');

    // classifica: quanto vale in punti e cosa cambia nei confronti
    var st = strengths(), pos = -1;
    st.forEach(function (x, i) { if (x.me) pos = i; });
    var pts = res.dA * state.gwLeft, after = res.beforeA.total + res.dA;
    var cls = [];
    cls.push('<b>In classifica</b>: ' + sgn(pts, 1) + ' punti nelle ' + state.gwLeft + ' giornate che restano');
    if (pos > 0) {
      var above = st[pos - 1], gap = above.tot - res.beforeA.total;
      if (res.dA > 0 && after >= above.tot) cls.push('e ti fa passare davanti a ' + esc(above.name) + ', che ora è a ' + fmt(gap, 2) + ' pt/g');
      else cls.push('ma ' + esc(above.name) + ' resta a ' + fmt(above.tot - after, 2) + ' pt/g davanti a te');
    } else if (pos === 0 && st.length > 1) {
      var below = st[1], marg = res.beforeA.total - below.tot;
      cls.push('e allarga il margine su ' + esc(below.name) + ' (' + fmt(marg + res.dA, 2) + ' pt/g)');
    }
    lines.push(cls.join(' ') + '.');

    // quello che succede a lui, in una riga
    var hisLine = '';
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      if (hisLine) return;
      var bIds = ids(xi(byB, r)), aIds = ids(xi(byB2, r));
      var outs = bIds.filter(function (id) { return aIds.indexOf(id) < 0; });
      var ins = aIds.filter(function (id) { return bIds.indexOf(id) < 0; });
      if (ins.length && outs.length) hisLine = '<b>A lui</b>: entra ' + esc(POOL[ins[0]].n) + ' al posto di ' + esc(POOL[outs[0]].n) + '.';
      else if (ins.length) hisLine = '<b>A lui</b>: entra ' + esc(POOL[ins[0]].n) + '.';
      else if (outs.length) hisLine = '<b>A lui</b>: esce ' + esc(POOL[outs[0]].n) + ' e non lo sostituisce nessuno.';
    });

    hisLine = (hisLine || '').replace(/\.\.$/, '.');
    return '<div class="panel concrete"><h2>Cosa succede davvero</h2>' +
      '<p class="hint" style="margin:6px 0 10px">Chi gioca al posto di chi, chi entra dalla panchina e cosa cambia in classifica. Sono le cose che decidi il sabato, non i centesimi di punto.</p>' +
      '<div class="xic">' +
        '<div class="xic-col"><div class="xic-h">Il tuo undici adesso</div>' + xiRows(byA, false, null) + '</div>' +
        '<div class="xic-col"><div class="xic-h">Con lo scambio</div>' + xiRows(byA2, true, byA) + '</div>' +
      '</div>' +
      '<ul class="plainlist">' + lines.map(function (t) { return '<li>' + t + '</li>'; }).join('') +
        (hisLine ? '<li>' + hisLine + '</li>' : '') + '</ul></div>';
  }

  function renderVerdict() {
    var box = $('#verdict');
    var gA = state.sel.A, gB = state.sel.B;

    if (!gA.length && !gB.length) {
      box.innerHTML = '<div class="head"><h3>Nessuno scambio selezionato</h3></div>' +
        '<div class="why">Clicca i giocatori che <b>dai via</b> nella tua rosa e quelli che <b>ricevi</b> nella rosa dell\'avversario. Il giudizio si aggiorna mentre scegli. Se non hai ancora caricato le rose, usa <b>Carica due rose di esempio</b>.</div>';
      return;
    }

    var res = currentResult();
    var dB = res.dB, dA = res.dA;
    var dTot = dA * state.gwLeft;

    var title, pill, cls, advice, why = [];

    var GOOD = 0.10, FLAT = 0.05;
    if (gA.length && !gB.length) {
      title = 'Stai cedendo senza ricevere nulla'; pill = 'da completare'; cls = 'bad';
    } else if (!gA.length && gB.length) {
      title = 'Stai ricevendo senza dare nulla'; pill = 'impossibile'; cls = 'bad';
    } else if (dA > GOOD && dB > GOOD) {
      title = 'Scambio win-win'; pill = 'conviene a entrambi'; cls = 'good'; advice = 'Proponilo così: guadagnate entrambi.';
    } else if (dA > GOOD && dB >= -FLAT) {
      title = 'Affare per te'; pill = 'a tuo favore'; cls = 'good'; advice = 'Proponilo così.';
    } else if (dA > GOOD) {
      title = 'Buono per te, ma l\'altro ci perde'; pill = 'difficile da chiudere'; cls = 'mid';
      advice = 'Aggiungi un altro giocatore all\'offerta, altrimenti non accetterà.';
    } else if (Math.abs(dA) <= FLAT && dB < -FLAT) {
      title = 'Così non sta in piedi'; pill = 'da rivedere'; cls = 'mid';
      advice = 'A te non cambia nulla e l\'avversario peggiora: cambia i giocatori coinvolti.';
    } else if (Math.abs(dA) <= FLAT) {
      title = 'Scambio sostanzialmente equo'; pill = 'pari valore'; cls = 'mid';
      advice = 'Ha senso solo se ti serve un rimpiazzo in un ruolo scoperto.';
    } else if (dA < -FLAT && dB > FLAT) {
      title = 'Questo scambio ti penalizza'; pill = 'a tuo sfavore'; cls = 'bad';
      advice = 'Lascia perdere, o chiedi qualcosa in più.';
    } else if (dA < -FLAT) {
      title = 'Ti penalizza senza aiutare l\'altro'; pill = 'inutile'; cls = 'bad';
      advice = 'Scambia altri giocatori: così perdono tutti e due.';
    } else {
      title = 'Scambio marginale'; pill = 'impatto minimo'; cls = 'mid';
      advice = 'Differenze minime: decidi in base ai ruoli che ti servono.';
    }

    // spiegazione per reparto
    var before = roleSums(R('A')), after = roleSums(res.newA);
    var up = [], down = [];
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      var d = after[r] - before[r];
      if (d > 0.04) up.push(fmt(d, 2) + ' ' + REP[r]);
      else if (d < -0.04) down.push(fmt(-d, 2) + ' ' + REP[r]);
    });
    if (up.length && down.length) why.push('Il tuo undici guadagna ' + up.join(' e ') + ' ma perde ' + down.join(' e ') + '.');
    else if (up.length) why.push('Il tuo undici guadagna ' + up.join(' e ') + '.');
    else if (down.length) why.push('Il tuo undici perde ' + down.join(' e ') + '.');
    if (!up.length && !down.length) why.push('Il tuo undici titolare non cambia: i giocatori che arrivano non migliorano chi gioca già.');

    // il consiglio guarda solo i punti: e' l'unica cosa che conta a stagione in corso
    if (dB < -0.05 && dA > 0.10) {
      advice = 'A lui i punti non tornano: aggiungi un giocatore a suo favore, altrimenti rifiuta.';
    } else if (dA > 0.10 && dB >= -0.05 && dB < 0.05) {
      advice = 'A lui non cambia quasi nulla: e\' il momento in cui puo' + "'" + ' dire sì.';
    }
    if (Math.abs(dA) > 0.02 && Math.abs(dA) < 0.11) {
      why.push('Attenzione: ' + fmt(Math.abs(dA), 2) + ' pt/g sono circa ' + fmt(Math.abs(dA) * state.gwLeft, 1) + ' punti in ' + state.gwLeft + ' giornate, dentro il margine di errore del modello: da sola non è una ragione per cambiare.');
    }
    var lead = plainLead(res);
    if (lead) why.unshift(lead);
    why.push('<b>' + (advice || 'Valuta tu.') + '</b>');

    // guadagno netto: se lo stesso lo trovi gratis, lo scambio non vale niente
    var netBox = '';
    if (POOL && state.useFree && (gA.length || gB.length)) {
      var nf = netOf(res);
      var netA = nf.netA;
      var positivo = nf.roles.filter(function (x) { return x.gain > 0.02; })
        .sort(function (a, b) { return b.gain - a.gain; })[0];
      var freeName = positivo && positivo.freePlayer ? (positivo.freePlayer.name || (POOL[positivo.freePlayer.id] || {}).n || '') : '';
      if (positivo && positivo.free >= positivo.gain - 0.01) {
        netBox = '<div class="creditbox net bad"><span class="cicon">!</span><div>' +
          '<b>Il mercato ti dà lo stesso, senza scambiare.</b> ' + esc(freeName) + ' è svincolato e, ' + REP[positivo.role] + ', ti alzerebbe l\'undici di <b>' + fmt(positivo.free, 2) + '</b> — quanto o più di questo scambio (' + fmt(positivo.gain, 2) + ').' +
          '<div style="margin-top:4px;color:var(--dim)">Guadagno netto: ' + sgn(netA, 2) + ' pt/g, cioè quanto ti resta che il mercato non ti dia già.</div></div></div>';
        // il consiglio generale non vale: qui conviene prima il mercato
        if (why.length >= 1) why[why.length - 1] = '<b>Trattieni l\'offerta.</b>';
        title = 'Il mercato batte questo scambio'; pill = 'non serve'; cls = 'bad';
        why.push('<b>Prima però il mercato:</b> ' + esc(freeName) + ' è svincolato e ti dà di più, senza cedere nessuno. Questo scambio ha senso solo se lui non è più disponibile o se lo prendi comunque tu.');
      } else if (netA > 0.02) {
        netBox = '<div class="creditbox net"><span class="cicon">★</span><div>' +
          '<b>Guadagno netto ' + sgn(netA, 2) + ' pt/g.</b> Lo scambio ti dà ' + fmt(dA, 2) + ' e non è roba che trovi gratis' +
          (positivo && positivo.free > 0.02 ? ': ' + REP[positivo.role] + ' il mercato ti offrirebbe +' + fmt(positivo.free, 2) + ' con ' + esc(freeName) + ', questo vale di più.' : '.') +
          '<div style="margin-top:4px;color:var(--dim)">Il netto è il vantaggio che non puoi ottenere senza cedere qualcuno: è quello che conta.</div></div></div>';
      } else if (Math.abs(netA) <= 0.02) {
        netBox = '<div class="creditbox net"><span class="cicon">≈</span><div><b>Guadagno netto nullo.</b> Quello che prendi lo trovi anche svincolato: lo scambio non migliora la squadra, serve solo a cambiare il profilo dei giocatori.</div></div>';
      }
    }

    // senza mercato libero l'alternativa e' un altro scambio: dico se in lega c'e' di meglio
    if (POOL && !state.useFree && (gA.length || gB.length)) {
      var dls = myRoleDeltas(gA, gB);
      var br = null;
      ['P', 'D', 'C', 'A'].forEach(function (r) { if (dls[r] > 0.02 && (!br || dls[r] > dls[br])) br = r; });
      if (br) {
        var alt = altForRole(br);
        // confronto omogeneo: guadagno del ruolo al netto di quello che lo scambio costa altrove
        var lossOther = 0;
        ['P', 'D', 'C', 'A'].forEach(function (k) { if (k !== br) lossOther += Math.min(0, dls[k]); });
        var myNr = dls[br] + lossOther;
        var gapAlt = alt ? alt.gain - myNr : 0;
        if (alt && gapAlt > 0.11) {
          why.splice(Math.max(0, why.length - 1), 0, 'In lega c\'è di meglio ' + REP[br] + ': con ' + esc(alt.opp) + ' si arriva a ' + sgn(alt.gain) + ' (qui ' + sgn(myNr) + ', contando quello che perdi negli altri reparti).');
        } else if (alt) {
          why.splice(Math.max(0, why.length - 1), 0, 'In lega non c\'è di meglio ' + REP[br] + ' adesso: il massimo è ' + sgn(alt.gain) + ' con ' + esc(alt.opp) + ', una differenza dentro il margine di errore del modello.');
        }
      }
    }

    // conguaglio in crediti: chi guadagna piu' punti mette la differenza in crediti
    var cr = creditFor(dA, dB, null, [gA, gB]);
    var creditBox = '';
    if (state.useCredits && cr && cr.credits > 0) {
      var oppName0 = teamB() ? teamB().name : 'l\'avversario';
      creditBox = '<div class="creditbox"><span class="cicon">⇄</span><div>' +
        (cr.payer === 'me'
          ? '<b>Per pareggiare dai ' + cr.credits + ' crediti</b> a ' + esc(oppName0) + ': guadagni ' + fmt(Math.abs(dA - dB), 2) + ' pt/g più di lui.'
          : '<b>Chiedi ' + cr.credits + ' crediti</b> a ' + esc(oppName0) + ': guadagna ' + fmt(Math.abs(dA - dB), 2) + ' pt/g più di te.') +
        ' <span class="crchip">' + cr.credits + ' cr</span>' +
        (cr.over ? ' <span style="color:var(--amber)">— più dei ' + cr.avail + ' crediti che ' + (cr.payer === 'me' ? 'hai' : 'ha') + ' ancora: va concordato o coperto diversamente</span>' : ' (' + (cr.payer === 'me' ? 'te ne restano ' : 'gliene restano ') + cr.avail + ')') +
        (cr.need && cr.need.need > 0.25
          ? '<div style="margin-top:4px">Leva a tuo favore: a lui manca proprio ' + (cr.need.short ? 'un ' + REP[cr.need.role] : REP[cr.need.role] + ' (il suo titolare più debole lì vale ' + fmt(cr.need.weakest, 2) + ', il tuo ' + fmt(cr.need.incoming, 2) + ')') + ', quindi ha meno alternative.</div>'
          : '') +
        '<div style="margin-top:4px;color:var(--dim)">Un punto a giornata vale circa ' + Math.round(cr.rate || creditRateNow()) + ' crediti per giocatori di questo livello. I crediti non cambiano il valore dei giocatori: pareggiano solo il conto.</div>' +
        '</div></div>';
    } else if (state.useCredits && cr && cr.credits === 0 && (gA.length || gB.length)) {
      creditBox = '<div class="creditbox off"><span class="cicon">⇄</span><div>Scambio già pari: nessun conguaglio in crediti serve.</div></div>';
    }

    var bar = function (d) {
      var w = clamp(Math.abs(d) / 1.5 * 100, 3, 100);
      return '<div class="bar"><i style="width:' + w + '%;background:' + (d >= 0 ? 'var(--green)' : 'var(--red)') + '"></i></div>';
    };

    box.innerHTML =
      '<div class="head"><h3>' + title + '</h3><span class="pill ' + cls + '">' + pill + '</span></div>' +
      '<div class="why">' + why.join(' ') + '</div>' +
      '<div class="metrics">' +
        '<div class="metric"><div class="k">Il tuo undici</div><div class="v ' + (dA >= 0 ? 'pos' : 'neg') + '">' + sgn(dA) + ' pt/g</div>' +
          '<div class="s">' + fmt(res.beforeA.total, 2) + ' → ' + fmt(res.afterA.total, 2) + ' · ' + sgn(dTot, 1) + ' punti in ' + state.gwLeft + ' giornate</div>' + bar(dA) + '</div>' +
        '<div class="metric"><div class="k">L\'undici avversario</div><div class="v ' + (dB >= 0 ? 'pos' : 'neg') + '">' + sgn(dB) + ' pt/g</div>' +
          '<div class="s">' + fmt(res.beforeB.total, 2) + ' → ' + fmt(res.afterB.total, 2) + ' · ' + sgn(dB * state.gwLeft, 1) + ' punti in ' + state.gwLeft + ' giornate</div>' + bar(dB) + '</div>' +
        '<div class="metric"><div class="k">Chi ci guadagna di più</div><div class="v ' + (dA >= dB ? 'pos' : 'neg') + '">' + (Math.abs(dA - dB) < 0.03 ? 'pari' : dA > dB ? 'tu' : "lui") + '</div>' +
          '<div class="s">' + (Math.abs(dA - dB) < 0.03 ? 'impatto praticamente identico' : 'differenza di ' + fmt(Math.abs(dA - dB), 2) + ' pt/g a tuo ' + (dA > dB ? 'favore' : 'sfavore') +
            (state.useCredits && cr && cr.credits > 0 ? ' · ' + cr.credits + ' cr di conguaglio' : '')) + '</div></div>' +
      '</div>' +
      netBox + creditBox +
      concretePanel(res) +
      (function () {
        var ex = M.explainTrade(res, {
          pool: POOL, A: R('A'), B: R('B'), formation: state.formation, teams: state.teams,
          gwLeft: state.gwLeft, horizon: state.horizon, ctx: (state.useCal ? CTX : null),
          calPct: function (team, role) { return calPct(team, role); }
        });
        function itNum(v) { return String(v).replace(/(\d)\.(\d)/g, '$1,$2'); }
        var swList = xiSwaps(res);
        var byAnow = poolByRole(R('A')), byA2now = poolByRole(res.newA);
        function concreteName(t) {
          var m = t.match(/^(Guadagni|Perdi) [\d.,]+ pt (in porta|in difesa|a centrocampo|in attacco)/);
          if (!m) return null;
          var role = m[2] === 'in porta' ? 'P' : m[2] === 'in difesa' ? 'D' : m[2] === 'a centrocampo' ? 'C' : 'A';
          var sw = null;
          swList.forEach(function (x) { if (x.r === role) sw = x; });
          return { role: role, sw: sw };
        }
        function block(title, arr, cls) {
          if (!arr.length) return '';
          return '<div class="pc ' + cls + '"><h4>' + title + '</h4><ul>' + arr.map(function (x) {
            var extra = '', desc = x.d;
            var cn = concreteName(x.t);
            if (cn && cn.sw) {
              if (cn.sw['in'] && cn.sw.out) extra = esc(POOL[cn.sw['in']].n) + ' al posto di ' + esc(POOL[cn.sw.out].n);
              else if (cn.sw.out) extra = 'esce ' + esc(POOL[cn.sw.out].n) + ' senza rimpiazzo';
              else if (cn.sw['in']) extra = 'entra ' + esc(POOL[cn.sw['in']].n);
              extra = extra ? ' — ' + extra : '';
              // dalla panchina: chi entra al posto di chi se salta un titolare
              var k = slotsNow()[cn.role] || 0;
              var sb = byAnow[cn.role][k], sa = byA2now[cn.role][k];
              if (sb && sa && sb.id !== sa.id) {
                desc = 'Fuori dall\'undici il primo cambio in quel reparto cambia: da ' + sb.ev.toFixed(2).replace('.', ',') + ' (' + (sb.state || '') + ')';
                desc = 'Il primo cambio dalla panchina passa da ' + POOL[sb.id].n + ' (' + fmt(sb.ev, 2) + ') a ' + POOL[sa.id].n + ' (' + fmt(sa.ev, 2) + ').';
              }
            }
            return '<li><b>' + itNum(esc(x.t)) + extra + '</b><span>' + itNum(esc(desc)) + '</span></li>';
          }).join('') + '</ul></div>';
        }
        (res.giveB || []).forEach(function (id) { var rl = riskLine(id); if (rl) ex.cons.push(rl); });
        if (!ex.pros.length && !ex.cons.length) return '';
        return '<div class="pcwrap">' + block('Perché conviene', ex.pros, 'pro') + block('Perché non conviene', ex.cons, 'con') + '</div>';
      })() +
      comparisonTable(res) +
      (res.warns.length ? '<div class="warns">' + res.warns.map(function (w) { return '<div class="warn">' + esc(w) + '</div>'; }).join('') + '</div>' : '');
  }

  /* ---------- trova scambi ---------- */
  function opponents() {
    var L = curLeague(), out = [];
    (L.teams || []).forEach(function (t, i) { if (i !== state.my && t.players.length) out.push(i); });
    return out;
  }
  function renderFind() {
    var out = $('#findOut');
    if (!R('A').length || !opponents().length) {
      out.innerHTML = '<div class="panel"><p class="hint" style="margin:0">Prima carica la tua rosa e quella di almeno un avversario (scheda <b>Lega</b>).</p></div>';
      return;
    }
    out.innerHTML = '<div class="panel"><p class="hint" style="margin:0">Ricerca in corso…</p></div>';
    setTimeout(function () {
      var t0 = performance.now();
      var targets = state.findAll ? opponents() : [state.opp];
      var found = [];
      targets.forEach(function (oi) {
        var t = curLeague().teams[oi];
        if (!t || !t.players.length || oi === state.my) return;
        var f = M.findTrades({
          pool: POOL, A: R('A'), B: t.players,
          formation: state.formation, teams: state.teams,
          maxSize: state.depth, limit: state.findAll ? 3 : 8, minGain: 0.03,
          tradeRule: state.tradeRule
        });
        f.forEach(function (x) { x._opp = oi; found.push(x); });
      });
      found.sort(function (a, b) { return Math.min(b.dA, b.dB) - Math.min(a.dA, a.dB); });
      if (found.length > 18) found = found.slice(0, 18);
      var ms = Math.round(performance.now() - t0);

      if (!found.length) {
        out.innerHTML = '<div class="panel"><h2>Nessuno scambio reciprocamente vantaggioso</h2><p class="hint" style="margin:6px 0 0">Con queste rose e queste impostazioni ogni combinazione ' +
          (state.depth === 2 ? '1vs1 e 2vs2' : '1vs1') + ' penalizza almeno una delle due squadre: le rose hanno punti di forza sovrapposti. Prova a cambiare modulo o numero di squadre, oppure analizza uno scambio "a tuo favore" nella prima scheda.</p></div>';
        return;
      }
      var head = '<div class="panel" style="margin-bottom:12px"><h2>' + found.length + ' proposte trovate' +
        (state.findAll ? ' su ' + targets.length + ' avversari' : '') + '</h2><p class="hint" style="margin:6px 0 0">' +
        'Ogni proposta migliora l\'undici titolare di <b>entrambe</b> le squadre' +
        (state.tradeRule === 'parity' ? ' e rispetta il <b>pareggio dei ruoli</b> (stesso numero di giocatori per ruolo da entrambe le parti)' : '') +
        '. Calcolate in ' + ms + ' ms.</p></div>';

      out.innerHTML = head + found.map(function (f, idx) {
        var ga = f.giveA.map(function (id) { return chip(id); }).join(' ');
        var gb = f.giveB.map(function (id) { return chip(id); }).join(' ');
        var oppName = curLeague().teams[f._opp] ? curLeague().teams[f._opp].name : '';
        var swMine = mainSwap(swapsOf(R('A'), f.giveA, f.giveB));
        var oppTeam = curLeague().teams[f._opp];
        var swHis = oppTeam ? mainSwap(swapsOf(oppTeam.players, f.giveB, f.giveA)) : null;
        return '<div class="prop"><div>' +
          '<div class="flow"><span class="opptag">' + esc(oppName) + '</span> <span style="color:var(--muted);font-size:12px">Tu dai</span> ' + ga +
          ' <span class="arrowr">→</span> <span style="color:var(--muted);font-size:12px">ricevi</span> ' + gb + '</div>' +
          '<div class="gain" style="margin-top:7px"><span>tuo undici <b class="pos">' + sgn(f.dA) + '</b> pt/g</span>' +
          '<span>suo undici <b class="pos">' + sgn(f.dB) + '</b> pt/g</span></div>' +
          ((swMine || swHis)
            ? '<div class="swapnote">' +
                (swMine ? '<span>a te: ' + esc(swapSentence(swMine, { facts: false })) + '</span>' : '') +
                (swHis ? '<span>a lui: ' + esc(swapSentence(swHis, { facts: false })) + '</span>' : '') +
              '</div>'
            : '') +
          '</div>' +
          '<button class="small" data-analyze="' + idx + '">Analizza</button></div>';
      }).join('');

      $$('[data-analyze]', out).forEach(function (b) {
        b.addEventListener('click', function () {
          var f = found[+b.getAttribute('data-analyze')];
          if (f._opp != null) { state.opp = f._opp; state.findAll = false; }
          state.sel.A = f.giveA.slice();
          state.sel.B = f.giveB.slice();
          switchTab('trade');
          renderAll();
        });
      });
    }, 30);
  }

  // bollino dello stato (FUORI / SQUAL. / IN DUBBIO) da mettere accanto a un nome, ovunque compaia
  function fuoriBadge(id) {
    var p = POOL[id];
    if (!p || !p.fuori) return '';
    var n = M.outNote(p) || {};
    var cls = n.tipo === 'dubbio' ? ' dub' : '';
    var txt = n.tipo === 'dubbio' ? 'IN DUBBIO' : n.tipo === 'squalificato' ? 'SQUAL.' : 'FUORI';
    return ' <span class="out-badge' + cls + ' small" title="' + esc(outTitle(id)) + '">' + txt + '</span>';
  }

  function chip(id) {
    var p = P(id);
    return '<span class="chip"><span class="badge ' + p.r + '">' + p.r + '</span><b>' + esc(p.n) + '</b>' + fuoriBadge(id) +
      '<span class="mt">' + esc(p.t) + '</span></span>';
  }

  /* ---------- scheda Report: la mia squadra, la classifica, le offerte ---------- */
  function copyText(txt) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { toast('Messaggio copiato negli appunti'); },
          function () { window.prompt('Copia il messaggio:', txt); });
        return;
      }
    } catch (e) { /* niente clipboard */ }
    window.prompt('Copia il messaggio:', txt);
  }

  function strengths() {
    var L = curLeague();
    return (L.teams || []).map(function (t, i) {
      var sc = M.teamScore(POOL, t.players, state.formation);
      return { i: i, name: t.name, me: i === state.my, tot: sc.total, complete: sc.complete,
               n: t.players.length };
    }).sort(function (a, b) { return b.tot - a.tot; });
  }

  // la squadra di Serie A che pesa di più nella rosa (per il pannello calendario)
  function serieATeamOf(ids) {
    var cnt = {};
    (ids || []).forEach(function (id) {
      var p = POOL[id]; if (!p || !p.t) return;
      cnt[p.t] = (cnt[p.t] || 0) + 1;
    });
    var best = null;
    Object.keys(cnt).forEach(function (t) { if (!best || cnt[t] > cnt[best]) best = t; });
    return best;
  }
  // per ruolo: chi gioca, qual e' il punto debole, chi in lega lo migliorerebbe
  function roleBoard() {
    var L = curLeague(), me = teamA();
    var slots = M.CFG.FORMATIONS[state.formation] || M.CFG.FORMATIONS['3-4-3'];
    var out = [];
    ['P', 'D', 'C', 'A'].forEach(function (r) {
      var mine = (me.players || []).filter(function (id) { return POOL[id].r === r; })
        .map(function (id) { return { id: id, pts: ev(id) }; })
        .sort(function (a, b) { return b.pts - a.pts; });
      var others = [];
      L.teams.forEach(function (t, i) {
        if (i === state.my) return;
        t.players.forEach(function (id) { if (POOL[id].r === r) others.push({ id: id, pts: ev(id), from: t.name }); });
      });
      others.sort(function (a, b) { return b.pts - a.pts; });
      var need = slots[r] || 0;
      var starters = mine.slice(0, need);
      var weakest = starters.length ? starters[starters.length - 1] : null;
      var best = others[0] || null;
      out.push({
        r: r, need: need, starters: starters, bench: mine.slice(need),
        weakest: weakest, best: best,
        delta: best && weakest ? best.pts - weakest.pts : 0
      });
    });
    return out;
  }

  /* ---------- formazione consigliata della giornata ---------- */
  function renderLineup() {
    var box = $('#lineupCard');
    if (!box) return;
    var ids = (R('A') || []).slice();
    if (!ids.length) { box.style.display = 'none'; return; }
    box.style.display = '';
    var info = (typeof window !== 'undefined' && window.FANTATRADE_AVAIL) || {};
    var lu = M.bestLineup(POOL, ids, state.formation);
    var gwTxt = info.giornata ? ' · giornata ' + info.giornata : '';
    var nomiRuolo = { P: 'portiere', D: 'difensori', C: 'centrocampisti', A: 'attaccanti' };

    function riga(x, idx) {
      var p = POOL[x.id], x2 = M.schierabilita(p, M.starterProfile(POOL, x.id));
      var st = M.starterProb(p);
      var n = M.outNote(p);
      var extra = [];
      if (st != null) extra.push(Math.round(st * 100) + '% titolare');
      if (n) extra.push(n.tipo === 'dubbio' ? 'in dubbio' : n.tipo === 'squalificato' ? 'squalificato' : 'fuori');
      if (p.diffidato) extra.push('diffidato');
      var sp = M.starterProfile(POOL, x.id);
      if (sp && sp.rival) extra.push('ballottaggio con ' + POOL[sp.rival.id].n);
      return '<li' + (n ? ' class="risky"' : '') + '>' +
        '<span class="lu-n">' + (idx != null ? idx + '.' : '') + '</span>' +
        '<span class="badge ' + p.r + '">' + p.r + '</span>' +
        '<span class="lu-name">' + esc(p.n) + fuoriBadge(x.id) + ' <span class="dim">' + esc(p.t) + '</span></span>' +
        '<span class="lu-tags">' + esc(extra.join(' · ')) + '</span>' +
        '<span class="lu-pts" title="punti attesi della giornata: titolarità × fantamedia attesa">' + fmt(x.pts, 2) + '</span>' +
        '<span class="lu-sch ' + (x2.score >= 75 ? 'pos' : x2.score >= 45 ? 'neu' : 'neg') + '" title="' + esc(schierTitle(x.id)) + '">' + x2.score + '</span>' +
        '</li>';
    }

    box.innerHTML = '<div class="panel lineup">' +
      '<div class="toolbar" style="margin:0 0 8px">' +
        '<h2 style="margin:0">Formazione consigliata: ' + esc(state.formation) + gwTxt + '</h2>' +
        '<span class="grow"></span>' +
        '<span class="dim" style="font-size:12px">' + fmt(lu.tot, 2) + ' pt attesi nella giornata</span>' +
      '</div>' +
      '<p class="hint" style="margin:0 0 8px">Chi schierare adesso, secondo i dati della giornata: <b>probabili formazioni</b> (colonna % titolare), indisponibili, ballottaggi e punti attesi. Non tiene conto delle tue preferenze: se un giocatore è dato al 55% e uno al 90%, mette il secondo.</p>' +
      (lu.missing.length
        ? '<p class="lu-warn">Ti mancano ' + lu.missing.map(function (m) {
            return m.n + ' ' + nomiRuolo[m.r] + (m.n > 1 ? '' : '');
          }).join(', ') + ' per riempire il ' + esc(state.formation) + ': l\'undici qui sotto è incompleto.</p>' : '') +
      '<ul class="lu-xi">' +
        ['P', 'D', 'C', 'A'].map(function (r) {
          var g = lu.xi.filter(function (x) { return x.r === r; });
          if (!g.length) return '';
          return '<li class="lu-group">' + nomiRuolo[r] + '</li>' + g.map(function (x, k) { return riga(x, k + 1); }).join('');
        }).join('') +
      '</ul>' +
      (lu.panchina.length
        ? '<details class="lu-bench"><summary>Panchina, in ordine di ingresso (' + lu.panchina.length + ')</summary><ul class="lu-xi">' +
            lu.panchina.map(function (x) { return riga(x, null); }).join('') + '</ul></details>'
        : '') +
      ((info.fuori || info.diffidati)
        ? '<p class="hint" style="margin:8px 0 0">Considerati ' + (info.fuori || 0) + ' indisponibili e ' + (info.diffidati || 0) + ' diffidati del sito, aggiornati al ' +
            (info.data ? info.data.split('-').reverse().join('/') : '—') + '. In <b>panchina</b> chi entra se qualcuno salta.</p>' : '') +
      '</div>';
  }

  function renderReport() {
    var box = $('#reportTop'); if (!box) return;
    var L = curLeague(), me = teamA();
    if (!L || !me) { box.innerHTML = ''; return; }
    var sc = M.teamScore(POOL, me.players, state.formation);
    var rank = strengths();
    var pos = rank.findIndex(function (x) { return x.me; }) + 1;
    var board = roleBoard();
    var weak = board.slice().sort(function (a, b) { return b.delta - a.delta; })[0];

    var head = '<div class="panel">' +
      '<div class="head" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<h2 style="margin:0">' + esc(me.name) + '</h2>' +
        '<span class="pill ' + (pos === 1 ? 'good' : pos <= Math.ceil(rank.length / 2) ? 'mid' : 'bad') + '">' + pos + '° di ' + rank.length + ' per punti attesi</span>' +
        '<span class="hint" style="margin:0">' + esc(L.name) + ' · modulo ' + state.formation + '</span>' +
        '<span class="grow"></span>' +
        '<button class="ghost small" id="btnCopyReport" title="Copia un riepilogo testuale della tua squadra e delle offerte">Copia riepilogo</button>' +
      '</div>' +
      '<div class="metrics" style="margin-top:12px">' +
        '<div class="metric"><div class="k">Il tuo undici</div><div class="v pos">' + fmt(sc.total, 2) + ' pt/g</div>' +
          '<div class="s">' + (sc.complete ? 'formazione completa' : 'incompleta: ' + Object.keys(sc.missing || {}).join(', ')) + '</div></div>' +
        '<div class="metric"><div class="k">Distacco dal 1°</div><div class="v ' + (pos === 1 ? 'pos' : 'neu') + '">' + (pos === 1 ? '—' : fmt(rank[0].tot - sc.total, 2)) + '</div>' +
          '<div class="s">' + (pos === 1 ? 'sei davanti a tutti' : 'punti a giornata da recuperare su ' + esc(rank[0].name)) + '</div></div>' +
        '<div class="metric"><div class="k">Rosa</div><div class="v neu">' + me.players.length + '</div>' +
          '<div class="s">' + me.players.length + ' giocatori in rosa</div></div>' +
        '<div class="metric"><div class="k">Punto debole</div><div class="v neg">' + (weak ? ROLE_NAME[weak.r] : '—') + '</div>' +
          '<div class="s">' + (weak && weak.weakest
            ? esc(POOL[weak.weakest.id].n) + ' ' + fmt(weak.weakest.pts, 2) + ' · in lega c\'è di meglio di ' + fmt(weak.delta, 2) + ' pt/g'
            : 'reparto scoperto') + '</div></div>' +
      '</div></div>';

    // reparto per reparto
    var rows = board.map(function (b) {
      var st = b.starters.map(function (x) {
        return '<span class="pm' + (b.weakest && x.id === b.weakest.id ? ' weak' : '') + '">' + esc(POOL[x.id].n) + ' <b>' + fmt(x.pts, 2) + '</b></span>';
      }).join('');
      var bench = b.bench.length ? '<span class="tm">' + b.bench.slice(0, 3).map(function (x) { return esc(POOL[x.id].n) + ' ' + fmt(x.pts, 2); }).join(' · ') + '</span>' : '<span class="tm">nessuna alternativa</span>';
      return '<tr><td><span class="badge ' + b.r + '">' + b.r + '</span></td>' +
        '<td class="nm">' + (st || '<span class="tm">reparto vuoto</span>') + '<div>' + bench + '</div></td>' +
        '<td>' + (b.weakest ? fmt(b.weakest.pts, 2) : '–') + '</td>' +
        '<td>' + (b.best ? esc(POOL[b.best.id].n) + ' <span class="tm">' + esc(b.best.from) + '</span>' : '–') + '</td>' +
        '<td class="' + (b.delta > 0.25 ? 'pos' : 'neu') + '">' + (b.best ? '+' + fmt(b.delta, 2) : '–') + '</td></tr>';
    }).join('');

    var detail = '<div class="panel" style="margin-top:14px"><h2>Reparto per reparto</h2>' +
      '<p class="hint" style="margin:6px 0 10px">In grassetto i punti attesi a giornata. Il nome evidenziato è il tuo titolare più debole in quel reparto; l\'ultima colonna è quanto guadagneresti mettendo il miglior giocatore della lega al suo posto.</p>' +
      '<div class="tblwrap" style="max-height:none"><table class="data"><thead><tr>' +
      '<th>R</th><th>Titolari</th><th>Il più debole</th><th>Meglio in lega</th><th>Margine</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';

    // chi rischia la panchina (nessun prezzo: solo probabilità di giocare e punti)
    var risky = riskyOf(me.players);
    var riskPanel = risky.length ? '<div class="panel" style="margin-top:14px"><h2>Chi rischia la panchina</h2>' +
      '<p class="hint" style="margin:6px 0 10px">Titolari non garantiti (probabilità di giocare sotto il 62%): nei nomi sono forti, ma se non scendono in campo ti portano 6 punti al massimo. Sono i primi da usare in uno scambio.</p>' +
      '<div class="mlist">' + risky.map(function (r) {
        return '<div class="mrow" style="border-bottom:0"><span class="badge ' + r.p.r + '">' + r.p.r + '</span>' +
          '<span class="nm">' + esc(r.p.n) + '</span><span class="tm">' + esc(r.p.t) + '</span>' +
          '<span class="tag warn">' + (r.p.pres ? Math.round(r.pp * 100) + '% di giocare' : '0 presenze') + '</span>' +
          '<span class="v">' + fmt(r.pts, 2) + '</span></div>';
      }).join('') + '</div></div>' : '';

    // calendario: le prossime partite dei miei titolari, una riga per giocatore
    var calPanel = '';
    if (state.useCal && CTX && me.players.length) {
      var slotsCal = M.CFG.FORMATIONS[state.formation] || M.CFG.FORMATIONS['3-4-3'];
      var startersCal = [];
      ['P', 'D', 'C', 'A'].forEach(function (r) {
        me.players.filter(function (id) { return POOL[id].r === r; })
          .map(function (id) { return { id: id, pts: ev(id) }; })
          .sort(function (a, b) { return b.pts - a.pts; })
          .slice(0, slotsCal[r] || 0)
          .forEach(function (x) { startersCal.push(x.id); });
      });
      var rowsCal = startersCal.map(function (id) {
        var p = POOL[id];
        var sch = M.scheduleEase(CTX, p.t, p.r, state.horizon);
        var next = sch.list[0];
        var pct = calPct(p.t, p.r);
        var bar = function (v) {
          var col = v >= 0.6 ? 'var(--green)' : v <= 0.4 ? 'var(--red)' : 'var(--amber)';
          return '<div class="bar" style="min-width:64px"><i style="width:' + Math.round(clamp(v * 100, 3, 100)) + '%;background:' + col + '"></i></div>';
        };
        return {
          id: id, p: p, ease: sch.ease, pct: pct, next: next,
          html: '<tr><td><span class="badge ' + p.r + '">' + p.r + '</span> <b>' + esc(p.n) + '</b></td>' +
            '<td style="color:var(--muted)">' + esc(p.t) + '</td>' +
            '<td style="color:var(--muted)">' + (next ? (next.home ? '' : '<span style="color:var(--dim)">@</span>') + esc(next.opponent) + ' <span style="color:var(--dim);font-size:11px">(' + next.round + 'ª)</span>' : '–') + '</td>' +
            '<td><b>' + Math.round(pct * 100) + '</b> ' + bar(pct) + '</td></tr>'
        };
      }).sort(function (a, b) { return a.pct - b.pct; });
      var mediaCal = rowsCal.length ? rowsCal.reduce(function (t, x) { return t + x.pct; }, 0) / rowsCal.length : 0.5;
      calPanel = '<div class="panel" style="margin-top:14px"><h2>Il tuo calendario</h2>' +
        '<p class="hint" style="margin:6px 0 10px">Le prossime ' + state.horizon + ' giornate dei tuoi undici titolari, dal più ostico al più favorevole. ' +
        'La facilità va da 0 a 100 <b>rispetto alle altre squadre di Serie A</b>: 50 = calendario nella media, 80 = tra i più morbidi, 20 = tra i più duri. ' +
        'Conta la forza reale dell\'avversario (gol fatti e subiti, corretti perché 11 giornate sono poche), il campo e il ruolo di chi gioca. ' +
        'La giornata di domenica pesa più di quella fra due mesi.</p>' +
        '<div class="tblwrap" style="max-height:none"><table class="data"><thead><tr>' +
        '<th>Giocatore</th><th>Squadra</th><th>Prossima</th><th>Facilità ' + state.horizon + ' g.</th></tr></thead><tbody>' +
        rowsCal.map(function (x) { return x.html; }).join('') + '</tbody></table></div>' +
        '<p class="hint" style="margin:10px 0 0">Il tuo undici ha un calendario al <b>' + Math.round(mediaCal * 100) + '/100</b>' +
        (mediaCal >= 0.6 ? ' — ciclo favorevole: è il momento di far giocare i tuoi attaccanti, non di venderli.' :
         mediaCal <= 0.4 ? ' — ciclo duro: non è il momento di comprare attaccanti di questa squadra, e uno scambio "a favore" va fatto adesso.' :
         ' — calendario nella media: la scelta dipende da altro.') + '</p></div>';
    }

    // migliori svincolati per ruolo: chi posso ancora prendere dal mercato
    var ownedInLega = {};
    L.teams.forEach(function (t) { t.players.forEach(function (id) { ownedInLega[id] = 1; }); });
    var slotsFree = M.CFG.FORMATIONS[state.formation] || M.CFG.FORMATIONS['3-4-3'];
    var weakestIn = function (team, r) {
      var arr = (team.players || []).filter(function (id) { return POOL[id].r === r; })
        .map(function (id) { return { id: id, ev: ev(id) }; })
        .sort(function (a, b) { return b.ev - a.ev; });
      var need = slotsFree[r] || 0;
      return arr.length >= need ? arr[need - 1].ev : 0;
    };
    var free = ['P', 'D', 'C', 'A'].map(function (r) {
      var arr = POOL.map(function (p2, i) { return i; })
        .filter(function (i) { return POOL[i].r === r && !ownedInLega[i] && (POOL[i].pres || 0) >= 3; })
        .map(function (i) { return { id: i, pts: ev(i) }; })
        .sort(function (a, b) { return b.pts - a.pts; })
        .slice(0, 3);
      var base = weakestIn(me, r);
      arr.forEach(function (x) { x.gain = x.pts - base; });
      return { r: r, list: arr };
    }).filter(function (x) { return x.list.length; });
    var bestFree = null;
    free.forEach(function (g) { g.list.forEach(function (x) { if (!bestFree || x.gain > bestFree.gain) { bestFree = { r: g.r, id: x.id, gain: x.gain, pts: x.pts }; } }); });
    var freeRows = [];
    free.forEach(function (g) {
      g.list.forEach(function (x, i) {
        freeRows.push('<tr><td class="nm">' + (i === 0 ? "<b style=\"color:var(--role-" + g.r.toLowerCase() + ")\">" + ROLE_NAME[g.r] + '</b>' : '') + '</td>' +
          '<td class="nm">' + (i === 0 ? '<b>' + esc(POOL[x.id].n) + '</b>' : esc(POOL[x.id].n)) + '</td>' +
          '<td>' + esc(POOL[x.id].t) + '</td>' +
          '<td><b>' + fmt(x.pts, 2) + '</b></td>' +
          '<td class="' + (x.gain > 0.02 ? 'pos' : '') + '">' + (x.gain > 0.02 ? '+' + fmt(x.gain, 2) : '—') + '</td></tr>');
      });
    });
    var freePanel = free.length ? '<div class="panel" style="margin-top:14px"><h2>Migliori svincolati per ruolo</h2>' +
      '<p class="hint" style="margin:6px 0 10px">Giocatori liberi in lega (nessuno li ha in rosa) con almeno 3 presenze. La colonna <b>guadagno</b> dice quanto alzerebbero il tuo undici <i>senza cedere nessuno</i>.' +
      (freeWindowOpen()
        ? ' Adesso puoi prenderli: è il metro con cui va confrontato qualsiasi scambio.'
        : ' <b>Occhio:</b> si possono tirare dentro solo all\'asta di riparazione di febbraio, quindi oggi non sono un\'alternativa a uno scambio — sono la lista su cui puntare in quella finestra.') + '</p>' +
      '<div class="tblwrap" style="max-height:none"><table class="data"><thead><tr>' +
      '<th>Ruolo</th><th>Giocatore</th><th>Squadra</th><th>Pt/g</th><th>Guadagno</th></tr></thead><tbody>' +
      freeRows.join('') + '</tbody></table></div>' +
      (bestFree && bestFree.gain > 0.05
        ? (freeWindowOpen()
            ? '<p class="hint" style="margin:10px 0 0;color:var(--amber)">Prima di cedere qualcuno: <b>' + esc(POOL[bestFree.id].n) + '</b> ti darebbe <b>+' + fmt(bestFree.gain, 2) + ' pt/g</b> senza cedere nessuno. Le offerte qui sotto valgono al netto di questo.</p>'
            : '<p class="hint" style="margin:10px 0 0;color:var(--amber)">Da segnare per l\'asta di riparazione: <b>' + esc(POOL[bestFree.id].n) + '</b> (se resta libero) ti darebbe <b>+' + fmt(bestFree.gain, 2) + ' pt/g</b>. Fino a febbraio l\'unico modo per migliorare in quel ruolo è scambiare: le offerte qui sotto sono valutate su questo.</p>')
        : '') + '</div>' : '';

    // classifica
    var rankRows = rank.map(function (x, i) {
      return '<tr' + (x.me ? ' class="me-row"' : '') + '><td>' + (i + 1) + '°</td>' +
        '<td class="nm">' + esc(x.name) + (x.me ? ' <span class="pill good">tu</span>' : '') + '</td>' +
        '<td><b>' + fmt(x.tot, 2) + '</b></td>' +
        '<td class="' + (x.tot >= sc.total ? 'neg' : 'pos') + '">' + (x.me ? '—' : sgn(x.tot - sc.total, 2)) + '</td>' +
        '<td>' + x.n + '</td></tr>';
    }).join('');
    var ranking = '<div class="panel" style="margin-top:14px"><h2>Classifica per punti attesi</h2>' +
      '<p class="hint" style="margin:6px 0 10px">Non è la classifica reale: è la forza degli undici con i dati di oggi (calendario incluso). Serve a capire chi devi battere e quanto margine hai.</p>' +
      '<div class="tblwrap" style="max-height:none"><table class="data"><thead><tr><th>Pos</th><th>Squadra</th><th>Undici</th><th>vs te</th><th>Rosa</th></tr></thead><tbody>' + rankRows + '</tbody></table></div></div>';

    // riepilogo testuale, da incollare in chat a chi non apre l'app
    var summary = function () {
      var tot = {}; ['P', 'D', 'C', 'A'].forEach(function (r) {
        tot[r] = me.players.filter(function (id) { return POOL[id].r === r; })
          .map(function (id) { return ev(id); }).sort(function (a, b) { return b - a; })
          .slice(0, (M.CFG.FORMATIONS[state.formation] || {})[r] || 0)
          .reduce(function (a, b) { return a + b; }, 0);
      });
      var lines = [];
      lines.push('FantaTrade · ' + L.name + ' · ' + me.name);
      lines.push('Undici titolare: ' + fmt(sc.total, 2) + ' pt/g (' + pos + '° su ' + rank.length + ' per punti attesi)');
      lines.push('Reparti: porta ' + fmt(tot.P, 2) + ' · difesa ' + fmt(tot.D, 2) + ' · centrocampo ' + fmt(tot.C, 2) + ' · attacco ' + fmt(tot.A, 2));
      if (weak && weak.weakest) lines.push('Punto debole: ' + ROLE_NAME[weak.r] + ' (' + POOL[weak.weakest.id].n + ' ' + fmt(weak.weakest.pts, 2) + '; in lega c\'è di meglio di ' + fmt(weak.delta, 2) + ' pt/g)');
      if (state.useCal && CTX && typeof mediaCal === 'number') lines.push('Calendario prossime ' + state.horizon + ' giornate: ' + Math.round(mediaCal * 100) + '/100');
      if (bestFree && bestFree.gain > 0.05) lines.push(freeWindowOpen()
        ? 'Svincolati: ' + POOL[bestFree.id].n + ' (' + fmt(bestFree.pts, 2) + ') \u00e8 libero, ti darebbe ' + sgn(bestFree.gain) + ' pt/g senza cedere nessuno'
        : 'Da prendere all\'asta di riparazione (febbraio): ' + POOL[bestFree.id].n + ' (' + fmt(bestFree.pts, 2) + '), ' + sgn(bestFree.gain) + ' pt/g');
      var tops = (offerCache && offerCache.list ? offerCache.list : []).slice(0, 3);
      if (tops.length) {
        lines.push('Scambi che ho in canna:');
        tops.forEach(function (o) {
          var f = o.f, cr = creditFor(f.dA, f.dB, o.oi, [f.giveA, f.giveB]);
          var deal = f.giveA.map(function (id) { return POOL[id].n; }).join(' + ') + ' per ' + f.giveB.map(function (id) { return POOL[id].n; }).join(' + ');
          if (cr && cr.credits > 0) deal += cr.payer === 'me' ? ' + ' + cr.credits + ' crediti da me' : ' + ' + cr.credits + ' crediti da lui';
          var netTxt = '';
          if (state.useFree && o.net && Math.abs(o.net.netA - f.dA) > 0.05) netTxt = ', netto ' + sgn(o.net.netA) + ' pt/g';
          lines.push('  · a ' + o.opp + ': ' + deal + ' (io ' + sgn(f.dA) + ' pt/g, lui ' + sgn(f.dB) + netTxt + ')');
        });
      }
      return lines.join('\n');
    };
    box.innerHTML = head + detail + calPanel + riskPanel + freePanel + ranking;
    var btnCopy = $('#btnCopyReport');
    if (btnCopy) btnCopy.addEventListener('click', function () { copyText(summary()); });
  }

  /* ---------- offerte pronte, calcolate a pezzi per non bloccare la pagina ---------- */
  var offerCache = { sig: null, list: [] };

  function rosterSignature() {
    var L = curLeague();
    if (!L) return '';
    return state.active + '|' + state.my + '|' + state.formation + '|' + state.depth + '|' + state.tradeRule + '|' +
      state.prospect + '|' + (state.useCredits ? 1 : 0) + (state.offersAsym ? 1 : 0) + (state.useFree ? 1 : 0) + '|' +
      L.teams.map(function (t) { return t.players.slice().sort().join(','); }).join(';');
  }

  function renderOffers(force) {
    var out = $('#offersOut'); if (!out) return;
    var sig = rosterSignature();
    if (!force && offerCache.sig === sig && offerCache.list.length) { paintOffers(offerCache.list); return; }
    var me = teamA();
    if (!me || !me.players.length || !opponents().length) {
      out.innerHTML = '<div class="panel"><p class="hint" style="margin:0">Carica la tua rosa e quelle degli avversari nella scheda <b>Lega</b>.</p></div>';
      return;
    }
    out.innerHTML = '<div class="panel"><p class="hint" style="margin:0">Sto calcolando le offerte…</p></div>';
    var list = [], queue = opponents().slice();
    (function step() {
      if (!queue.length) {
        // con le rose chiuse l'alternativa a uno scambio e' un ALTRO scambio: per ogni ruolo
        // misuro quanto la proposta si avvicina al massimo che le altre squadre ti darebbero
        list.forEach(function (o) {
          o.dl = myRoleDeltas(o.f.giveA, o.f.giveB);
          var sws = xiSwapsFor(o.f.giveA, R('A').filter(function (id) { return o.f.giveA.indexOf(id) < 0; }).concat(o.f.giveB));
          var msw = null;
          sws.forEach(function (x) { if (x['in'] && x.out && (!msw || x.gain > msw.gain)) msw = x; });
          o.swap = msw || sws[0] || null;
          // rischio: quanti dei giocatori che ricevo hanno il posto in bilico o non giocano
          // conta solo chi entra davvero nel mio undici: una riserva che resta in panchina non è un rischio
          o.risk = 0;
          sws.forEach(function (x) {
            if (!x['in'] || o.f.giveB.indexOf(x['in']) < 0) return;
            var sp = profileOf(x['in']);
            if (!sp) return;
            if (sp.battle) o.risk += 2;
            else if (sp.label === 'mai visto' || sp.label === 'riserva' || sp.label === 'primo cambio') o.risk += 1;
          });
          // guadagno di un ruolo al netto di quello che lo scambio costa negli altri reparti
          o.nr = {};
          ['P', 'D', 'C', 'A'].forEach(function (r) {
            var loss = 0;
            ['P', 'D', 'C', 'A'].forEach(function (k) { if (k !== r) loss += Math.min(0, o.dl[k]); });
            o.nr[r] = o.dl[r] + loss;
          });
        });
        var bestAlt = { P: -9, D: -9, C: -9, A: -9 };
        list.forEach(function (o) {
          ['P', 'D', 'C', 'A'].forEach(function (r) {
            if (o.dl[r] > 0.02 && o.nr[r] > bestAlt[r]) bestAlt[r] = o.nr[r];
          });
        });
        list.forEach(function (o) {
          var br = null;
          ['P', 'D', 'C', 'A'].forEach(function (r) {
            if (o.dl[r] > 0.02 && (!br || o.nr[r] > o.nr[br])) br = r;
          });
          o.best = br ? { role: br, gain: o.nr[br], max: bestAlt[br], gap: Math.max(0, bestAlt[br] - o.nr[br]) } : null;
        });
        // ordino per guadagno NETTO (al netto di quello che trovi gratis), non per punti lordi
        list.sort(function (a, b) {
          if (!!a.f.compensated !== !!b.f.compensated) return a.f.compensated ? 1 : -1;
          if (a.f.compensated) return (b.net.netA - a.net.netA) || (b.f.dA - a.f.dA);
          var d1 = Math.min(b.net.netA, b.net.netB) - Math.min(a.net.netA, a.net.netB);
          // a parità sostanziale (dentro il rumore) vince la proposta col rischio più basso
          if (Math.abs(d1) < 0.05) {
            var dr = (a.risk || 0) - (b.risk || 0);
            if (dr !== 0) return dr;
          }
          return d1 !== 0 ? d1 : (Math.min(b.f.dA, b.f.dB) - Math.min(a.f.dA, a.f.dB));
        });
        offerCache = { sig: sig, list: list };
        paintOffers(list);
        return;
      }
      var oi = queue.shift();
      var opp = curLeague().teams[oi];
      if (opp && opp.players.length) {
        M.findTrades({
          pool: POOL, A: me.players, B: opp.players, formation: state.formation, teams: state.teams,
          maxSize: state.depth, limit: 2, minGain: 0.03,
          minGainB: (state.useCredits && state.offersAsym) ? -0.45 : null,
          limitB: (state.useCredits && state.offersAsym) ? 2 : 0,
          tradeRule: state.tradeRule
        }).forEach(function (f) {
          if (f.compensated && f.dA < 0.10) return;      // asimmetrico ma ci guadagno troppo poco
          list.push({ opp: opp.name, oi: oi, f: f, net: netOf(f, oi) });
        });
      }
      setTimeout(step, 0);
    })();
  }

  function mainSwap(sws) {
    var best = null;
    (sws || []).forEach(function (x) { if (x['in'] && x.out && (!best || x.gain > best.gain)) best = x; });
    return best || (sws && sws[0]) || null;
  }

  // frase pronta: "entra X al posto di Y a centrocampo (X: 7 presenze, 77% dei minuti, 2 gol)"
  function swapSentence(sw, opts) {
    opts = opts || {};
    if (!sw) return '';
    if (sw['in'] && sw.out) {
      return 'entra ' + POOL[sw['in']].n + ' al posto di ' + POOL[sw.out].n + ' ' + REP[sw.r] +
        (opts.facts === false ? '' : ' (' + POOL[sw['in']].n + ': ' + factsOf(sw['in']) + ' — ' + POOL[sw.out].n + ': ' + factsOf(sw.out) + ')');
    }
    if (sw['in']) return 'entra ' + POOL[sw['in']].n + ' ' + REP[sw.r] + (opts.facts === false ? '' : ' (' + factsOf(sw['in']) + ')');
    if (sw.out) return 'esce ' + POOL[sw.out].n + ' senza rimpiazzo ' + REP[sw.r];
    return '';
  }

  // chi entra/esce nell'undici dell'avversario se accetta
  function swapsForOpp(o) {
    var t = curLeague().teams[o.oi];
    if (!t) return null;
    var sws = swapsOf(t.players, o.f.giveB, o.f.giveA);
    var best = null;
    sws.forEach(function (x) { if (x['in'] && x.out && (!best || x.gain > best.gain)) best = x; });
    return best || sws[0] || null;
  }

  function offerMessage(o) {
    var f = o.f;
    var mine = f.giveA.map(function (id) { return POOL[id].n; }).join(' + ');
    var his = f.giveB.map(function (id) { return POOL[id].n; }).join(' + ');
    var cr = creditFor(f.dA, f.dB, o.oi, [f.giveA, f.giveB]);
    var deal = mine + ' per ' + his;
    if (cr && cr.credits > 0) {
      deal = cr.payer === 'me'
        ? mine + ' per ' + his + ' + ' + cr.credits + ' crediti'
        : mine + ' + ' + cr.credits + ' crediti per ' + his;
    }
    var swHis = swapsForOpp(o), swMine = (o.swap || null);
    var lines = ['Ciao! Ti propongo: ' + deal.replace(/\.+$/, '') + '.', ''];
    if (swHis) lines.push('Per te: ' + swapSentence(swHis, { facts: true }) + '.');
    if (swMine) lines.push('Per me: ' + swapSentence(swMine, { facts: false }) + '.');
    var pts = state.gwLeft;
    lines.push('Nell\'undici titolare ci guadagniamo entrambi: ' + sgn(f.dB, 2) + ' pt/g per te, ' + sgn(f.dA, 2) + ' per me' +
      (pts ? ' (sono circa ' + fmt(f.dB * pts, 0) + ' e ' + fmt(f.dA * pts, 0) + ' punti nelle ' + pts + ' giornate che restano)' : '') + '.');
    if (cr && cr.credits > 0 && f.compensated) lines.push('Il conguaglio in crediti compensa la differenza: per te i crediti valgono più dei punti che perdi.');
    lines.push('');
    lines.push('Punti attesi a giornata: ' + f.giveA.map(function (id) { return POOL[id].n + ' ' + fmt(ev(id), 2); }).join(' + ') +
      ' contro ' + f.giveB.map(function (id) { return POOL[id].n + ' ' + fmt(ev(id), 2); }).join(' + ') + '.');
    lines.push('Fammi sapere!');
    return lines.join('\n');
  }

  function paintOffers(list) {
    var out = $('#offersOut'); if (!out) return;
    if (!list.length) {
      out.innerHTML = '<div class="panel"><h2>Nessuno scambio pari-ruolo vantaggioso per entrambi</h2>' +
        '<p class="hint" style="margin:6px 0 0">Con queste rose ogni combinazione penalizza almeno uno dei due. Prova "ruoli misti liberi" in Trova scambi, oppure allarga a 2 vs 2.</p></div>';
      return;
    }
    function chipHtml(id) {
      return '<span class="chip"><span class="badge ' + POOL[id].r + '">' + POOL[id].r + '</span><b>' + esc(POOL[id].n) + '</b>' + fuoriBadge(id) +
        '<span class="mt">' + esc(POOL[id].t) + ' · ' + fmt(ev(id), 2) + '</span></span>';
    }
    function propHtml(o, idx) {
      var f = o.f;
      return '<div class="prop' + (f.compensated ? ' comp' : '') + '">' +
        '<div>' +
          '<div class="flow"><span class="opptag">a ' + esc(o.opp) + '</span> ' +
            '<span style="color:var(--muted);font-size:12px">dai</span> ' + f.giveA.map(chipHtml).join('') +
            ' <span class="arrowr">→</span> <span style="color:var(--muted);font-size:12px">ricevi</span> ' + f.giveB.map(chipHtml).join('') + '</div>' +
          '<div class="gain" style="margin-top:7px"><span>tuo undici <b class="pos">' + sgn(f.dA) + '</b> pt/g</span>' +
            '<span>suo undici <b class="pos">' + sgn(f.dB) + '</b> pt/g</span>' +
            (o.swap && o.swap['in']
              ? '<span style="color:var(--dim);font-size:11.5px">entra <b style="color:var(--fg);font-weight:600">' + esc(POOL[o.swap['in']].n) + '</b>' + (o.swap.out ? ' per ' + esc(POOL[o.swap.out].n) : '') + '</span>'
              : (o.swap && o.swap.out ? '<span style="color:var(--dim);font-size:11.5px">esce ' + esc(POOL[o.swap.out].n) + '</span>' : '')) +
            (function () {
              var out2 = '';
              var ns = netOf(f, o.oi);
              if (!state.useFree && o.best && o.best.gain > 0.02) {
                if (o.best.gap <= 0.015)
                  out2 += '<span class="crchip" title="Nessuna altra squadra della lega ti darebbe di più in questo ruolo: è la migliore proposta disponibile">1° in lega per ' + o.best.role + '</span>';
                else
                  out2 += '<span class="crchip out" title="In questo ruolo un\'altra squadra ti darebbe fino a +' + fmt(o.best.max, 2) + ' pt/g">' + fmt(o.best.gap, 2) + ' dal meglio (' + o.best.role + ')</span>';
              }
              if (!ns.off && Math.abs(ns.netA - f.dA) > 0.05) {
                if (Math.abs(ns.netA) <= 0.02)
                  out2 += '<span class="crchip out" title="Il guadagno è pari a quello che trovi già svincolato in quel ruolo: non serve cedere nessuno">≈ svincolato</span>';
                else
                  out2 += '<span class="crchip' + (ns.netA < 0 ? ' out' : '') + '" title="Al netto di quello che otterresti gratis dal mercato degli svincolati">netto ' + sgn(ns.netA, 2) + '</span>';
              }
              if (o.swap && o.swap['in']) {
                var spIn = profileOf(o.swap['in']);
                if (spIn && spIn.battle)
                  out2 += '<span class="crchip out" title="Stesso club e stesso ruolo: ' + esc(POOL[spIn.rival.id].n) + ' gli contende il posto (' + fmt(spIn.rival.ev, 2) + ' pt/g, ' + Math.round((M.minuteShare(POOL[spIn.rival.id]) || 0) * 100) + '% dei minuti)">ballottaggio</span>';
                else if (spIn && spIn.label === 'titolare fisso')
                  out2 += '<span class="crchip" title="Nessuno nel suo club, nel suo ruolo, gli contende il posto">titolare sicuro</span>';
              }
              var nd = needFor(o.oi, f.giveA);
              if (nd.need > 0.5) {
                out2 += '<span class="crchip need" title="Il suo titolare più debole in ' + REP[nd.role] + ' vale ' + fmt(nd.weakest, 2) + ', quello che riceve ' + fmt(nd.incoming, 2) + '">gli serve ' + nd.role + '</span>';
              }
              var cr = creditFor(f.dA, f.dB, o.oi, [f.giveA, f.giveB]);
              if (!state.useCredits || !cr || !cr.credits) return out2;
              var cls = cr.over ? ' low' : '';
              return out2 + '<span class="crchip' + cls + '">' + (cr.payer === 'me' ? 'dai ' : 'chiedi ') + cr.credits + ' cr</span>';
            })() +
          '</div>' +
        '</div>' +
        '<div style="display:grid;gap:6px">' +
          '<button class="small primary" data-msg="' + idx + '" title="' + esc(offerMessage(o)) + '">Copia messaggio</button>' +
          '<button class="ghost small" data-open="' + idx + '">Analizza</button>' +
          '<button class="ghost small" data-apply="' + idx + '">Applica</button>' +
        '</div></div>';
    }

    var win = [], comp = [];
    list.forEach(function (o, i) { (o.f.compensated ? comp : win).push({ o: o, i: i }); });

    var headWin = '<div class="panel" style="margin-bottom:12px"><h2>Offerte pronte da mandare <span class="count">' + win.length + '</span></h2>' +
      '<p class="hint" style="margin:6px 0 0">Scambi pari ruolo in cui <b>guadagnano punti entrambi</b>: sono quelli che l\'altro accetta senza pensarci troppo.' +
      (state.useFree
        ? ' Sono ordinate per <b>guadagno netto</b>, cioè al netto di quello che trovi già svincolato in quel ruolo: <span class="crchip out">≈ svincolato</span> vuol dire "quello che prendi ce l\'hai già sul mercato", <span class="crchip out">netto −0,22</span> che una parte del guadagno la perdi in un altro reparto.'
        : ' Il chip dice quanto sei vicino al <b>massimo che le altre squadre ti darebbero</b> in quel ruolo: <span class="crchip">1° in lega per C</span> vuol dire che non c\'è di meglio, <span class="crchip out">0,08 dal meglio (C)</span> che un\'altra trattativa ti renderebbe di più.') +
      '</p></div>';
    var headComp = comp.length ? '<div class="panel" style="margin:16px 0 12px"><h2>Da pareggiare con i crediti <span class="count">' + comp.length + '</span></h2>' +
      '<p class="hint" style="margin:6px 0 0">Qui <b>tu ci guadagni punti e lui li perde</b>: lo scambio sta in piedi solo se ci metti i crediti indicati. Sono le operazioni che il motore non poteva proporti prima: il colpo grosso si paga.</p></div>' : '';

    out.innerHTML = (win.length ? headWin + win.map(function (x) { return propHtml(x.o, x.i); }).join('') : '') +
                    (comp.length ? headComp + comp.map(function (x) { return propHtml(x.o, x.i); }).join('') : '');
    if (!win.length && !comp.length) {
      out.innerHTML = '<div class="panel"><h2>Nessuno scambio proponibile</h2>' +
        '<p class="hint" style="margin:6px 0 0">Con queste rose ogni combinazione penalizza troppo uno dei due. Prova "ruoli misti liberi" in Trova scambi, allarga a 2 vs 2, o disattiva il conguaglio in crediti per vedere solo i win-win puri.</p></div>';
    }

    $$('[data-msg]', out).forEach(function (b) {
      b.addEventListener('click', function () { copyText(offerMessage(list[+b.getAttribute('data-msg')])); });
    });
    $$('[data-open]', out).forEach(function (b) {
      b.addEventListener('click', function () {
        var o = list[+b.getAttribute('data-open')];
        state.opp = o.oi;
        state.sel.A = o.f.giveA.slice(); state.sel.B = o.f.giveB.slice();
        switchTab('trade'); renderAll();
      });
    });
    $$('[data-apply]', out).forEach(function (b) {
      b.addEventListener('click', function () {
        var o = list[+b.getAttribute('data-apply')];
        applyTrade(o.f.giveA, o.f.giveB, o.oi, creditFor(o.f.dA, o.f.dB, o.oi, [o.f.giveA, o.f.giveB]));
      });
    });
  }

  // applica lo scambio davvero alle rose della lega (e ricalcola tutto)
  // fotografia delle rose: serve per l'annulla (ultimi 5 scambi)
  function pushHistory(label) {
    var snap = state.leagues.map(function (L) {
      return L.teams.map(function (t) { return { p: t.players.slice(), c: t.credits, pd: JSON.parse(JSON.stringify(t.paid || {})) }; });
    });
    state.history.push({ label: label, lg: state.active, snap: snap });
    if (state.history.length > 5) state.history.shift();
    paintUndo();
  }
  function undoLast() {
    var h = state.history.pop();
    if (!h) return;
    state.leagues.forEach(function (L, li) {
      var s2 = h.snap[li]; if (!s2) return;
      L.teams.forEach(function (t, ti) {
        if (!s2[ti]) return;
        t.players = s2[ti].p.slice();
        if (typeof s2[ti].c === 'number') t.credits = s2[ti].c; else delete t.credits;
        t.paid = JSON.parse(JSON.stringify(s2[ti].pd || {}));
      });
    });
    state.sel = { A: [], B: [] };
    offerCache = { sig: null, list: [] };
    renderAll(); paintUndo();
    toast('Scambio annullato: rose riportate a prima');
  }
  function paintUndo() {
    $$('#btnUndo, [data-undo]').forEach(function (b) {
      b.disabled = !state.history.length;
      b.title = state.history.length ? 'Riporta le rose a prima di: ' + state.history[state.history.length - 1].label : 'Nessuno scambio da annullare';
    });
  }

  function applyTrade(giveA, giveB, oppIndex, cr) {
    var mine = teamA(), opp = curLeague().teams[oppIndex];
    if (!opp) return;
    pushHistory(giveA.concat(giveB).map(function (id) { return POOL[id].n; }).join(' / '));
    // conguaglio: i crediti passano dalla squadra che guadagna piu' punti a quella che ne guadagna meno
    var moved = 0;
    if (cr && cr.credits > 0 && cr.payer) {
      var from = cr.payer === 'me' ? mine : opp;
      var to = cr.payer === 'me' ? opp : mine;
      var give = Math.min(cr.credits, availCredits(from));
      setCredits(from, availCredits(from) - give);
      setCredits(to, availCredits(to) + give);
      moved = give;
    }
    mine.players = mine.players.filter(function (id) { return giveA.indexOf(id) === -1; }).concat(giveB);
    opp.players = opp.players.filter(function (id) { return giveB.indexOf(id) === -1; }).concat(giveA);
    // i crediti spesi si spostano con i giocatori, ma non vengono mai mostrati né valutati
    giveA.forEach(function (id) {
      if (mine.paid && mine.paid[id] != null) { opp.paid = opp.paid || {}; opp.paid[id] = mine.paid[id]; delete mine.paid[id]; }
    });
    giveB.forEach(function (id) {
      if (opp.paid && opp.paid[id] != null) { mine.paid = mine.paid || {}; mine.paid[id] = opp.paid[id]; delete opp.paid[id]; }
    });
    state.sel = { A: [], B: [] };
    offerCache = { sig: null, list: [] };
    renderAll();
    toast('Scambio applicato' + (moved ? ' con ' + moved + ' crediti di conguaglio' : '') + ': rose aggiornate, report ricalcolato');
  }

  /* ---------- tabella giocatori ---------- */
  // i dati avanzati ci sono? (decide se mostrare le colonne xG/rischio)
  var advFlags = null;
  function advPresence() {
    if (advFlags) return advFlags;
    var a = false, i = false, o = false, l = false;
    for (var k = 0; k < POOL.length; k++) {
      if (!a && M.hasAdv(POOL[k])) a = true;
      if (!i && M.injuryProfile(POOL[k])) i = true;
      if (!o && POOL[k].fuori) o = true;
      if (!l && M.starterProb(POOL[k]) != null) l = true;
      if (a && i && o && l) break;
    }
    advFlags = { adv: a, inj: i, out: o, lu: l };
    return advFlags;
  }

  // motivo dell'indisponibilita' ripulito: tolgo la frase del rientro (che mostro a parte),
  // metto la maiuscola e chiudo con il punto. Restituisce {tipo, text, rientro}.
  function outBody(p) {
    var n = M.outNote(p);
    if (!n) return { tipo: '', text: '', rientro: '' };
    var perche = (n.perche || '').replace(/\s+/g, ' ').trim();
    var key = (n.rientro || '').replace(/[.…;\s]+$/, '').toLowerCase().slice(0, 24);
    if (perche && key) {
      var tenute = perche.split(/[.;]\s+|,\s+/).filter(function (c) {
        return c.toLowerCase().indexOf(key) < 0;
      });
      if (tenute.length) perche = tenute.join(', ');
    }
    perche = perche.replace(/[,;]\s*$/, '').trim();
    if (perche) perche = perche.charAt(0).toUpperCase() + perche.slice(1);
    if (perche && !/[.!?…]$/.test(perche)) perche += '.';
    return { tipo: n.tipo, text: perche, rientro: n.rientro, giorni: p.fuoriGiorni };
  }

  function schierTitle(i) {
    var p = POOL[i], x = M.schierabilita(p, M.starterProfile(POOL, i));
    var bits = ['schierabilità ' + x.score + '/100'];
    var st = M.starterProb(p);
    if (st != null) bits.push('probabile titolare ' + Math.round(st * 100) + '%');
    else bits.push('P(gioca) ' + Math.round(M.playProb(p) * 100) + '%');
    if (x.why.length) bits.push(x.why.map(function (w) {
      return /^ballottaggio con \d+$/.test(w) ? 'ballottaggio con ' + esc(POOL[+w.split(' ').pop()].n) : w;
    }).join(', '));
    return bits.join(' · ');
  }

  function consTitle(i) {
    var c = M.consensus(POOL[i]);
    if (!c) return 'Nessun dato dalle tre testate';
    var t = (window.FANTATRADE_CONSENSUS || {}).testate || ['FantaPazz', 'Gazzetta', 'Corriere'];
    var parts = c.values.map(function (v, k) { return (t[k] || '') + ' ' + fmt(v, 2); });
    var out = parts.join(' · ') + ' → mediana ' + fmt(c.med, 2);
    if (c.spread >= 0.7) out += ' · le testate non sono d\'accordo (±' + fmt(c.spread, 2) + ')';
    if (c.delta != null && Math.abs(c.delta) >= 0.5) {
      out += ' · attenzione: la nostra fonte dice ' + fmt(POOL[i].fm, 2) + ' (' + sgn(c.delta) + ')';
    }
    return out;
  }

  function quotaTitle(i) {
    var p = POOL[i];
    if (p.qa == null) return 'Quotazione non disponibile';
    var out = 'Quotazione attuale ' + Math.round(p.qa);
    if (p.prev != null) out += ' · settimana scorsa ' + Math.round(p.prev) + ' (' + (p.qa - p.prev > 0 ? '+' : '') + Math.round(p.qa - p.prev) + ')';
    if (p.qi != null) out += ' · a inizio stagione ' + Math.round(p.qi) + ' (' + (p.qa - p.qi > 0 ? '+' : '') + Math.round(p.qa - p.qi) + ')';
    return out;
  }

  function outTitle(i) {
    var p = POOL[i], fuori = outBody(p);
    if (!fuori.tipo) return '';
    var t = fuori.tipo === 'squalificato' ? 'Squalificato'
      : fuori.tipo === 'dubbio' ? 'In dubbio (indisponibile, tempi da definire)' : 'Fuori per infortunio';
    if (fuori.text) t += ': ' + fuori.text;
    if (fuori.rientro) t += ' — ' + fuori.rientro;
    if (fuori.giorni != null) t += ' (circa ' + Math.max(1, Math.round(fuori.giorni / 7)) + ' giornate)';
    return t;
  }

  // ---------------------------------------------------------------- chi e' fuori adesso
  function renderAvailCard() {
    var box = $('#availCard');
    if (!box) return;
    var info = (typeof window !== 'undefined' && window.FANTATRADE_AVAIL) || null;
    var fuori = [];
    for (var i = 0; i < POOL.length; i++) if (POOL[i].fuori) fuori.push(i);
    if (!info || (!fuori.length && !advPresence().lu)) { box.style.display = 'none'; return; }
    box.style.display = '';

    // i miei giocatori fuori vengono per primi: sono quelli che mi cambiano la domenica
    var mine = {}, inLega = {};
    var L = curLeague() || { teams: [] };
    (L.teams || []).forEach(function (t, ti) {
      (t.players || []).forEach(function (id) {
        inLega[id] = true;
        if (ti === state.my) mine[id] = true;
      });
    });
    fuori.sort(function (a, b) {
      var ma = mine[a] ? 0 : 1, mb = mine[b] ? 0 : 1;
      return ma - mb || POOL[a].t.localeCompare(POOL[b].t) || POOL[a].n.localeCompare(POOL[b].n);
    });

    var miei = fuori.filter(function (i) { return mine[i]; });
    var dataTxt = info.data ? ' del ' + info.data.split('-').reverse().join('/') : '';

    box.innerHTML =
      '<div class="toolbar" style="margin:0 0 8px">' +
        '<h2 style="margin:0">Indisponibili adesso</h2>' +
        '<span class="grow"></span>' +
        '<span class="dim" style="font-size:12px">' + fuori.length + ' giocatori · ' +
          esc(info.fonte || 'fantacalcio.it') + dataTxt + '</span>' +
      '</div>' +
      (miei.length
        ? '<p class="avail-mine"><b>' + miei.length + '</b> dei tuoi: ' + miei.map(function (i) {
            return esc(POOL[i].n) + ' <span class="dim">(' + esc(POOL[i].t) + ')</span>';
          }).join(' · ') + '</p>'
        : '<p class="hint" style="margin:0 0 6px">Nessuno dei tuoi giocatori risulta indisponibile.</p>') +
      '<details class="avail-list"><summary>Tutti gli indisponibili, squadra per squadra</summary>' +
        (function () {
          var byTeam = {};
          fuori.forEach(function (i) { (byTeam[POOL[i].t] = byTeam[POOL[i].t] || []).push(i); });
          return Object.keys(byTeam).sort().map(function (t) {
            return '<div class="avail-team"><h4>' + esc(t) + '</h4><ul>' +
              byTeam[t].map(function (i) {
                var p = POOL[i], fuori = outBody(p);
                return '<li class="' + (mine[i] ? 'mine' : inLega[i] ? 'inlega' : '') + '"><b>' + esc(p.n) + '</b>' +
                  ' <span class="avail-tag ' + (fuori.tipo === 'squalificato' ? 'sq' : fuori.tipo === 'dubbio' ? 'dub' : 'inf') + '">' +
                  (fuori.tipo === 'squalificato' ? 'squalifica' : fuori.tipo === 'dubbio' ? 'in dubbio' : 'infortunio') + '</span>' +
                  (fuori.rientro ? ' <span class="avail-when">' + esc(fuori.rientro) + '</span>' : '') +
                  (fuori.text ? '<div class="avail-why">' + esc(fuori.text) + '</div>'
                              : '<div class="avail-why dim">Il sito non dice altro.</div>') + '</li>';
              }).join('') + '</ul></div>';
          }).join('');
        })() +
      '</details>';
  }

  function renderPlayers() {
    var q = norm(state.dataQuery);
    var rows = POOL.map(function (p, i) {
      return {
        i: i, r: p.r, n: p.n, t: p.t,
        pres: p.pres || 0, minshare: M.minuteShare(p),
        fm: p.fm || 0, ev: M.matchdayPoints(p), vorp: vorpOf(i),
        xfm: M.expectedFm(p),
        proj: M.projectedFm(p),
        trend: (function (l) { return l === 'crescita' ? 2 : l === 'calo' ? 0 : 1; })(M.projection(p).label),
        cal: state.useCal && CTX ? Math.round(calPct(p.t, p.r) * 100) : null,
        form: p.fm ? p.fm - M.expectedFm(p) : -1,
        xg90: (function (a) { return a && a.xg90 != null ? a.xg90 : -1; })(M.advStats(p)),
        fin: (function (a) { return a && a.finishing != null ? a.finishing : null; })(M.advStats(p)),
        injr: (function (j) { return j ? j.perGw : -1; })(M.injuryProfile(p)),
        fuori: p.fuori ? 1 : 0,
        schier: (function (x) { return x.score; })(M.schierabilita(p, M.starterProfile(POOL, i))),
        schierWhy: (function (x) { return x.why; })(M.schierabilita(p, M.starterProfile(POOL, i))),
        cons: (function (c) { return c ? c.med : -1; })(M.consensus(p)),
        consVol: (function (c) { return c && c.volatile ? 1 : 0; })(M.consensus(p)),
        quotaD: (function (c) { return p.qa == null ? -99 : (p.prev != null ? p.qa - p.prev : 0); })(),
        titol: (function (l) { return l == null ? -1 : l; })(M.starterProb(p)),
        prof: (function (sp) {
          return sp.label === 'titolare fisso' ? 4 : sp.label === 'titolare in ballottaggio' ? 3 :
            sp.label === 'titolare a intermittenza' ? 2.5 : sp.label === 'mezza partita' ? 1.5 :
            sp.label === 'primo cambio' ? 1 : sp.label === 'riserva' ? 0.5 : 0;
        })(M.starterProfile(POOL, i)),
        _n: norm(p.n + ' ' + p.t)
      };
    }).filter(function (r) {
      return (state.dataRole === 'ALL' || r.r === state.dataRole) && (!q || r._n.indexOf(q) >= 0);
    });

    var key = state.dataSort.key, dir = state.dataSort.dir;
    rows.sort(function (x, y) {
      var a = x[key], b = y[key];
      if (typeof a === 'string') return a.localeCompare(b) * dir;
      return (a - b) * dir;
    });
    $('#dataCount').textContent = rows.length + ' giocatori';
    $('#dataTable').querySelector('tbody').innerHTML = rows.map(function (r) {
      var formCls = r.form > 0.25 ? 'pos' : r.form < -0.25 ? 'neg' : 'neu';
      return '<tr><td><span class="badge ' + r.r + '">' + r.r + '</span></td>' +
        '<td class="nm">' + esc(r.n) + '</td><td style="color:var(--muted)">' + esc(r.t) + '</td>' +
        '<td class="col-out">' + (r.fuori ? fuoriBadge(r.i).trim() : (POOL[r.i].diffidato ? '<span class="diff-badge" title="Diffidato: un\'ammonizione e salta la giornata successiva">⚠</span>' : '–')) + '</td>' +
        '<td class="col-lu ' + (r.titol < 0 ? '' : r.titol >= 0.7 ? 'pos' : r.titol >= 0.4 ? 'neu' : 'neg') + '"' +
          ' title="' + (r.titol < 0 ? 'Nessuna indicazione dalle probabili formazioni' :
            r.titol > 0 ? 'Secondo le probabili formazioni di giornata parte titolare nel ' + Math.round(r.titol * 100) + '% dei casi' :
            'Nelle probabili formazioni di giornata è in panchina') + '">' +
          (r.titol < 0 ? '–' : Math.round(r.titol * 100) + '%') + '</td>' +
        '<td>' + Math.round(r.pres) + '</td>' +
        '<td>' + (r.pres ? Math.round(r.minshare * 100) + '%' : '–') + '</td>' +
        '<td>' + (r.fm ? fmt(r.fm, 2) : '–') + '</td>' +
        '<td><b>' + fmt(r.ev, 2) + '</b></td>' +
        '<td>' + fmt(r.vorp, 2) + '</td>' +
        '<td class="' + formCls + '">' + (r.fm ? sgn(r.form) : '–') + '</td>' +
        '<td>' + fmt(r.proj, 2) + '</td>' +
        '<td>' + fmt(r.xfm, 2) + '</td>' +
        '<td class="' + (r.trend === 2 ? 'pos' : r.trend === 0 ? 'neg' : 'neu') + '">' + (r.trend === 2 ? '↗' : r.trend === 0 ? '↘' : '→') + '</td>' +
        '<td class="col-adv">' + (r.xg90 >= 0 ? fmt(r.xg90, 2) : '–') + '</td>' +
        '<td class="col-adv ' + (r.fin == null ? '' : r.fin > 0.8 ? 'neg' : r.fin < -0.8 ? 'pos' : '') + '">' + (r.fin == null ? '–' : sgn(r.fin)) + '</td>' +
        '<td class="col-inj ' + (r.injr < 0 ? '' : r.injr >= 0.15 ? 'neg' : '') + '">' + (r.injr < 0 ? '–' : Math.round(r.injr * 100) + '%') + '</td>' +
        '<td class="col-sch ' + (r.schier >= 75 ? 'pos' : r.schier >= 45 ? 'neu' : 'neg') + '" title="' + esc(schierTitle(r.i)) + '">' + r.schier + '</td>' +
        '<td class="col-cons ' + (r.cons < 0 ? '' : r.consVol ? 'cons-vol' : '') + '" title="' + esc(consTitle(r.i)) + '">' +
          (r.cons < 0 ? '–' : fmt(r.cons, 2)) + '</td>' +
        '<td class="col-quota ' + (r.quotaD > 0 ? 'pos' : r.quotaD < 0 ? 'neg' : 'neu') + '" title="' + esc(quotaTitle(r.i)) + '">' +
          (POOL[r.i].qa == null ? '–' : Math.round(POOL[r.i].qa) + (r.quotaD > 0 ? ' ↑' + fmt(r.quotaD, 0) : r.quotaD < 0 ? ' ' + fmt(r.quotaD, 0) + ' ↓' : '')) + '</td>' +
        '<td class="' + (r.prof >= 4 ? 'pos' : r.prof <= 1 ? 'neg' : 'neu') + '" style="font-size:11.5px;white-space:nowrap" title="' + esc(profileNote(r.i)) + '">' +
          (r.prof >= 4 ? 'titolare' : r.prof >= 3 ? 'ballottaggio' : r.prof >= 2.5 ? 'a intermittenza' : r.prof >= 1.5 ? 'mezza partita' : r.prof >= 1 ? 'primo cambio' : r.prof >= 0.5 ? 'riserva' : 'mai visto') + '</td>' +
        '<td>' + (r.cal == null ? '–' : r.cal) + '</td></tr>';
    }).join('');
  }

  /* ---------- render globale ---------- */
  // ---------------------------------------------------------------- confronto diretto
  function findPlayer(q) {
    var s = norm(q);
    if (!s) return -1;
    var exact = -1, byName = -1, part = -1;
    for (var i = 0; i < POOL.length; i++) {
      var n = norm(POOL[i].n), full = norm(POOL[i].n + ' ' + POOL[i].t);
      if (full === s) return i;
      if (n === s && byName < 0) byName = i;
      if (part < 0 && (n.indexOf(s) === 0 || full.indexOf(s) >= 0)) part = i;
    }
    return byName >= 0 ? byName : (exact >= 0 ? exact : part);
  }

  function cmpNice(p) { return p.n + ' (' + p.t + ')'; }

  function renderCompare() {
    var out = $('#cmpOut');
    if (!out) return;
    var i = findPlayer(state.cmpA), j = findPlayer(state.cmpB);
    $('#cmpClear').style.display = (state.cmpA || state.cmpB) ? '' : 'none';
    if (i < 0 || j < 0 || i === j) {
      out.innerHTML = '<p class="hint" style="margin:0">Scrivi due nomi e vedi chi conviene, riga per riga: ' +
        'punti attesi, titolarità, tiri, assist, fragilità, calendario.</p>';
      return;
    }
    var A = POOL[i], B = POOL[j];
    var aa = M.advStats(A) || {}, ab = M.advStats(B) || {};
    var sa = M.starterProfile(POOL, i) || {}, sb = M.starterProfile(POOL, j) || {};
    var injA = M.injuryProfile(A), injB = M.injuryProfile(B);
    var pa = M.projectedFm(A), pb = M.projectedFm(B);
    var msA = M.minuteShare(A), msB = M.minuteShare(B);
    var calA = state.useCal && CTX ? calPct(A.t, A.r) : null;
    var calB = state.useCal && CTX ? calPct(B.t, B.r) : null;

    function numFmt(v) { return v == null || !isFinite(v) ? '–' : fmt(v, 2); }
    function intFmt(v) { return v == null || !isFinite(v) ? '–' : String(Math.round(v)); }
    function pctFmt(v) { return v == null || !isFinite(v) ? '–' : Math.round(v * 100) + '%'; }
    function signedFmt(v) {
      return v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + fmt(v, 2);
    }

    var rows = [];
    function row(label, va, vb, dir, f) {      // dir: 1 = più alto è meglio, -1 = più basso, 0 = neutro
      var better = 0;
      if (dir && typeof va === 'number' && typeof vb === 'number' && va !== vb && isFinite(va) && isFinite(vb)) {
        better = (dir > 0 ? va > vb : va < vb) ? 1 : 2;
      }
      rows.push({ label: label, a: f ? f(va) : (va == null ? '–' : String(va)),
        b: f ? f(vb) : (vb == null ? '–' : String(vb)), better: better });
    }
    row('Ruolo', A.r, B.r, 0);
    row('Presenze', A.pres || 0, B.pres || 0, 1, intFmt);
    row('Minuti giocati', msA, msB, 1, pctFmt);
    row('Fantamedia', A.fm || null, B.fm || null, 1, numFmt);
    row('Punti attesi a giornata', pa, pb, 1, numFmt);
    row('Profilo', sa.label || '–', sb.label || '–', 0);
    if (sa.rival || sb.rival) {
      row('Ballottaggio con', sa.rival ? POOL[sa.rival.id].n : '–', sb.rival ? POOL[sb.rival.id].n : '–', 0);
    }
    if (aa.xg90 != null || ab.xg90 != null) {
      row('xG/90 (gol attesi)', aa.xg90, ab.xg90, 1, numFmt);
      row('Gol − xG', aa.finishing, ab.finishing, 0, signedFmt);
    }
    if (aa.xa90 != null || ab.xa90 != null) {
      row('xA/90 (assist attesi)', aa.xa90, ab.xa90, 1, numFmt);
      row('Assist', A.ass, B.ass, 1, intFmt);
    }
    if (A.fuori || B.fuori) {
      var stTxt = function (p) {
        var n = M.outNote(p);
        if (!n) return 'disponibile';
        return n.tipo === 'squalificato' ? 'squalificato' : n.tipo === 'dubbio' ? 'in dubbio' : 'fuori';
      };
      row('Stato di oggi', stTxt(A), stTxt(B), 0);
    }
    if (M.starterProb(A) != null || M.starterProb(B) != null) {
      row('Probabile titolare', M.starterProb(A), M.starterProb(B), 1, pctFmt);
    }
    row('Giornate saltate', sa.missed || 0, sb.missed || 0, -1, intFmt);
    if (calA != null || calB != null) row('Calendario (più alto = più facile)', calA, calB, 1, pctFmt);

    var cls = function (b) { return b === 1 ? 'win' : b === 2 ? 'lose' : ''; };
    out.innerHTML = '<table class="cmp-tbl"><thead><tr><th></th>' +
      '<th>' + esc(A.n) + '<span class="sub2">' + esc(A.t) + '</span></th>' +
      '<th>' + esc(B.n) + '<span class="sub2">' + esc(B.t) + '</span></th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td class="lab">' + esc(r.label) + '</td>' +
          '<td class="' + cls(r.better === 1 ? 1 : 0) + '">' + esc(String(r.a)) + '</td>' +
          '<td class="' + cls(r.better === 2 ? 1 : 0) + '">' + esc(String(r.b)) + '</td></tr>';
      }).join('') + '</tbody></table>' + '<p class="cmp-verdict">' + verdict(i, j, pa, pb) + '</p>';
  }

  function verdict(i, j, pa, pb) {
    var A = POOL[i], B = POOL[j];
    var d = pa - pb, win = d >= 0 ? A : B, lose = d >= 0 ? B : A, wIdx = d >= 0 ? i : j;
    var sp = M.starterProfile(POOL, wIdx) || {};
    var parts = [];
    // se uno dei due oggi è indisponibile è la prima cosa da dire: conta più di ogni numero
    [i, j].forEach(function (k) {
      var p = POOL[k], fuori = M.outNote(p);
      if (!fuori) return;
      var rientro = fuori.rientro ? ' (' + fuori.rientro.charAt(0).toLowerCase() + fuori.rientro.slice(1) + ')' : '';
      parts.push('<b>' + esc(p.n) + (fuori.tipo === 'squalificato' ? ' è squalificato</b>'
        : fuori.tipo === 'dubbio' ? ' è in dubbio</b>' : ' è fuori per infortunio</b>') +
        rientro + ': adesso la sua probabilità di giocare è al ' + Math.round(M.playProb(p) * 100) +
        '%, quindi i punti attesi valgono meno di quelli che ha fatto.');
    });
    if (Math.abs(d) < 0.15) {
      parts.push('<b>Praticamente pari</b>: ' + esc(A.n) + ' e ' + esc(B.n) + ' stanno entro ' + fmt(0.15, 2) +
        ' pt/g (' + fmt(pa) + ' contro ' + fmt(pb) + '). Decide il ruolo, il cartellino o cosa ti serve in rosa, non il numero.');
    } else {
      parts.push('<b>Meglio ' + esc(win.n) + '</b>: ' + (d >= 0 ? '+' : '−') + fmt(Math.abs(d)) + ' pt/g attesi (' +
        fmt(Math.max(pa, pb)) + ' contro ' + fmt(Math.min(pa, pb)) + ').');
      if (sp.rival) {
        parts.push('Attenzione: è in ballottaggio con ' + esc(POOL[sp.rival.id].n) +
          ', se perde il posto il suo valore scende verso ' + fmt(M.projectedFm(POOL[sp.rival.id])) + '.');
      } else if (sp.label) {
        parts.push('Profilo: ' + esc(sp.label) + '.');
      }
    }
    var aw = M.advStats(win) || {}, al = M.advStats(lose) || {};
    if (aw.xg90 != null && al.xg90 != null && Math.abs(aw.xg90 - al.xg90) >= 0.15) {
      parts.push('Tira di più: xG/90 ' + fmt(aw.xg90) + ' contro ' + fmt(al.xg90) + '.');
    }
    if (aw.xa90 != null && al.xa90 != null && Math.abs(aw.xa90 - al.xa90) >= 0.12) {
      if (aw.xa90 > al.xa90) {
        parts.push('Serve anche più assist attesi: xA/90 ' + fmt(aw.xa90) + ' contro ' + fmt(al.xa90) + '.');
      } else {
        parts.push('Però ' + esc(lose.n) + ' crea più assist attesi: xA/90 ' + fmt(al.xa90) + ' contro ' + fmt(aw.xa90) + '.');
      }
    }
    var cp = M.starterProfile(POOL, d >= 0 ? j : i) || {};
    if (cp.missed >= 3 && (sp.missed || 0) < cp.missed) {
      parts.push(esc(lose.n) + ' ha già saltato ' + cp.missed + ' giornate.');
    }
    return parts.join(' ');
  }

  // ---------------------------------------------------------------- cosa è cambiato
  function renderChanges() {
    var box = $('#changesCard');
    if (!box) return;
    var c = window.FANTATRADE_CHANGES;
    if (!c || (!(c.up || []).length && !(c.down || []).length && !(c.moved || []).length &&
      !(c.added || []).length && !(c.gone || []).length)) {
      box.innerHTML = '';
      return;
    }
    function list(arr, render) {
      if (!arr || !arr.length) return '<li class="dim">niente da segnalare</li>';
      return arr.map(render).join('');
    }
    function delta(x) {
      var s = (x.d > 0 ? '+' : '−') + fmt(Math.abs(x.d), 2);
      return '<li><b class="' + (x.d > 0 ? 'pos' : 'neg') + '">' + s + '</b> ' + esc(x.n) +
        ' <span class="dim">' + esc(x.t) + ' · ' + fmt(x.old, 2) + ' → ' + fmt(x.new, 2) + '</span></li>';
    }
    var gw = c.gw && c.prevGw && c.gw !== c.prevGw ? ' · giornata ' + c.prevGw + ' → ' + c.gw : '';
    box.innerHTML = '<div class="panel changes">' +
      '<div class="toolbar" style="margin:0 0 10px"><h2 style="margin:0">Cosa è cambiato</h2><span class="grow"></span>' +
      '<span class="hint" style="margin:0">dati del ' + esc((c.date || '').split('-').reverse().join('/')) +
      ' · ' + (c.updated || 0) + ' giocatori riconfrontati' + gw + '</span></div>' +
      '<div class="changes-grid">' +
      '<div><h4>In salita <span class="dim">(' + (c.nUp || 0) + ')</span></h4><ul>' + list(c.up, delta) + '</ul></div>' +
      '<div><h4>In discesa <span class="dim">(' + (c.nDown || 0) + ')</span></h4><ul>' + list(c.down, delta) + '</ul></div>' +
      '<div><h4>Cambi di squadra</h4><ul>' + list(c.moved, function (x) {
        return '<li>' + esc(x.n) + ' <span class="dim">' + esc(x.from) + ' → ' + esc(x.to) + '</span></li>';
      }) + '</ul>' +
      ((c.added || []).length ? '<h4 style="margin-top:10px">Entrati nel listone</h4><ul>' + list(c.added, function (x) {
        return '<li>' + esc(x.n) + ' <span class="dim">' + esc(x.t) + '</span></li>';
      }) + '</ul>' : '') +
      ((c.gone || []).length ? '<h4 style="margin-top:10px">Usciti dal listone</h4><ul>' + list(c.gone, function (x) {
        return '<li>' + esc(x.n) + ' <span class="dim">' + esc(x.t) + '</span></li>';
      }) + '</ul>' : '') +
      '</div></div>';
  }

  function renderAll() {
    (function () {
      var f = advPresence();
      document.body.classList.toggle('has-adv', f.adv);
      document.body.classList.toggle('has-inj', f.inj);
      document.body.classList.toggle('has-out', f.out);
      document.body.classList.toggle('has-lu', f.lu);
      var cons = 0;
      for (var j = 0; j < POOL.length; j++) { if (POOL[j].fmCons != null) { cons = 1; break; } }
      document.body.classList.toggle('has-cons', !!cons);
    })();
    M.setProspect(state.prospect);
    rateCache = null;
    freeCache = null;
    applyEase();
    applyAvail();
    saveState();
    renderRoster('A'); renderRoster('B');
    renderSummary(); renderVerdict();
    renderAvailCard();
    if ($('#tab-players').classList.contains('active')) { renderPlayers(); renderCompare(); }
    renderChanges();
    if ($('#tab-league').classList.contains('active')) renderLeague();
    renderLineup();
    if ($('#tab-report').classList.contains('active')) { renderReport(); renderOffers(false); }
    syncHeader();
  }

  function switchTab(name) {
    $$('nav.tabs button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === name); });
    $$('.tab').forEach(function (s) { s.classList.toggle('active', s.id === 'tab-' + name); });
    if (name === 'players') renderPlayers();
    if (name === 'league') renderLeague();
    if (name === 'report') { renderReport(); renderOffers(false); }
    if (name === 'find') { /* si attende il click */ }
  }

  // intestazioni: nome della mia squadra, avversario, lega
  function syncHeader() {
    var L = curLeague(); if (!L) return;
    var sel = $('#selOpp');
    if (sel) {
      sel.innerHTML = L.teams.map(function (t, i) {
        return i === state.my ? '' : '<option value="' + i + '"' + (i === state.opp ? ' selected' : '') + '>' + esc(t.name) + '</option>';
      }).join('');
    }
    var lg = $('#selLeague');
    if (lg) lg.innerHTML = state.leagues.map(function (l, i) {
      return '<option value="' + i + '"' + (i === state.active ? ' selected' : '') + '>' + esc(l.name) + '</option>';
    }).join('');
  }


  /* ---------- scheda Lega: piu' leghe, tutte le rose ---------- */
  function squashName(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function spentOfLocal(t) {
    var sp = 0;
    Object.keys((t && t.paid) || {}).forEach(function (k) { sp += t.paid[k]; });
    return sp;
  }

  // export rose di Fantacalcio.it: righe "Squadra,id_giocatore,crediti"
  function parseRosterCsv(text, filename) {
    var teams = {}, order = [], unknown = 0, paidTotal = 0, modelTotal = 0;
    text.split(/\r?\n/).forEach(function (line) {
      var c = line.split(',');
      if (c.length < 2) return;
      var team = (c[0] || '').trim();
      var id = parseInt(c[1], 10);
      if (!team || team === '$' || isNaN(id)) return;
      var idx = bySid[id];
      if (idx == null) { unknown++; return; }
      var price = parseInt(c[2], 10) || 0;
      if (!teams[team]) { teams[team] = { name: team, players: [], sids: [], paid: {}, paidSid: {} }; order.push(team); }
      if (teams[team].players.indexOf(idx) < 0) { teams[team].players.push(idx); teams[team].sids.push(id); }
      if (price) {
        teams[team].paid[idx] = price;
        teams[team].paidSid[String(id)] = price;
        paidTotal += price;
        modelTotal += Math.max(1, (POOL[idx].qa || 1) * 1.5);
      }
    });
    if (!order.length) return null;
    var k = modelTotal ? Math.max(1, Math.min(12, paidTotal / modelTotal)) : 1;
    var raw = filename.replace(/\.csv$/i, '').split(/_rosters|_fantaasta|_asta/)[0].replace(/[-_]+/g, ' ').replace(/['"]/g, '').trim();
    // budget d'asta stimato: spesa mediana per squadra arrotondata a 250 (minimo 500),
    // la stessa regola di import_fantacalcio.py. Si corregge a mano nella scheda Lega.
    var spends = order.map(function (n) { return spentOfLocal(teams[n]); }).sort(function (a, b) { return a - b; });
    var med = spends.length ? spends[Math.floor(spends.length / 2)] : 0;
    var budget = Math.max(500, Math.ceil(med / 250) * 250);
    return {
      name: raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Lega importata',
      k: Math.round(k * 100) / 100, budget: budget, unknown: unknown,
      teams: order.map(function (t) { return teams[t]; })
    };
  }

  function roleCount(ids, r) {
    var n = 0;
    ids.forEach(function (id) { if (POOL[id] && POOL[id].r === r) n++; });
    return n;
  }

  // chip dei crediti di una squadra + campo per dichiararli a mano. Dopo uno scambio i
  // crediti viaggiano con i giocatori, quindi "budget meno la spesa" non è più il residuo
  // vero: se il campo è compilato vince quello, altrimenti si calcola.
  function credChip(t, i) {
    var declared = typeof t.credits === 'number';
    var over = overBudget(t) && !declared;
    var why = declared
      ? 'crediti dichiarati a mano: ' + t.credits + ' cr (svuota il campo per tornare al calcolo)'
      : 'calcolato: budget ' + leagueBudget() + ' meno i ' + spentOf(t) + ' spesi' +
        (over ? '. Ha speso più del budget: probabilmente ha incassato crediti in uno scambio — leggi il residuo vero su Fantacalcio e scrivilo qui' : '');
    return '<span class="rc money' + (over ? ' short' : '') + '" title="' + esc('crediti disponibili per i conguagli · ' + why) + '">' +
             availCredits(t) + ' cr' + (over ? ' ⚠' : '') +
           '</span>' +
           '<input class="teamname" style="width:58px" type="number" min="0" step="5" data-credits="' + i + '"' +
             ' value="' + (declared ? t.credits : '') + '"' +
             ' placeholder="' + availCredits(t) + '"' +
             ' title="Crediti che restano davvero a ' + esc(t.name) + ': scrivili come li leggi su Fantacalcio.it. Vuoto = budget meno la spesa.">';
  }

  function renderLeague() {
    var box = $('#leagueOut'); if (!box) return;
    var L = curLeague();
    if (!L) { box.innerHTML = '<div class="panel"><p class="hint">Nessuna lega: crea la prima con <b>Incolla tutte le rose</b>.</p></div>'; return; }
    var slots = M.CFG.FORMATIONS[state.formation] || M.CFG.FORMATIONS['3-4-3'];

    var head = '<div class="panel" style="margin-bottom:12px">' +
      '<div class="toolbar" style="margin:0">' +
        '<span style="font-size:12px;color:var(--muted)">Nome lega</span>' +
        '<input class="teamname" id="lgName" value="' + esc(L.name) + '" style="max-width:230px">' +
        '<button class="ghost small" data-lg="new">+ Nuova lega</button>' +
        '<button class="ghost small" data-lg="del">Elimina lega</button>' +
        '<span class="grow"></span>' +
        '<button class="small primary" data-lg="import">Incolla tutte le rose</button>' +
      '</div>' +
      '<div class="toolbar" style="margin:8px 0 0">' +
        '<button class="ghost small" data-lg="csv">Importa rose CSV di Fantacalcio.it</button>' +
        '<input type="file" id="fileLeague" accept=".csv,text/csv" multiple style="display:none">' +
        '<span class="hint" style="margin:0;display:inline-flex;align-items:center;gap:6px">Crediti d\'asta per squadra' +
          ' <input class="teamname" style="width:82px" type="number" min="0" step="50" data-budget="1" value="' + leagueBudget() + '"></span>' +
        '<span class="hint" style="margin:0">Dopo gli scambi i crediti viaggiano con i giocatori: scrivi a fianco di ogni squadra i crediti che restano davvero (vuoto = budget meno la spesa).</span>' +
      '</div>' +
      '<p class="hint" style="margin:9px 0 0">Formato testo: una riga per squadra, <code>Nome: giocatore, giocatore, …</code>. Oppure importa l\'export CSV della lega (contiene gli id ufficiali: abbinamento esatto).</p>' +
    '</div>';

    var cards = L.teams.map(function (t, i) {
      var counts = ['P', 'D', 'C', 'A'].map(function (r) {
        var n = roleCount(t.players, r);
        var need = slots[r] || 0;
        return '<span class="rc' + (n < need ? ' short' : '') + '" title="' + ROLE_NAME[r] + ': ' + n + ' in rosa, ' + need + ' in campo">' +
          r + ' ' + n + '/' + need + '</span>';
      }).join('');
      return '<div class="lgteam' + (i === state.my ? ' me' : '') + '">' +
        '<div class="lgh">' +
          '<input class="teamname" data-tname="' + i + '" value="' + esc(t.name) + '">' +
          (i === state.my ? '<span class="pill good">la tua</span>' : '') +
          '<span class="cnt">' + t.players.length + '</span>' +
        '</div>' +
        '<div class="rolebar">' + counts +
          credChip(t, i) +
          '</div>' +
        '<div class="lga">' +
          (i === state.my ? '' : '<button class="small" data-act="opp" data-i="' + i + '">Analizza scambi</button>') +
          (i === state.my ? '' : '<button class="ghost small" data-act="me" data-i="' + i + '">È la mia squadra</button>') +
          '<button class="ghost small" data-act="paste" data-i="' + i + '">Incolla rosa</button>' +
          '<button class="ghost small" data-act="clear" data-i="' + i + '">Svuota</button>' +
        '</div>' +
      '</div>';
    }).join('');

    // diagnosi della mia squadra: dove sono corto, chi me lo risolve
    var mine = teamA(), gaps = [], targets = [];
    if (mine) {
      ['P', 'D', 'C', 'A'].forEach(function (r) {
        var n = roleCount(mine.players, r);
        if (n < (slots[r] || 0)) gaps.push(r);
      });
      // quanto vale il titolare che andrebbe a sostituire (l'ultimo del reparto nel mio undici)
      var slots2 = M.CFG.FORMATIONS[state.formation] || M.CFG.FORMATIONS['3-4-3'];
      var cutoff = {};
      ['P', 'D', 'C', 'A'].forEach(function (r) {
        var arr = mine.players.filter(function (id) { return POOL[id].r === r; }).map(ev).sort(function (a, b) { return b - a; });
        var need = slots2[r] || 0;
        cutoff[r] = arr.length >= need && need > 0 ? arr[need - 1] : 0;
      });
      var others = [];
      L.teams.forEach(function (t, i) {
        if (i === state.my) return;
        t.players.forEach(function (id) {
          var p = POOL[id];
          if (gaps.length && gaps.indexOf(p.r) < 0) return;
          others.push({ id: id, gain: ev(id) - (cutoff[p.r] || 0), vorp: vorpOf(id), from: t.name });
        });
      });
      others.sort(function (a, b) { return b.gain - a.gain || b.vorp - a.vorp; });
      targets = others.filter(function (o) { return o.gain > 0; }).slice(0, 6);
      if (!targets.length) targets = others.slice(0, 6);
    }

    var diag = '';
    if (mine) {
      diag = '<div class="panel" style="margin-top:14px"><h2>Diagnosi della tua squadra</h2>' +
        (gaps.length
          ? '<p class="hint" style="margin:6px 0 10px">Sei sotto il numero di titolari nel modulo ' + state.formation + ' in: <b>' +
            gaps.map(function (r) { return ROLE_NAME[r].toLowerCase(); }).join(', ') + '</b>. Cerca scambi che ti portino quei ruoli.</p>'
          : '<p class="hint" style="margin:6px 0 10px">Hai la copertura minima in tutti i ruoli del modulo ' + state.formation + '. Qui sotto i giocatori delle altre squadre che ti darebbero più punti rispetto al tuo rincalzo.</p>') +
        '<div class="mlist">' + targets.map(function (o) {
          var p = POOL[o.id], pr = M.projection(p);
          return '<div class="mrow"><span class="badge ' + p.r + '">' + p.r + '</span>' +
            '<span class="nm">' + esc(p.n) + '</span><span class="tm">' + esc(p.t) + ' · ' + esc(o.from) + '</span>' +
            '<span class="v" title="quanti punti in più a giornata rispetto al tuo ultimo titolare in ' + ROLE_NAME[p.r].toLowerCase() + '">+' + fmt(o.gain, 2) + '</span>' +
            '<span class="tr ' + pr.label + '">' + (pr.label === 'crescita' ? '↗' : pr.label === 'calo' ? '↘' : '→') + '</span></div>';
        }).join('') + '</div></div>';
    }

    box.innerHTML = head + '<div class="lgwrap">' + cards + '</div>' + diag;
  }

  // incolla tutte le rose: "Squadra: a, b, c" oppure due colonne (squadra \t giocatore)
  function parseLeague(text) {
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var teams = [], missing = [];
    function team(name) {
      var q = norm(name);
      for (var i = 0; i < teams.length; i++) if (norm(teams[i].name) === q) return teams[i];
      var t = { name: name.trim().slice(0, 40), players: [] };
      teams.push(t); return t;
    }
    var cur = null;
    function add(t, raw) {
      var m = matchName(raw);
      if (!m) { if (raw.trim()) missing.push(raw.trim()); return; }
      if (t.players.indexOf(m._i) === -1) t.players.push(m._i);
    }
    lines.forEach(function (line) {
      if (line.indexOf('\t') >= 0) {                       // due colonne
        var cells = line.split('\t').map(function (c) { return c.trim(); }).filter(Boolean);
        if (cells.length >= 2) { cur = team(cells[0]); add(cur, cells[1]); return; }
      }
      var m = /^([^,;]{2,34}?)\s*[:\-–]\s*(.*)$/.exec(line);
      if (m && (m[2].trim() === '' || /[,;]/.test(m[2]) || !matchName(m[2]))) {
        cur = team(m[1]);
        if (m[2].trim()) m[2].split(/[,;]+/).forEach(function (x) { add(cur, x); });
        return;
      }
      if (!cur) cur = team('Squadra ' + (teams.length + 1));
      line.split(/[,;]+/).forEach(function (x) { add(cur, x); });
    });
    return { teams: teams.filter(function (t) { return t.players.length; }), missing: missing };
  }

  function openLeagueModal() {
    $('#modalPreview').innerHTML = '';
    $('#modalLeague').classList.add('open');
    $('#leagueText').focus();
  }
  function updateLeaguePreview() {
    var r = parseLeague($('#leagueText').value);
    $('#lgPreview').innerHTML = r.teams.length + ' squadre · ' +
      r.teams.reduce(function (a, t) { return a + t.players.length; }, 0) + ' giocatori riconosciuti' +
      (r.missing.length ? ' · <span class="ko">non trovati: ' + esc(r.missing.slice(0, 8).join(', ')) + (r.missing.length > 8 ? '…' : '') + '</span>' : '');
  }

  /* ---------- incolla rosa ---------- */
  var pasteSide = 'A';
  function matchName(raw) {
    var q = norm(raw);
    if (!q) return null;
    var best = null, bestScore = 0;
    for (var i = 0; i < POOL.length; i++) {
      var p = POOL[i];
      var np = norm(p.n), nt = norm(p.t);
      var score = 0;
      if (np === q) score = 100;
      else if (np.indexOf(q) === 0) score = 85;
      else if (q.indexOf(np) === 0) score = 80;
      else if (np.split(' ').indexOf(q) >= 0) score = 75;
      else if (q.split(' ').every(function (w) { return np.indexOf(w) >= 0; })) score = 55;
      else if (nt.indexOf(q) >= 0) score = 0;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return bestScore >= 55 ? best : null;
  }
  /* ---------- probabili formazioni incollate a mano ---------- */
  // Formato atteso, uno per riga:  "Roma (3-4-2-1): Svilar; Mancini, N'Dicka, Hermoso; ..."
  // Vanno bene anche "Roma: Svilar; ..." e le percentuali di titolarità ("Svilar 65%").
  function serieANames() { return Object.keys(M.teamRates(CTX) || {}); }

  function teamInLine(line) {
    var n = norm(line), best = null;
    serieANames().forEach(function (t) {
      var nt = norm(t);
      if (!nt) return;
      var i = n.indexOf(nt);
      if (i >= 0 && (!best || i < best.idx)) best = { team: t, idx: i };
    });
    return best ? best.team : null;
  }

  function matchInTeam(raw, team) {
    var q = norm(raw);
    if (!q) return null;
    var best = null, bestScore = 0;
    for (var i = 0; i < POOL.length; i++) {
      var p = POOL[i];
      if (team && p.t !== team) continue;
      var np = norm(p.n);
      var score = np === q ? 100
        : np.indexOf(q) === 0 ? 85
        : q.indexOf(np) === 0 ? 80
        : np.split(' ').indexOf(q) >= 0 ? 75
        : q.split(' ').every(function (w) { return w.length > 2 && np.indexOf(w) >= 0; }) ? 55 : 0;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return bestScore >= 55 ? best : null;
  }

  function parseProbabili(text) {
    var out = { entries: [], teams: [], unmatched: [] };
    (text || '').split(/\n+/).forEach(function (line) {
      if (!line.trim()) return;
      var team = teamInLine(line);
      if (!team) return;
      if (out.teams.indexOf(team) === -1) out.teams.push(team);
      // tolgo il prefisso "Squadra (3-4-3):"
      var rest = line;
      var cut = rest.indexOf(':');
      if (cut >= 0) rest = rest.slice(cut + 1);
      else rest = rest.replace(new RegExp(team, 'i'), '');
      rest.split(/[;,]|\.\s/).forEach(function (seg) {
        var pct = null;
        var mPct = seg.match(/(\d{1,3})\s*%/);
        if (mPct) pct = +mPct[1];
        var name = seg.replace(/\(.*?\)/g, ' ').replace(/\d{1,3}\s*%/g, ' ').replace(/[0-9]/g, ' ').trim();
        if (norm(name).length < 3) return;
        var p = matchInTeam(name, team) || matchName(name);
        if (!p) { out.unmatched.push(name); return; }
        var status = pct != null && pct < 55 ? 'dubbio' : 'certo';
        if (!out.entries.some(function (e) { return e.id === p._i; })) out.entries.push({ id: p._i, status: status, pct: pct, team: team });
      });
    });
    return out;
  }

  // applica: i titolari indicati diventano "certo", chi di quella squadra gioca di solito
  // ma non è in lista passa a "dubbio"
  function applyProbabili(res) {
    var nCerti = 0, nDubbio = 0;
    res.entries.forEach(function (e) {
      state.avail[e.id] = e.status;
      if (e.status === 'certo') nCerti++; else nDubbio++;
    });
    var listed = {};
    res.entries.forEach(function (e) { listed[e.id] = 1; });
    var inRosa = {};
    curLeague().teams.forEach(function (t) { t.players.forEach(function (id) { inRosa[id] = 1; }); });
    POOL.forEach(function (p, i) {
      if (listed[i] || !inRosa[i]) return;
      if (res.teams.indexOf(p.t) === -1) return;
      if ((p.pres || 0) >= 3) { state.avail[i] = 'dubbio'; nDubbio++; }
    });
    state.sel = { A: state.sel.A, B: state.sel.B };
    renderAll();
    toast(nCerti + ' titolari confermati, ' + nDubbio + ' messi in dubbio');
  }

  function parsePaste(text) {
    var items = text.split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var matched = [], missing = [];
    items.forEach(function (raw) {
      var m = matchName(raw);
      if (m && matched.indexOf(m._i) === -1) matched.push(m._i); else if (!m) missing.push(raw);
    });
    return { matched: matched, missing: missing };
  }
  var pasteTeam = 0;
  var modalMode = 'roster';
  function openProbabili() {
    modalMode = 'pf';
    $('#modalTitle').textContent = 'Probabili formazioni';
    $('#modalHint').innerHTML = 'Una squadra per riga: <code>Roma (3-4-2-1): Svilar; Mancini, N\'Dicka, Hermoso; …</code>. ' +
      'Va bene anche <code>Roma: Svilar; …</code> e le percentuali (<code>Svilar 65%</code>): sotto il 55% lo considero in dubbio. ' +
      'I titolari indicati diventano <b>disponibili</b>, chi di quella squadra gioca di solito ma non è in lista passa a <b>in dubbio</b>.';
    $('#modalOk').textContent = 'Applica';
    $('#modalResetAvail').style.display = '';
    $('#modalPreview').innerHTML = '';
    $('#modalText').value = '';
    $('#modalText').placeholder = 'Roma (3-4-2-1): Svilar; Mancini, N\'Dicka, Hermoso; Wesley, Kone, Pisilli, Angelino; Dybala, Soulé; Dovbyk\nMilan (4-3-3): Maignan; Tomori, Gabbia, Pavlovic; …';
    $('#modal').classList.add('open');
    $('#modalText').focus();
  }
  function openModal(side) {
    modalMode = 'roster';
    $('#modalHint').textContent = 'Un giocatore per riga (o separati da virgola). Vanno bene anche "Cognome N." e i nomi completi.';
    $('#modalOk').textContent = 'Carica rosa';
    $('#modalResetAvail').style.display = 'none';
    $('#modalText').placeholder = 'Svilar\nBremer\nDimarco\nPaz N.\nThuram';
    pasteSide = side;
    pasteTeam = side === 'A' ? state.my : state.opp;
    $('#modalTitle').textContent = side === 'A' ? 'Incolla la tua rosa' : 'Incolla la rosa dell\'avversario';
    $('#modalPreview').innerHTML = '';
    $('#modal').classList.add('open');
    $('#modalText').focus();
  }
  function openTeamModal(i) {
    modalMode = 'roster';
    $('#modalHint').textContent = 'Un giocatore per riga (o separati da virgola). Vanno bene anche "Cognome N." e i nomi completi.';
    $('#modalOk').textContent = 'Carica rosa';
    $('#modalResetAvail').style.display = 'none';
    pasteTeam = i;
    pasteSide = i === state.my ? 'A' : 'B';
    var t = curLeague().teams[i];
    $('#modalTitle').textContent = 'Incolla la rosa di ' + (t ? t.name : '');
    $('#modalPreview').innerHTML = '';
    $('#modal').classList.add('open');
    $('#modalText').focus();
  }
  function updatePastePreview() {
    if (modalMode === 'pf') {
      var rp = parseProbabili($('#modalText').value);
      var certi = rp.entries.filter(function (e) { return e.status === 'certo'; }).length;
      $('#modalPreview').innerHTML = rp.teams.length + ' squadre · ' + certi + ' titolari, ' + (rp.entries.length - certi) + ' in dubbio' +
        (rp.unmatched.length ? ' · <span class="ko">non trovati: ' + esc(rp.unmatched.slice(0, 8).join(', ')) + (rp.unmatched.length > 8 ? '…' : '') + '</span>' : '');
      return;
    }
    var r = parsePaste($('#modalText').value);
    $('#modalPreview').innerHTML = r.matched.length + ' riconosciuti' +
      (r.missing.length ? ' · <span class="ko">non trovati: ' + esc(r.missing.join(', ')) + '</span>' : '') ;
  }

  /* ---------- eventi ---------- */
  function bind() {
    $$('nav.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
    });

    $$('[data-step]').forEach(function (b) {
      b.addEventListener('click', function () {
        var which = b.getAttribute('data-step'), dir = +b.getAttribute('data-dir');
        if (which === 'teams') state.teams = clamp(state.teams + dir, 6, 16);
        if (which === 'gw') state.gwLeft = clamp(state.gwLeft + dir, 1, 38);
        $('#valTeams').textContent = state.teams;
        $('#valGw').textContent = state.gwLeft;
        renderAll();
      });
    });
    $('#selFormation').addEventListener('change', function (e) {
      state.formation = e.target.value;
      renderAll();
    });

    $('#btnDemo').addEventListener('click', function () { loadDemo(); toast('Caricata una lega demo da 10 squadre'); });

    // header: lega, avversario, calendario, regola
    $('#selLeague').addEventListener('change', function (e) {
      state.active = +e.target.value;
      var L = curLeague(), my = 0;
      L.teams.forEach(function (t, i) { if (t.me) my = i; });
      state.my = my;
      state.opp = my === 0 ? (L.teams.length > 1 ? 1 : 0) : 0;
      state.sel = { A: [], B: [] };
      syncTeamsCount(); resetEaseCache(); renderAll();
    });
    $('#selOpp').addEventListener('change', function (e) {
      state.opp = +e.target.value; state.sel.B = []; renderAll();
    });
    $('#btnCal').addEventListener('click', function () {
      state.useCal = !state.useCal;
      $('#btnCal').classList.toggle('on', state.useCal);
      renderAll();
      toast(state.useCal ? 'Calendario incluso nei punti attesi' : 'Calendario escluso');
    });
    $$('[data-step="horizon"]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.horizon = clamp(state.horizon + (+b.getAttribute('data-dir')), 1, 10);
        $('#valHorizon').textContent = state.horizon + ' giornate';
        resetEaseCache(); renderAll();
      });
    });
    $('#selRule').addEventListener('change', function (e) { state.tradeRule = e.target.value; });

    // prospettiva: tre scelte invece di un cursore libero. Le percentuali sono quelle che
    // uso nelle prove sui dati (50/65/78): fuori da questo intervallo il modello o ignora il
    // campionato o lo butta via. Chi ha salvato un valore diverso resta sul più vicino, e la
    // scritta accanto mostra la percentuale esatta.
    var seg = $('#prospectSeg');
    if (seg) {
      var paintProspect = function () {
        var btns = seg.querySelectorAll('button');
        var best = null, bestD = 9;
        Array.prototype.forEach.call(btns, function (b) {
          var v = +b.getAttribute('data-prospect');
          var d = Math.abs(v - state.prospect);
          if (d < bestD - 1e-9) { bestD = d; best = b; }
          b.classList.remove('on');
        });
        if (best) best.classList.add('on');
        var pct = Math.round(state.prospect * 100);
        var el = $('#valProspect');
        if (el) el.textContent = pct + '% futuro' + (bestD > 0.001 ? ' · personalizzata' : '');
        if (best) best.title = best.title.split(' \u00b7 fonte')[0];
      };
      seg.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-prospect]');
        if (!b) return;
        state.prospect = clamp(+b.getAttribute('data-prospect'), 0, 1);
        paintProspect();
        renderAll();
        if ($('#tab-report').classList.contains('active')) { renderOffers(true); }
        if ($('#tab-players').classList.contains('active')) renderPlayers();
        toast('Prospettiva: ' + b.textContent.trim() + ' · ' + Math.round(state.prospect * 100) + '% previsto, ' + Math.round(100 - state.prospect * 100) + '% già fatto');
      });
      state._prospectLabel = paintProspect;
      paintProspect();
    }

    // conguaglio in crediti: on/off
    var chk = $('#chkCredits');
    if (chk) {
      chk.addEventListener('change', function (e) {
        state.useCredits = e.target.checked;
        offerCache = { sig: null, list: [] };
        renderAll();
        if ($('#tab-report').classList.contains('active')) renderOffers(true);
        toast(state.useCredits ? 'Conguaglio in crediti attivo' : 'Conguaglio in crediti disattivato');
      });
    }
    if ($('#chkFree')) {
      $('#chkFree').addEventListener('change', function (e) {
        state.useFree = e.target.checked;
        offerCache = { sig: null, list: [] };
        freeCache = null;
        renderAll();
        if ($('#tab-report').classList.contains('active')) renderOffers(true);
        toast(state.useFree ? 'Confronto con gli svincolati attivo' : 'Guadagno lordo: confronto con gli svincolati spento');
      });
    }
    $('#chkAll').addEventListener('change', function (e) { state.findAll = e.target.checked; });

    // scheda Lega
    $('#leagueOut').addEventListener('click', function (e) {
      var lg = e.target.closest('[data-lg]');
      if (lg) {
        var act = lg.getAttribute('data-lg');
        if (act === 'new') {
          state.leagues.push({ name: 'Lega ' + (state.leagues.length + 1), teams: [
            { name: 'La mia squadra', me: true, players: [] },
            { name: 'Avversario 1', me: false, players: [] }
          ] });
          state.active = state.leagues.length - 1; state.my = 0; state.opp = 1;
          renderAll(); toast('Nuova lega creata: incolla le rose');
        } else if (act === 'del') {
          if (state.leagues.length === 1) { toast('Serve almeno una lega'); return; }
          state.leagues.splice(state.active, 1);
          state.active = 0; state.my = 0; state.opp = 1;
          renderAll();
        } else if (act === 'import') { openLeagueModal(); }
        else if (act === 'csv') { $('#fileLeague').click(); }
        return;
      }
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var i = +b.getAttribute('data-i'), what = b.getAttribute('data-act');
      var L = curLeague();
      if (what === 'me') {
        L.teams.forEach(function (t, j) { t.me = j === i; });
        state.my = i;
        if (state.opp === i) state.opp = i === 0 ? 1 : 0;
        state.sel = { A: [], B: [] };
        renderAll();
      } else if (what === 'opp') {
        state.opp = i; state.sel.B = []; switchTab('trade'); state.findAll = false;
        renderAll();
        toast('Ora analizzi gli scambi con ' + L.teams[i].name);
      } else if (what === 'paste') {
        openTeamModal(i);
      } else if (what === 'clear') {
        L.teams[i].players = [];
        state.sel = { A: [], B: [] };
        renderAll();
      }
    });
    // crediti residui dichiarati: si confermano su "change" (invio o uscita dal campo), non a
    // ogni tasto, altrimenti il ridisegno della scheda fa saltare il cursore. Dopo uno scambio
    // i crediti viaggiano con i giocatori, quindi "budget meno la spesa" non è più il residuo
    // vero: campo vuoto = torna al calcolo automatico.
    $('#leagueOut').addEventListener('change', function (e) {
      if (!e.target.hasAttribute || !e.target.hasAttribute('data-credits')) return;
      var ti = +e.target.getAttribute('data-credits'), tt = curLeague().teams[ti];
      if (!tt) return;
      var raw = e.target.value.trim();
      if (raw === '') delete tt.credits;
      else setCredits(tt, +raw || 0);
      saveState(); renderLeague(); syncHeader();
    });
    $('#leagueOut').addEventListener('input', function (e) {
      var tn = e.target.closest('[data-tname]');
      if (tn) { curLeague().teams[+tn.getAttribute('data-tname')].name = tn.value; saveState(); syncHeader(); return; }
      if (e.target.id === 'lgName') { curLeague().name = e.target.value; saveState(); syncHeader(); }
      if (e.target.hasAttribute && e.target.hasAttribute('data-budget')) {
        curLeague().budget = Math.max(0, +e.target.value || 0);
        rateCache = null; saveState(); renderAll();
      }
    });
    $('#leagueOut').addEventListener('change', function (e) {
      if (e.target.id !== 'fileLeague') return;
      var files = Array.prototype.slice.call(e.target.files || []);
      if (!files.length) return;
      var pending = files.length, imported = [], unknown = 0;
      files.forEach(function (f) {
        var rd = new FileReader();
        rd.onload = function () {
          var L = parseRosterCsv(String(rd.result), f.name);
          if (L) { imported.push(L); unknown += L.unknown; }
          if (--pending === 0) {
            if (!imported.length) { toast('Nessun giocatore riconosciuto nel CSV'); return; }
            imported.forEach(function (L) {
              // se la lega esiste già (reimport dopo uno scambio), mi porto dietro quello che
              // il CSV non contiene: crediti dichiarati a mano, budget, chi sono io
              var old = null;
              state.leagues.forEach(function (E) { if (squashName(E.name) === squashName(L.name)) old = E; });
              if (old) {
                if (+old.budget > 0) L.budget = old.budget;
                var byName = {};
                (old.teams || []).forEach(function (t) { byName[squashName(t.name)] = t; });
                L.teams.forEach(function (t) {
                  var o = byName[squashName(t.name)];
                  if (!o) return;
                  if (typeof o.credits === 'number') t.credits = o.credits;
                  if (o.me) t.me = true;
                });
                var idxOld = state.leagues.indexOf(old);
                if (idxOld >= 0) state.leagues.splice(idxOld, 1);
              }
              if (!L.teams.some(function (t) { return t.me; })) L.teams[0].me = true;
              state.leagues.push(L);
            });
            state.active = state.leagues.length - 1;
            var meIdx = state.leagues[state.active].teams.findIndex(function (t) { return t.me; });
            state.my = meIdx < 0 ? 0 : meIdx;
            state.opp = state.leagues[state.active].teams.length > 1 ? (state.my === 0 ? 1 : 0) : 0;
            state.sel = { A: [], B: [] };
            syncTeamsCount(); renderAll();
            toast(imported.length + ' leghe importate' + (unknown ? ', ' + unknown + ' id ignorati' : ''));
          }
        };
        rd.readAsText(f);
      });
    });
    $('#leagueText').addEventListener('input', updateLeaguePreview);
    $('#lgCancel').addEventListener('click', function () { $('#modalLeague').classList.remove('open'); });
    $('#lgOk').addEventListener('click', function () {
      var r = parseLeague($('#leagueText').value);
      if (!r.teams.length) { toast('Nessun giocatore riconosciuto'); return; }
      r.teams.forEach(function (t, i) { t.me = i === 0; });
      state.leagues.push({ name: 'Lega importata ' + state.leagues.length, teams: r.teams });
      state.active = state.leagues.length - 1; state.my = 0; state.opp = r.teams.length > 1 ? 1 : 0;
      $('#modalLeague').classList.remove('open');
      $('#leagueText').value = '';
      state.sel = { A: [], B: [] };
      renderAll();
      toast(r.teams.length + ' squadre e ' + r.teams.reduce(function (a, t) { return a + t.players.length; }, 0) + ' giocatori importati');
    });
    $('#modalLeague').addEventListener('click', function (e) { if (e.target === $('#modalLeague')) $('#modalLeague').classList.remove('open'); });
    $('#btnPasteA').addEventListener('click', function () { openModal('A'); });
    $('#btnPasteB').addEventListener('click', function () { openModal('B'); });
    $('#btnReset').addEventListener('click', function () { state.sel = { A: [], B: [] }; renderAll(); });
    $('#btnApply').addEventListener('click', function () {
      var r = currentResult();
      applyTrade(state.sel.A.slice(), state.sel.B.slice(), state.opp, creditFor(r.dA, r.dB, state.opp, [state.sel.A, state.sel.B]));
    });

    // esporta le due rose in un file JSON
    $('#btnExport').addEventListener('click', function () {
      try {
        var blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'fantatrade-rose.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        toast('Rose esportate: conserva il file per ricaricarle');
      } catch (e) { toast('Export non disponibile in questa anteprima'); }
    });
    // importa da file
    $('#btnImport').addEventListener('click', function () { $('#fileImport').click(); });
    $('#fileImport').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var d = JSON.parse(reader.result);
          if (applySnapshot(d)) { renderAll(); toast('Rose ricaricate dal file'); }
          else toast('File non riconosciuto');
        } catch (err) { toast('File non leggibile'); }
      };
      reader.readAsText(f);
      e.target.value = '';
    });
    // copia il link con le rose dentro
    $('#btnLink').addEventListener('click', function () {
      var url = (window.location.href.split('#')[0]) + stateToHash();
      function done() { toast('Link copiato: contiene le due rose'); }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done, function () { fallback(); });
        } else fallback();
      } catch (e) { fallback(); }
      function fallback() {
        try {
          var ta = document.createElement('textarea');
          ta.value = url; document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); document.body.removeChild(ta); done();
        } catch (e) { window.prompt('Copia questo link:', url); }
      }
    });

    $('#nameA').addEventListener('input', function (e) { teamA().name = e.target.value; saveState(); syncHeader(); });
    $('#nameB').addEventListener('input', function (e) { teamB().name = e.target.value; saveState(); syncHeader(); });

    ['A', 'B'].forEach(function (side) {
      var ul = side === 'A' ? $('#rosA') : $('#rosB');
      ul.addEventListener('click', function (e) {
        var av = e.target.closest('.avail');
        if (av) {
          var aid = +av.getAttribute('data-avail');
          var cur = state.avail[aid] || 'ok';
          var next = cur === 'ok' ? 'dubbio' : cur === 'dubbio' ? 'out' : 'ok';
          if (next === 'ok') delete state.avail[aid]; else state.avail[aid] = next;
          renderAll();
          return;
        }
        var del = e.target.closest('.del');
        if (del) {
          var did = +del.getAttribute('data-del');
          setR(side, R(side).filter(function (i) { return i !== did; }));
          state.sel[side] = state.sel[side].filter(function (i) { return i !== did; });
          renderAll();
          return;
        }
        var li = e.target.closest('li[data-id]');
        if (!li) return;
        var id = +li.getAttribute('data-id');
        var arr = state.sel[side];
        var at = arr.indexOf(id);
        if (at >= 0) arr.splice(at, 1); else arr.push(id);
        renderAll();
      });
      attachSearch(side === 'A' ? $('#searchA') : $('#searchB'), side === 'A' ? $('#sugA') : $('#sugB'), side);
    });

    $('#giveChips').addEventListener('click', function (e) {
      var x = e.target.closest('.x'); if (!x) return;
      state.sel.A = state.sel.A.filter(function (i) { return i !== +x.getAttribute('data-remove'); });
      renderAll();
    });
    $('#getChips').addEventListener('click', function (e) {
      var x = e.target.closest('.x'); if (!x) return;
      state.sel.B = state.sel.B.filter(function (i) { return i !== +x.getAttribute('data-remove'); });
      renderAll();
    });

    $('#btnFind').addEventListener('click', renderFind);
    $('#btnOffers').addEventListener('click', function () { offerCache = { sig: null, list: [] }; renderOffers(true); });
    $$('#btnUndo, [data-undo]').forEach(function (b) { b.addEventListener('click', function () { undoLast(); }); });
    var chkAsym = $('#chkAsym');
    if (chkAsym) chkAsym.addEventListener('change', function (e) {
      state.offersAsym = e.target.checked;
      offerCache = { sig: null, list: [] };
      renderAll();
      if ($('#tab-report').classList.contains('active')) renderOffers(true);
    });
    $$('#offerDepth button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.depth = +b.getAttribute('data-depth');
        $$('#offerDepth button').forEach(function (x) { x.classList.toggle('on', x === b); });
        $$('#depthFilter button').forEach(function (x) { x.classList.toggle('on', +x.getAttribute('data-depth') === state.depth); });
        offerCache = { sig: null, list: [] };
        renderOffers(true);
      });
    });
    $$('#depthFilter button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.depth = +b.getAttribute('data-depth');
        $$('#depthFilter button').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });

    $$('#dataRoles button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.dataRole = b.getAttribute('data-role');
        $$('#dataRoles button').forEach(function (x) { x.classList.toggle('on', x === b); });
        renderPlayers();
      });
    });
    $('#dataQuery').addEventListener('input', function (e) { state.dataQuery = e.target.value; renderPlayers(); });
    (function () {
      var list = $('#cmpList');
      if (list) {
        list.innerHTML = POOL.map(function (p) {
          return '<option value="' + esc(cmpNice(p)) + '"></option>';
        }).join('');
      }
      ['#cmpA', '#cmpB'].forEach(function (sel) {
        var el = $(sel);
        if (!el) return;
        el.addEventListener('input', function (e) {
          state[sel === '#cmpA' ? 'cmpA' : 'cmpB'] = e.target.value;
          renderCompare();
        });
      });
      var clr = $('#cmpClear');
      if (clr) clr.addEventListener('click', function () {
        state.cmpA = ''; state.cmpB = '';
        $('#cmpA').value = ''; $('#cmpB').value = '';
        renderCompare();
      });
    })();
    $$('#dataTable th').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-key');
        if (state.dataSort.key === k) state.dataSort.dir *= -1;
        else state.dataSort = { key: k, dir: k === 'n' || k === 't' || k === 'r' ? 1 : -1 };
        renderPlayers();
      });
    });

    $('#btnPF').addEventListener('click', function () { openProbabili(); });
    $('#modalResetAvail').addEventListener('click', function () {
      state.avail = {}; renderAll();
      toast('Stati azzerati: tutti disponibili');
      $('#modal').classList.remove('open');
    });
    $('#modalCancel').addEventListener('click', function () { $('#modal').classList.remove('open'); });
    $('#modalText').addEventListener('input', updatePastePreview);
    $('#modalOk').addEventListener('click', function () {
      if (modalMode === 'pf') {
        var rp = parseProbabili($('#modalText').value);
        if (!rp.entries.length) { toast('Nessun giocatore riconosciuto: controlla il formato'); return; }
        applyProbabili(rp);
        $('#modal').classList.remove('open');
        $('#modalText').value = '';
        return;
      }
      var r = parsePaste($('#modalText').value);
      var L = curLeague();
      if (L && L.teams[pasteTeam]) L.teams[pasteTeam].players = r.matched;
      else setR(pasteSide, r.matched);
      state.sel[pasteSide] = [];
      $('#modal').classList.remove('open');
      $('#modalText').value = '';
      renderAll();
      toast(r.matched.length + ' giocatori caricati' + (r.missing.length ? ', ' + r.missing.length + ' non riconosciuti' : ''));
    });
    $('#modal').addEventListener('click', function (e) { if (e.target === $('#modal')) $('#modal').classList.remove('open'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('#modal').classList.remove('open'); });
  }

  /* ---------- avvio ---------- */
  M.calibrate(POOL);          // mediane di voto e bonus per ruolo, dai dati caricati
  M.setProspect(state.prospect);
  bind();
  if (!loadState()) {
    if (SEED_LEAGUES.length) { loadLeagues(SEED_LEAGUES); toast('Caricate ' + SEED_LEAGUES.length + ' leghe dagli export di Fantacalcio.it'); }
    else loadDemo();
  }
  if (!state.leagues.length) loadDemo();
  $('#nameA').value = teamA() ? teamA().name : '';
  $('#nameB').value = teamB() ? teamB().name : '';
  $('#selFormation').value = state.formation;
  $('#selRule').value = state.tradeRule;
  $('#btnCal').classList.toggle('on', state.useCal);
  $('#valHorizon').textContent = state.horizon + ' giornate';
  if ($('#rngProspect')) $('#rngProspect').value = Math.round(state.prospect * 100);   // compatibilità
  if (state._prospectLabel) state._prospectLabel();
  if ($('#chkCredits')) $('#chkCredits').checked = state.useCredits;
  if ($('#chkFree')) $('#chkFree').checked = state.useFree;
  if ($('#chkAsym')) $('#chkAsym').checked = state.offersAsym;
  paintUndo();
  syncTeamsCount();
  renderAll();
  $('#valTeams').textContent = state.teams;
  $('#valGw').textContent = state.gwLeft;
  renderPlayers();
})();
