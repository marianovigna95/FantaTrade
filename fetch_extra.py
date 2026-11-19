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


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return "".join(c for c in s if c.isalnum())


def club_of(name):
    n = norm(name)
    if n in CLUB_MAP:
        return CLUB_MAP[n]
    return str(name or "").strip()


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


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


# ---------------------------------------------------------------- matching
def _listone_parts(name):
    """'Konè M.' -> ('kone', 'm');  'Pulisic' -> ('pulisic', None);  'Kevin Carlos' -> ('kevincarlos', None)"""
    parts = str(name or "").strip().split()
    if not parts:
        return (None, None)
    if len(parts) >= 2 and re.fullmatch(r"[A-Za-zÀ-ÿ]\.?", parts[-1]):
        return (norm(" ".join(parts[:-1])), parts[-1][:1].lower())
    return (norm(" ".join(parts)), None)


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


def match_players(players, rows):
    """Abbina per cognome/iniziale + squadra. In caso di dubbio non abbina e lo segnala."""
    index, dupes = {}, set()
    for i, p in enumerate(players):
        surname, initial = _listone_parts(p.get("n"))
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
        for surname, initial in _source_keys(full):
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


def run(source, text=None, dry=False, no_build=False):
    players = json.loads(DATA.read_text(encoding="utf-8"))
    rows, label = [], source
    if source == "understat":
        rows = parse_understat(text if text is not None else fetch(UNDERSTAT_URL))
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
    DATA.write_text(json.dumps(players, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"aggiornati {rep['matched']} giocatori · campi: " + ", ".join(f"{k}={v}" for k, v in sorted(rep["fields"].items())))
    if not no_build:
        print("ricompilo fantatrade.html …")
        subprocess.run([sys.executable, str(ROOT / "build.py")], check=True)
    return rep["matched"]


def main():
    ap = argparse.ArgumentParser(description="Aggiorna xG e tiri in app/data.json, con fallback fra fonti")
    ap.add_argument("--source", choices=["understat", "fbref_csv"], default=None)
    ap.add_argument("--file", help="file locale da cui leggere (HTML Understat o CSV FBref)")
    ap.add_argument("--from-file", dest="from_file", help="scorciatoia: riconosce il tipo dal contenuto")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-build", action="store_true")
    args = ap.parse_args()

    if args.from_file or args.file:
        path = pathlib.Path(args.from_file or args.file)
        text = path.read_text(encoding="utf-8", errors="replace")
        src = args.source or ("understat" if "playersData" in text else "fbref_csv")
        run(src, text=text, dry=args.dry_run, no_build=args.no_build)
        return

    sources = [args.source] if args.source else ["understat"]
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
    print("nessuna fonte ha funzionato, i dati restano quelli di prima.")
    for e in errors:
        print("  -", e)
    sys.exit(0)          # non è un errore fatale: la build deve continuare


if __name__ == "__main__":
    main()
