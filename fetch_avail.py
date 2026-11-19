#!/usr/bin/env python3
"""
fetch_avail.py — indisponibili di oggi e probabili formazioni, dal sito ufficiale di Fantacalcio.it.

Cosa prende
-----------
1. `/indisponibili-serie-a`  → chi è fuori adesso: infortunati e squalificati, con il motivo
                                e, quando c'è scritto, il periodo di rientro ("rientro da metà dicembre").
                                I nomi sono già nella forma del listone ("Kristensen T."), e la
                                squadra è quella della scheda in cui compaiono.
2. `/probabili-formazioni-serie-a` → per ogni squadra il modulo e, per ogni giocatore, la
                                **probabilità di partire titolare** (con la panchina). I link
                                contengono l'id Fantacalcio, quindi l'abbinamento è esatto.

Scrive `app/avail.json`, che `build.py` incorpora nell'app. Se una delle due pagine non
risponde, l'altra viene salvata lo stesso; se non risponde nessuna, il file non viene toccato.

Uso
---
    python3 fetch_avail.py              # scarica, scrive app/avail.json, ricompila
    python3 fetch_avail.py --dry-run     # mostra cosa ha trovato, non scrive
    python3 fetch_avail.py --from-file indisponibili.html --kind out
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from fetch_extra import norm, club_of  # riuso la normalizzazione già collaudata

AVAIL = ROOT / "app" / "avail.json"
DATA = ROOT / "app" / "data.json"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept-Language": "it-IT,it;q=0.9"}
BASE = "https://www.fantacalcio.it"
PAGE_OUT = BASE + "/indisponibili-serie-a"
PAGE_LU = BASE + "/probabili-formazioni-serie-a"
# seconda fonte per gli indisponibili: da qui arriva il "rientro alla Nª giornata",
# cioè un numero esatto al posto della frase da interpretare
PAGE_PIANETA = "https://www.pianetafanta.it/indisponibili-fantacalcio"
# diffidati: un'ammonizione e saltano la giornata dopo
PAGE_DIFF = BASE + "/squalificati-e-diffidati-campionato-serie-a"

MESI = ("gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
        "agosto", "settembre", "ottobre", "novembre", "dicembre")


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def soup_of(html):
    from bs4 import BeautifulSoup
    return BeautifulSoup(html, "lxml")


def card_team(card):
    """Nome della squadra: nelle due pagine sta in punti diversi (.team-name, <h3>)."""
    el = card.select_one(".team-name") or card.find(["h1", "h2", "h3", "h4", "h5"])
    return el.get_text(" ", strip=True) if el else ""


# ------------------------------------------------------------------ indisponibili
def parse_out(html):
    """[{nome, squadra, tipo, motivo, rientro}] — la squadra è l'intestazione della scheda.

    Attenzione: ogni scheda ha più colonne (Infortunati, Squalificati, Diffidati) e solo la
    prima ha le descrizioni. Prendere tutti gli `li` della scheda faceva entrare i diffidati
    fra gli indisponibili con la descrizione vuota: si legge colonna per colonna.
    """
    soup = soup_of(html)
    rows = []
    for card in soup.select("div.team-card"):
        team = club_of(card_team(card))
        for col in card.select("div.col"):
            head = col.find(["strong", "header", "h4", "a"])
            label = (head.get_text(" ", strip=True) if head else "").lower()
            if label and "infortunat" not in label and "indisponibil" not in label:
                continue        # squalificati e diffidati hanno la loro strada
            for li in col.select("li"):
                nm = li.select_one(".item-name")
                if not nm:
                    continue
                desc = li.select_one(".item-description")
                motivo = re.sub(r"\s+", " ", desc.get_text(" ", strip=True)) if desc else ""
                rows.append({"nome": nm.get_text(" ", strip=True), "squadra": team,
                             "tipo": "infortunio", "motivo": motivo,
                             "rientro": return_hint(motivo)})
    return rows


def return_hint(text):
    """La frase breve con il periodo di rientro: 'rientro dalla fine di novembre'.

    Il testo di Fantacalcio è libero, quindi spezzo in proposizioni e tengo quella più
    utile: prima quella con un mese, altrimenti l'ultima con parole di rientro.
    """
    if not text:
        return ""
    clausole = [c.strip(" .;") for c in re.split(r"(?<=[.!?;])\s+|,\s+", text) if c.strip()]
    con_mese = [c for c in clausole if any(m in c.lower() for m in MESI)]
    con_rientro = [c for c in clausole
                   if any(k in c.lower() for k in ("rientro", "ritorno", "torner", "recupero",
                                                   "da valutare", "in dubbio", "out "))]
    best = (con_mese or con_rientro or [""])[-1]
    if not best:
        return ""
    best = re.sub(r"^(e|ma|però|poi)\s+", "", best, flags=re.I)
    if len(best) > 110:
        best = best[:110].rsplit(" ", 1)[0].rstrip(",.;") + "…"
    return best[:1].upper() + best[1:]


MESI_N = {m: i + 1 for i, m in enumerate(MESI)}


def out_days(text, today=None):
    """Quante giornate/gg di stop restano, lette da "rientro dalla fine di novembre", "da marzo"…

    Serve perché *è fuori* non vuol dire *è fuori tutta la stagione*: chi rientra fra dieci giorni
    vale quasi come uno sano, chi rientra ad aprile no. Se il testo non lo dice, ritorna None
    (e il modello usa una stima prudente)."""
    import datetime
    today = today or datetime.date.today()
    low = (text or "").lower()
    if not low.strip():
        return None
    if "prossimo turno" in low:
        return 7
    m = re.search(r"(fine|seconda met\u00e0|prima met\u00e0|met\u00e0|inizio)?\s*(?:di\s+)?("
                  + "|".join(MESI) + r")", low)
    if not m:
        return None
    qual, mese = (m.group(1) or "").strip(), MESI_N[m.group(2)]
    anno = today.year + (1 if mese < today.month else 0)
    giorno = {"inizio": 5, "prima met\u00e0": 7, "met\u00e0": 15, "seconda met\u00e0": 22, "fine": 26}.get(qual, 15)
    import datetime as _dt
    try:
        d = _dt.date(anno, mese, min(giorno, 28))
    except ValueError:
        return None
    giorni = (d - today).days
    return max(0, giorni)


def parse_diffidati(html):
    """[{nome, squadra, squalificato: bool, nota}] — la pagina ha due colonne per squadra."""
    soup = soup_of(html)
    rows = []
    for card in soup.select("div.team-card"):
        team = club_of(card_team(card))
        for col in card.select("div.col"):
            head = col.find(["strong", "h3", "h4"])
            label = (head.get_text(" ", strip=True) if head else "").lower()
            squal = "squalific" in label
            if not squal and "diffidat" not in label:
                continue
            for li in col.select("li"):
                nm = li.select_one(".item-name")
                if not nm:
                    continue
                nome = nm.get_text(" ", strip=True)
                if not nome or nome.strip().lower() == "nessuno":
                    continue
                p = li.select_one(".item-description")
                rows.append({"nome": nome, "squadra": team, "squalificato": squal,
                             "nota": re.sub(r"\s+", " ", p.get_text(" ", strip=True)) if p else ""})
    return rows


def parse_pianeta(html):
    """Tabella indisponibili di PianetaFanta: ruolo, nome, diagnosi, "2 settimane · Rientro: 13ª giornata".

    La colonna di destra è oro: 63 righe su 86 dicono a quale giornata il giocatore torna,
    il resto dice "Incerto" / "In Dubbio" / "Tempi da definire".
    """
    soup = soup_of(html)
    rows = []
    for table in soup.select("table"):
        for tr in table.select("tr"):
            tds = tr.select("td")
            if len(tds) < 3:
                continue
            a = tds[1].select_one("a")
            nome = (a.get_text(" ", strip=True) if a else tds[1].get_text(" ", strip=True)).strip()
            if not nome:
                continue
            em = tds[1].select_one("em")
            diagnosi = re.sub(r"\s+", " ", em.get_text(" ", strip=True)) if em else ""
            stato = re.sub(r"\s+", " ", tds[2].get_text(" ", strip=True))
            m = re.search(r"[Rr]ientro:?\s*(\d{1,2})", stato)
            giornata = int(m.group(1)) if m else None
            md = re.search(r"\d+\s*(?:giorn\w*|settiman\w*|mes\w*|giorn\w*)", stato)
            rows.append({
                "nome": nome,
                "ruolo": (tds[0].get_text(strip=True)[:1] or "").upper(),
                "diagnosi": diagnosi,
                "stato": stato,
                "giornata": giornata,
                "durata": md.group(0) if md else "",
                "dubbio": bool(re.search(r"incert|in dubbio|da definire|da valutare", stato, re.I)),
            })
    return rows


def parse_matchday(html):
    """'Giornata 12' nella pagina delle probabili formazioni → 12"""
    m = re.search(r"Giornata\s+(\d{1,2})", html or "")
    return int(m.group(1)) if m else None


# ------------------------------------------------------------------ probabili formazioni
def parse_lineups(html):
    """[{squadra, modulo, xi: [{nome, sid, pct, r}], panchina: [...]}]"""
    soup = soup_of(html)
    out = []
    for card in soup.select("div.team-card"):
        team = club_of(card_team(card))
        mod = card.select_one(".team-formation")
        lists = card.select("ul.player-list")
        if not team or not lists:
            continue
        def players(ul):
            rows = []
            for li in ul.select("li.player-item"):
                a = li.select_one("a.player-name")
                if not a:
                    continue
                sid = None
                href = a.get("href") or ""
                m = re.search(r"/(\d+)$", href)
                if m:
                    sid = int(m.group(1))
                pv = li.select_one(".progress-value")
                pct = None
                if pv:
                    m2 = re.search(r"(\d+)", pv.get_text(" ", strip=True))
                    if m2:
                        pct = int(m2.group(1))
                role = li.select_one(".role")
                rows.append({"nome": a.get_text(" ", strip=True), "sid": sid, "pct": pct,
                             "r": (role.get("data-value") or "").upper() if role else ""})
            return rows
        out.append({"squadra": team, "modulo": mod.get_text(strip=True) if mod else "",
                    "xi": players(lists[0]),
                    "panchina": players(lists[1]) if len(lists) > 1 else []})
    return out


# ------------------------------------------------------------------ abbinamento
def listone_keys(name):
    """stesse chiavi usate in fetch_extra per i nomi del listone"""
    from fetch_extra import _listone_keys
    return _listone_keys(name)


ROLE_WORDS = (("portiere", "P"), ("estremo difensore", "P"), ("difensore", "D"),
              ("terzino", "D"), ("centrocampista", "C"), ("mediano", "C"),
              ("trequartista", "C"), ("attaccante", "A"), ("punta", "A"))


def role_hint(text):
    low = (text or "").lower()
    for word, role in ROLE_WORDS:
        if word in low:
            return role
    return None


def name_keys(name):
    """Chiavi per abbinare un nome senza squadra: (cognome, iniziale), (cognome, None), nome intero."""
    out = []
    for surname, initial in listone_keys(name):
        out.append((surname, initial))
        out.append((surname, None))
    out.append((norm(name), None))
    return out


def build_name_index(players):
    bykey = {}
    for i, p in enumerate(players):
        for k in name_keys(p.get("n")):
            bykey.setdefault(k, set()).add(i)
    return bykey


def resolve_by_name(name, role, players, bykey):
    """Abbina un nome senza squadra; se il cognome è condiviso decide il ruolo (le due fonti
    non sempre danno lo stesso ruolo, quindi il ruolo è solo un tie-breaker)."""
    for k in name_keys(name):
        cands = bykey.get(k, set())
        if len(cands) == 1:
            return next(iter(cands))
        if len(cands) > 1:
            same = [i for i in cands if (players[i].get("r") or "").upper() == role]
            if len(same) == 1:
                return same[0]
    return None


def build_index(players):
    """chiave -> [indici]: più candidati quando il listone ha due omonimi nella stessa squadra."""
    idx = {}
    for i, p in enumerate(players):
        club = norm(p.get("t"))
        keys = {(surname, initial, club) for surname, initial in listone_keys(p.get("n"))}
        keys |= {(surname, None, club) for surname, _ in listone_keys(p.get("n"))}
        keys.add((norm(p.get("n")), None, club))
        for key in keys:
            bucket = idx.setdefault(key, [])
            if i not in bucket:
                bucket.append(i)
    return idx


def resolve(name, team, players, idx, hint=""):
    """Ritorna l'indice del giocatore del listone, o None se ambiguo/sconosciuto."""
    club = norm(team)

    def pick(bucket):
        if len(bucket) == 1:
            return bucket[0]
        role = role_hint(hint)
        same = [i for i in bucket if (players[i].get("r") or "").upper().startswith(role)] if role else []
        return same[0] if len(same) == 1 else None

    key = (norm(name), None, club)
    if key in idx:
        found = pick(idx[key])
        if found is not None:
            return found
    for surname, initial in listone_keys(name):
        for key in ((surname, initial, club), (surname, None, club)):
            if key in idx:
                found = pick(idx[key])
                if found is not None:
                    return found
    return None


