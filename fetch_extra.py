#!/usr/bin/env python3
"""
fetch_extra.py — aggiorna da solo i dati avanzati (xG, tiri) dentro app/data.json.

Pensato per girare senza mani: prova in ordine le fonti disponibili, se una fallisce
passa alla successiva, se falliscono tutte **non tocca niente** e lo scrive nel log.
Non fa mai fallire la build.

Fonti (in ordine di tentativo)
------------------------------
1. `understat`   — una pagina per lega con tutti i giocatori (JSON dentro l'HTML)
2. `fbref_csv`   — CSV della tabella Shooting di FBref (locale o scaricato da te)
3. `file`        — un file che passi tu (HTML di Understat o CSV FBref), con --from-file

Uso
---
    python3 fetch_extra.py                     # prova le fonti online, poi ricompila
    python3 fetch_extra.py --dry-run            # mostra cosa farebbe
    python3 fetch_extra.py --from-file salvata.html
    python3 fetch_extra.py --source fbref_csv --file shooting.csv
    python3 fetch_extra.py --no-build

Gli infortuni NON sono qui: cambiano raramente e le fonti (Transfermarkt) bloccano gli
script. Restano un CSV da importare ogni tanto con import_extra.py (un comando, due volte
a stagione).
"""
import argparse
import codecs
import csv
import gzip
import io
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
from import_extra import DATA, load_rows, merge  # riuso la logica di merge già testata

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
                    "(KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      "Accept-Language": "it-IT,it;q=0.9,en;q=0.8"}
SEASON = 2026          # anno di inizio stagione (2026 = 2026/27)
UNDERSTAT_URL = "https://understat.com/league/Serie_A/" + str(SEASON)
REPORT = ROOT / "app" / "extra_report.txt"
SNAPSHOT = ROOT / "app" / "extra_snapshot.json"   # ultima copia buona dei dati avanzati

# FotMob: fonte alternativa quando Understat è giù. Endpoint pubblici, nessuna chiave.
FOTMOB_LEAGUE = "https://www.fotmob.com/api/data/leagues?id=55"   # 55 = Serie A
FOTMOB_DATA = "https://data.fotmob.com/"

# i nomi di squadra possono differire tra fonti
CLUB_MAP = {
    "internazionale": "Inter", "inter": "Inter", "hellas verona": "Verona", "verona": "Verona",
    "milan": "Milan", "ac milan": "Milan", "roma": "Roma", "as roma": "Roma", "lazio": "Lazio",
    "ss lazio": "Lazio", "juventus": "Juventus", "napoli": "Napoli", "atalanta": "Atalanta",
    "bologna": "Bologna", "cagliari": "Cagliari", "como": "Como", "fiorentina": "Fiorentina",
    "frosinone": "Frosinone", "genoa": "Genoa", "lecce": "Lecce", "monza": "Monza", "parma": "Parma",
    "sassuolo": "Sassuolo", "torino": "Torino", "udinese": "Udinese", "venezia": "Venezia",
    "cremonese": "Cremonese", "pisa": "Pisa", "sampdoria": "Sampdoria", "empoli": "Empoli",
}


TRANSLIT = str.maketrans({"ø": "o", "Ø": "O", "å": "a", "Å": "A", "æ": "ae", "Æ": "AE",
                        "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "ß": "ss", "ð": "d", "þ": "th",
                        "'": "", "’": ""})


def norm(s):
    s = str(s or "").translate(TRANSLIT)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return "".join(c for c in s if c.isalnum())


def club_of(name):
    n = norm(name)
    if n in CLUB_MAP:
        return CLUB_MAP[n]
    return str(name or "").strip()


def fetch(url):
    req = urllib.request.Request(url, headers=dict(UA, **{"Accept-Encoding": "gzip"}))
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return raw.decode("utf-8", "replace")


def fetch_json(url):
    return json.loads(fetch(url))


def parse_understat(html):
    """Estrae playersData dall'HTML di Understat → lista di righe nel formato di import_extra."""
    m = re.search(r"playersData\s*=\s*JSON\.parse\('(.+?)'\)", html, re.S)
    if not m:
        raise ValueError("playersData non trovato nella pagina (sito cambiato o pagina di errore?)")
    raw = m.group(1)
    try:
        js = json.loads(codecs.decode(raw, "unicode_escape"))
    except Exception:
        # le sequenze \xNN sono byte UTF-8: decodifico a mano
        fixed = codecs.decode(raw.encode("latin-1", "backslashreplace"), "unicode_escape")
        js = json.loads(fixed.encode("latin-1", "backslashreplace").decode("utf-8", "replace"))
    out = []
    for p in js:
        try:
            minutes = float(p.get("time") or 0)
        except (TypeError, ValueError):
            minutes = 0
        if minutes < 180:          # meno di due partite: i numeri non dicono nulla
            continue
        out.append({
            "nome": p.get("player_name"),
            "squadra": club_of(p.get("team_title")),
            "npxg": round(float(p.get("npxG") or 0), 2),
            "xg": round(float(p.get("xG") or 0), 2),
            "xa": round(float(p.get("xA") or 0), 2),
            "shots": int(float(p.get("shots") or 0)),
            "ass": int(float(p.get("assists") or 0)),
            "_min": minutes,
        })
    return out


def parse_fbref_csv(text):
    """CSV della tabella Shooting di FBref (export manuale). Colonne attese: Player, Squad, xG, npxG, Shots, SoT."""
    out = []
    rdr = csv.DictReader(io.StringIO(text))
    for row in rdr:
        nome = row.get("Player") or row.get("Giocatore")
        if not nome or row.get("Position") == "GK" and False:
            continue
        try:
            minuti = float((row.get("Min") or "0").replace(",", "") or 0)
        except ValueError:
            minuti = 0
        if minuti < 180:
            continue
        def f(k):
            v = row.get(k)
            try:
                return round(float(str(v).replace(",", "")) if v not in (None, "") else 0.0, 2)
            except ValueError:
                return 0.0
        out.append({
            "nome": re.sub(r"\s*\(.*?\)\s*", "", nome).strip(),
            "squadra": club_of((row.get("Squad") or "").split(",")[0]),
            "xg": f("xG"), "npxg": f("npxG"), "shots": int(f("Shots")), "sot": int(f("SoT")),
            "_min": minuti,
        })
    return out


def parse_fotmob(text=None):
    """FotMob (dati Opta): xG e xA totali, tiri e tiri in porta per 90.
    Restituisce righe nello stesso formato delle altre fonti (tiri convertiti in totali)."""
    league = json.loads(text) if text else fetch_json(FOTMOB_LEAGUE)
    links = (league.get("stats") or {}).get("seasonStatLinks") or []
    season = (league.get("details") or {}).get("selectedSeason")
    cur = next((l for l in links if l.get("Name") == season), links[0] if links else None)
    if not cur or not cur.get("RelativePath"):
        raise ValueError("FotMob: nessuna stagione con statistiche")
    tops = fetch_json(FOTMOB_DATA + cur["RelativePath"])
    urls = {t.get("StatName"): t.get("StatLocation") for t in (tops.get("TopLists") or []) if t.get("StatLocation")}
    if "expected_goals" not in urls:
        raise ValueError("FotMob: xG non disponibile per questa stagione")

    def stat_map(name):
        if name not in urls:
            return {}
        d = fetch_json(urls[name])
        out = {}
        for t in d.get("TopLists") or []:
            for r in t.get("StatList") or []:
                out[(r.get("ParticipantName"), r.get("TeamName"))] = r
        return out

    xg, xa = stat_map("expected_goals"), stat_map("expected_assists")
    sh, sot = stat_map("total_scoring_att"), stat_map("ontarget_scoring_att")
    out = []
    for key, r in xg.items():
        try:
            minutes = float(r.get("MinutesPlayed") or 0)
        except (TypeError, ValueError):
            minutes = 0
        if minutes < 180:
            continue
        m90 = minutes / 90.0

        def per90_per_game(m):
            v = (m.get(key) or {}).get("StatValue")
            try:
                return round(float(v) * m90, 1) if v is not None else None
            except (TypeError, ValueError):
                return None

        def total(m):
            v = (m.get(key) or {}).get("StatValue")
            try:
                return round(float(v), 2) if v is not None else None
            except (TypeError, ValueError):
                return None

        row = {
            "nome": r.get("ParticipantName"),
            "squadra": club_of(r.get("TeamName")),
            "xg": total(xg),
            "xa": total(xa),          # assist attesi: entrano nella proiezione dei bonus
            "shots": per90_per_game(sh),
            "sot": per90_per_game(sot),
            "_min": minutes,
        }
        out.append({k: v for k, v in row.items() if v is not None})
    if not out:
        raise ValueError("FotMob: nessun giocatore con almeno 180 minuti")
    return out