# ------------------------------------------------------------------ run
def run(out_html=None, lu_html=None, pn_html=None, df_html=None, dry=False, no_build=False):
    players = json.loads(DATA.read_text(encoding="utf-8"))
    by_sid = {p.get("sid"): p for p in players if p.get("sid") is not None}
    idx = build_index(players)

    gw = parse_matchday(lu_html) if lu_html else None
    out_rows, unknown = [], []
    if out_html:
        for r in parse_out(out_html):
            i = resolve(r["nome"], r["squadra"], players, idx, r["motivo"])
            if i is None:
                unknown.append(f"{r['nome']} ({r['squadra']})")
                continue
            p = players[i]
            out_rows.append({"sid": p["sid"], "n": p["n"], "t": p["t"], "tipo": r["tipo"],
                             "motivo": r["motivo"][:300], "rientro": r["rientro"],
                             "giorni": out_days(r["rientro"] or r["motivo"])})

    lineups, lu_rows, ben_rows, modules = [], {}, {}, {}
    if lu_html:
        for team in parse_lineups(lu_html):
            modules[team["squadra"]] = team["modulo"]
            lineups.append(team)
            for group, dest in (("xi", lu_rows), ("panchina", ben_rows)):
                for pl in team[group]:
                    sid = pl.get("sid")
                    if sid is None or pl.get("pct") is None:
                        continue
                    if sid not in by_sid:            # id Fantacalcio non presente nel listone
                        i = resolve(pl["nome"], team["squadra"], players, idx)
                        if i is None:
                            unknown.append(f"{pl['nome']} ({team['squadra']})")
                            continue
                        sid = players[i]["sid"]
                    dest[str(sid)] = pl["pct"]

    # --- seconda fonte: PianetaFanta, che dice a quale giornata si rientra
    n_pn = n_pn_new = 0
    if pn_html:
        bykey = build_name_index(players)
        by_sid = {o["sid"]: o for o in out_rows}
        for r in parse_pianeta(pn_html):
            i = resolve_by_name(r["nome"], r["ruolo"], players, bykey)
            if i is None:
                unknown.append(f"{r['nome']} (pianetafanta)")
                continue
            sid = players[i]["sid"]
            giorni = None
            if r["giornata"]:
                giorni = max(0, (r["giornata"] - (gw or 12)) * 7)
            n_pn += 1
            if sid in by_sid:
                o = by_sid[sid]
                o["fonti"] = "entrambe"
                if giorni is not None:
                    o["giorni"] = giorni
                    o["giornata"] = r["giornata"]
                if (r["dubbio"] and giorni is None and o.get("giorni") is None
                        and o["tipo"] == "infortunio"):
                    o["tipo"] = "dubbio"        # fuori, ma senza tempi: è un dubbio, non uno stop
                if r["giornata"] and not (o.get("rientro") or "").strip():
                    o["rientro"] = f"Rientro alla {r['giornata']}ª giornata"
                elif r["durata"] and not (o.get("rientro") or "").strip():
                    o["rientro"] = f"Stop stimato {r['durata']}"
            else:
                n_pn_new += 1
                tipo = "infortunio" if (giorni is not None or r["durata"]) else "dubbio"
                if r["dubbio"] and tipo == "infortunio" and giorni is None:
                    tipo = "dubbio"
                out_rows.append({
                    "sid": sid, "n": players[i]["n"], "t": players[i]["t"], "tipo": tipo,
                    "motivo": r["diagnosi"][:300],
                    "rientro": (f"Rientro alla {r['giornata']}ª giornata" if r["giornata"]
                                else (f"Stop stimato {r['durata']}" if r["durata"] else r["stato"][:60])),
                    "giorni": giorni, "giornata": r["giornata"], "fonti": "pianetafanta",
                })
        # chi viene solo da fantacalcio.it
        for o in out_rows:
            o.setdefault("fonti", "fantacalcio")

    # --- diffidati: non sono fuori, ma con un'ammonizione salterebbero la giornata dopo
    diffidati, squalificati_fc = [], []
    if df_html:
        bykey2 = build_name_index(players)
        by_sid2 = {o["sid"]: o for o in out_rows}
        for r in parse_diffidati(df_html):
            i = resolve_by_name(r["nome"], "", players, bykey2)
            if i is None:
                continue
            sid2 = players[i]["sid"]
            if r["squalificato"]:
                squalificati_fc.append(sid2)
                if sid2 not in by_sid2:      # lo squalificato va fra gli indisponibili
                    out_rows.append({
                        "sid": sid2, "n": players[i]["n"], "t": players[i]["t"],
                        "tipo": "squalifica", "motivo": r["nota"] or "squalificato",
                        "rientro": r["nota"] or "", "giorni": 7, "giornata": None,
                        "fonti": "fantacalcio",
                    })
                else:
                    by_sid2[sid2]["tipo"] = "squalifica"
            else:
                diffidati.append(sid2)

    print(f"indisponibili: {len(out_rows)} abbinati"
          + (f" · {n_pn} letti su pianetafanta ({n_pn_new} solo lì)" if pn_html else "")
          + f" · non riconosciuti {len(unknown)}")
    if lu_rows or ben_rows:
        print(f"probabili formazioni: {len(lineups)} squadre · {len(lu_rows)} titolari · {len(ben_rows)} in panchina"
          + (f" · giornata {gw}" if gw else ""))
    if unknown:
        print("  non riconosciuti (primi 10): " + "; ".join(unknown[:10]))

    if dry:
        for r in out_rows[:8]:
            gg = '' if r['giorni'] is None else f"~{r['giorni']}gg"
            print(f"  FUORI {r['n']:18} {r['t']:10} {r['tipo']:10} {gg:7} {r['rientro'][:55]}")
        return len(out_rows)

    import datetime
    prev = {}
    if AVAIL.exists():
        try:
            prev = json.loads(AVAIL.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            prev = {}
    payload = {
        "date": datetime.date.today().isoformat(),
        "source": "fantacalcio.it + pianetafanta.it",
        "gw": gw if gw is not None else prev.get("gw"),
        "out": out_rows if (out_html or pn_html) else prev.get("out", []),
        "lineup": lu_rows if lu_rows else prev.get("lineup", {}),
        "bench": ben_rows if ben_rows else prev.get("bench", {}),
        "modules": modules if modules else prev.get("modules", {}),
        "diffidati": diffidati if df_html else prev.get("diffidati", []),
        "squalificati": squalificati_fc if df_html else prev.get("squalificati", []),
    }
    AVAIL.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"scritto {AVAIL.name}: {len(payload['out'])} fuori · {len(payload['lineup'])} titolari con %"
          + (f" · {len(payload['diffidati'])} diffidati" if df_html else ""))

    if not no_build:
        subprocess.run([sys.executable, str(ROOT / "build.py")], check=True)
    return len(out_rows)