# ---------------------------------------------------------------- matching
def _listone_keys(name):
    """Chiavi (cognome, iniziale) di una voce del listone.
    'Konè M.' -> [('kone','m')] · 'Esposito F.P.' -> [('esposito','f')] · 'Traorè Hj.' -> [('traore','h')]
    'Pulisic' -> [('pulisic',None)] · 'Zambo Anguissa' -> [('zamboanguissa',None), ('anguissa',None)]"""
    parts = str(name or "").strip().split()
    if not parts:
        return []
    last = parts[-1]
    bare = last.replace(".", "")
    is_initial = len(parts) >= 2 and 1 <= len(bare) <= 3 and bare.isalpha() and (last.endswith(".") or len(bare) == 1)
    if is_initial:
        keys = [(norm(" ".join(parts[:-1])), bare[0].lower())]
        if len(parts) > 2:                      # 'De Roon' → anche solo la parte finale
            keys.append((norm(parts[-2]), bare[0].lower()))
        return keys
    keys = [(norm(" ".join(parts)), None)]
    if len(parts) >= 2:
        keys.append((norm(last), None))
    return keys


def _source_keys(full):
    """'Christian Pulisic' -> [('pulisic','c'), ('pulisic',None), ...]"""
    bits = str(full or "").strip().split()
    if not bits:
        return []
    if len(bits) == 1:
        return [(norm(bits[0]), None)]
    initial = bits[0][:1].lower()
    out = [(norm(bits[-1]), initial), (norm(" ".join(bits[1:])), initial),
           (norm(bits[-1]), None), (norm(" ".join(bits[1:])), None)]
    # nomi composti tipo "Kevin Carlos" (il listone li tiene interi)
    out.append((norm(full), None))
    return out


ALIAS = ROOT / "app" / "alias.json"