def main():
    ap = argparse.ArgumentParser(description="Indisponibili e probabili formazioni dentro l'app")
    ap.add_argument("--from-file", dest="from_file", help="file HTML locale")
    ap.add_argument("--kind", choices=["out", "lineup", "pianeta", "diffidati"], default="out",
                    help="che cosa contiene il file indicato con --from-file")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-build", action="store_true")
    args = ap.parse_args()

    if args.from_file:
        html = pathlib.Path(args.from_file).read_text(encoding="utf-8", errors="replace")
        run(out_html=html if args.kind == "out" else None,
            lu_html=html if args.kind == "lineup" else None,
            pn_html=html if args.kind == "pianeta" else None,
            df_html=html if args.kind == "diffidati" else None,
            dry=args.dry_run, no_build=args.no_build)
        return 0

    errors = []
    out_html = lu_html = pn_html = df_html = None
    try:
        out_html = fetch(PAGE_OUT)
        print("indisponibili: pagina scaricata")
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        errors.append(f"indisponibili: {e}")
        print(f"! indisponibili non disponibili: {e}")
    try:
        lu_html = fetch(PAGE_LU)
        print("probabili formazioni: pagina scaricata")
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        errors.append(f"probabili formazioni: {e}")
        print(f"! probabili formazioni non disponibili: {e}")

    try:
        pn_html = fetch(PAGE_PIANETA)
        print("indisponibili (pianetafanta): pagina scaricata")
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        errors.append(f"pianetafanta: {e}")
        print(f"! pianetafanta non disponibile: {e}")

    try:
        df_html = fetch(PAGE_DIFF)
        print("diffidati: pagina scaricata")
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        errors.append(f"diffidati: {e}")
        print(f"! pagina diffidati non disponibile: {e}")

    if not out_html and not lu_html and not pn_html and not df_html:
        print("nessuna pagina disponibile: non tocco niente")
        for e in errors:
            print("  -", e)
        return 0
    run(out_html=out_html, lu_html=lu_html, pn_html=pn_html, df_html=df_html,
        dry=args.dry_run, no_build=args.no_build)
    return 0


if __name__ == "__main__":
    sys.exit(main())