def load_aliases():
    """app/alias.json: {"Nome nella fonte": sid} per i casi che il matching non prende."""
    try:
        raw = json.loads(ALIAS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out = {}
    for k, v in (raw or {}).items():
        try:
            out[norm(k)] = int(v)
        except (TypeError, ValueError):
            continue
    return out


def match_players(players, rows):
    """Abbina per cognome/iniziale + squadra. In caso di dubbio non abbina e lo segnala."""
    index, dupes = {}, set()
    aliases = load_aliases()
    by_sid = {p.get("sid"): i for i, p in enumerate(players) if p.get("sid") is not None}
    for i, p in enumerate(players):
        for surname, initial in _listone_keys(p.get("n")):
            if not surname:
                continue
            for key in ((surname, initial, norm(p.get("t"))), (surname, None, norm(p.get("t")))):
                if key in index and index[key] != i:
                    dupes.add(key)
                index.setdefault(key, i)
    matched, unknown, ambiguous = [], [], []
    for r in rows:
        full = str(r.get("nome") or "").strip()
        if not full:
            continue
        club = norm(r.get("squadra"))
        hit = None
        alias = aliases.get(norm(full))                       # 1. alias esplicito
        if alias is not None and alias in by_sid:
            hit = by_sid[alias]
        for surname, initial in ([] if hit is not None else _source_keys(full)):
            for key in ((surname, initial, club), (surname, None, club)):
                if key in dupes:
                    hit = "amb"
                    break
                if key in index:
                    hit = index[key]
                    break
            if hit is not None:
                break
        if hit == "amb":
            ambiguous.append(f"{full} ({r.get('squadra')})")
            continue
        if hit is None:
            unknown.append(f"{full} ({r.get('squadra')})")
            continue
        rr = dict(r)
        rr["sid"] = players[hit].get("sid")
        rr["nome"] = players[hit].get("n")
        rr["squadra"] = players[hit].get("t")
        matched.append(rr)
    return matched, unknown + [a + " [ambiguo]" for a in ambiguous]


def save_snapshot(players):
    """Copia dei dati avanzati: se una settimana tutte le fonti sono giù, si riparte da qui."""
    rows = []
    for p in players:
        if not any(k in p for k in ("xg", "npxg", "inj", "injDays")):
            continue
        row = {"sid": p.get("sid"), "nome": p.get("n"), "squadra": p.get("t"),
               "advSource": p.get("advSource")}
        for k in ("xg", "npxg", "shots", "sot", "inj", "injDays", "injEpisodes"):
            if p.get(k) is not None:
                row[k] = p[k]
        rows.append(row)
    try:
        SNAPSHOT.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    except OSError:
        pass
    return len(rows)


def restore_snapshot(players):
    """Rimette i dati avanzati dall'ultima copia buona (refresh_data.py riscrive data.json da zero)."""
    if not SNAPSHOT.exists():
        return 0
    try:
        rows = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    if not rows:
        return 0
    rep = merge(players, rows)
    by = {p.get("sid"): p for p in players if p.get("sid") is not None}
    for r in rows:
        p = by.get(r.get("sid"))
        if p is not None and r.get("advSource"):
            p["advSource"] = r["advSource"]
    return rep["matched"]


def run(source, text=None, dry=False, no_build=False):
    players = json.loads(DATA.read_text(encoding="utf-8"))
    rows, label = [], source
    if source == "understat":
        rows = parse_understat(text if text is not None else fetch(UNDERSTAT_URL))
    elif source == "fotmob":
        rows = parse_fotmob(text)
    elif source == "fbref_csv":
        rows = parse_fbref_csv(text)
    else:
        raise SystemExit(f"fonte sconosciuta: {source}")

    matched, unknown = match_players(players, rows)
    print(f"fonte {label}: {len(rows)} giocatori con almeno 180 minuti · abbinati {len(matched)} · non riconosciuti {len(unknown)}")
    if unknown:
        print("  non riconosciuti (primi 10): " + "; ".join(unknown[:10]))
    REPORT.write_text(
        f"fonte: {label}\nabbinati: {len(matched)}\nnon riconosciuti: {len(unknown)}\n\n"
        + "\n".join(unknown), encoding="utf-8")
    if dry:
        print("[dry-run] non scrivo niente")
        return len(matched)
    rep = merge(players, matched)
    if not rep["matched"]:
        print("nessun giocatore aggiornato: lascio i dati com'erano")
        return 0
    for p in players:                      # traccio da dove arrivano i numeri
        if p.get("advSource"):
            p["advSource"] = label
    save_snapshot(players)
    DATA.write_text(json.dumps(players, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"aggiornati {rep['matched']} giocatori · campi: " + ", ".join(f"{k}={v}" for k, v in sorted(rep["fields"].items())))
    if not no_build:
        print("ricompilo fantatrade.html …")
        subprocess.run([sys.executable, str(ROOT / "build.py")], check=True)
    return rep["matched"]


def main():
    ap = argparse.ArgumentParser(description="Aggiorna xG e tiri in app/data.json, con fallback fra fonti")
    ap.add_argument("--source", choices=["understat", "fotmob", "fbref_csv"], default=None)
    ap.add_argument("--file", help="file locale da cui leggere (HTML Understat o CSV FBref)")
    ap.add_argument("--from-file", dest="from_file", help="scorciatoia: riconosce il tipo dal contenuto")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-build", action="store_true")
    args = ap.parse_args()

    if args.from_file or args.file:
        path = pathlib.Path(args.from_file or args.file)
        text = path.read_text(encoding="utf-8", errors="replace")
        if args.source:
            src = args.source
        elif "playersData" in text:
            src = "understat"
        elif "TopLists" in text or "seasonStatLinks" in text:
            src = "fotmob"
        else:
            src = "fbref_csv"
        run(src, text=text, dry=args.dry_run, no_build=args.no_build)
        return

    sources = [args.source] if args.source else ["understat", "fotmob"]
    errors = []
    for src in sources:
        try:
            n = run(src, dry=args.dry_run, no_build=args.no_build)
            if n:
                return
            errors.append(f"{src}: nessun abbinamento")
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, OSError) as e:
            errors.append(f"{src}: {e}")
            print(f"! {src} non disponibile: {e}")
    print("nessuna fonte online ha funzionato.")
    for e in errors:
        print("  -", e)
    # ultima rete di sicurezza: rimetto i dati avanzati dell'ultima settimana buona
    players = json.loads(DATA.read_text(encoding="utf-8"))
    n = restore_snapshot(players)
    if n and not args.dry_run:
        DATA.write_text(json.dumps(players, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"ripristinati {n} giocatori dall'ultima copia buona (app/extra_snapshot.json)")
        if not args.no_build:
            subprocess.run([sys.executable, str(ROOT / "build.py")], check=True)
    else:
        print("nessuna copia da ripristinare: i dati restano quelli di prima")
    sys.exit(0)          # non è un errore fatale: la build deve continuare


if __name__ == "__main__":
    main()
