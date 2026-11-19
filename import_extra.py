#!/usr/bin/env python3
"""
import_extra.py — carica i dati avanzati (xG, tiri, storico infortuni) dentro app/data.json.

Perché esiste
-------------
I dati che il listone ufficiale non ha — gol attesi (xG), tiri, tiri in porta, storico
infortuni — arrivano da fonti diverse (Understat, FBref, Transfermarkt, i tuoi appunti).
Questo script è il punto di ingresso unico: qualunque fonte usi, se produci un CSV o un JSON
con le colonne giuste, FantaTrade lo legge.

Il modello (app/model.js) usa questi campi *solo se ci sono*: senza file, l'app funziona
esattamente come prima.

Formato accettato
-----------------
CSV (intestazione obbligatoria, colonne facoltative tranne l'identificativo):

    sid,nome,squadra,npxg,xg,shots,sot,inj_days,inj_episodes
    6372,,,2.6,3.0,18,7,42,2
    ,Konè M.,Roma,2.6,,18,7,,
    ,Konè M.,Roma,,,,,21,1        # riga di solo infortunio
    ,Konè M.,Roma,inj:21+14+7     # più episodi in una cella

JSON:
    {"players": [{"sid": 6372, "npxg": 2.6, "shots": 18, "sot": 7,
                  "inj": [{"days": 21, "type": "muscolare"}, {"days": 14}]}]}

Identificazione del giocatore
-----------------------------
1. `sid` (l'id Fantacalcio: è la chiave affidabile, la trovi in app/data.json);
2. altrimenti nome + squadra, confrontati senza accenti/maiuscole/punteggiatura.
Se un nome è ambiguo (due giocatori con lo stesso cognome nella stessa squadra), lo script
lo segnala e salta la riga: meglio un buco che un dato sul giocatore sbagliato.

Uso
---
    python3 import_extra.py dati.csv                 # importa e ricompila
    python3 import_extra.py dati.json --dry-run      # solo il report, non scrive
    python3 import_extra.py --reset                  # rimuove i campi avanzati
    python3 import_extra.py --report                 # chi ha già i dati
"""
import argparse
import csv
import json
import pathlib
import shutil
import subprocess
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "app" / "data.json"
BAK = ROOT / "app" / "data.extra-backup.json"
ADV_FIELDS = ("xg", "npxg", "shots", "sot", "inj", "injDays", "injEpisodes", "advSource")


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    return "".join(c for c in s if c.isalnum())


def num(v):
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def parse_inj_cell(v):
    """'21+14' oppure '21;14' -> [{'days':21},{'days':14}]"""
    if not v:
        return None
    parts = str(v).replace(",", "+").replace(";", "+").replace(" ", "+").split("+")
    out = []
    for p in parts:
        d = num(p)
        if d and d > 0:
            out.append({"days": d})
    return out or None


def load_rows(path):
    if path.suffix.lower() == ".json":
        doc = json.loads(path.read_text(encoding="utf-8"))
        return doc.get("players", doc) if isinstance(doc, dict) else doc
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def pick(row, *names):
    for n in names:
        if n in row and row[n] not in (None, ""):
            return row[n]
    return None


def build_index(players):
    by_sid, by_name = {}, {}
    for i, p in enumerate(players):
        if p.get("sid") is not None:
            by_sid[int(p["sid"])] = i
        key = (norm(p["n"]), norm(p["t"]))
        by_name.setdefault(key, []).append(i)
    return by_sid, by_name


def merge(players, rows):
    by_sid, by_name = build_index(players)
    report = {"matched": 0, "by_sid": 0, "by_name": 0, "ambiguous": [], "missing": [], "fields": {}}
    touched = set()
    for row in rows:
        idx = None
        sid = num(pick(row, "sid", "id", "player_id"))
        if sid is not None and int(sid) in by_sid:
            idx = by_sid[int(sid)]
            report["by_sid"] += 1
        else:
            nome = pick(row, "nome", "name", "player", "giocatore")
            squadra = pick(row, "squadra", "team", "club")
            if nome and squadra:
                cand = by_name.get((norm(nome), norm(squadra)), [])
                if len(cand) == 1:
                    idx = cand[0]
                    report["by_name"] += 1
                elif len(cand) > 1:
                    report["ambiguous"].append(f"{nome} ({squadra})")
                    continue
        if idx is None:
            report["missing"].append(f"{pick(row, 'nome', 'name') or sid or '?'} ({pick(row, 'squadra', 'team') or '?'})")
            continue
        p = players[idx]

        def put(key, val):
            if val is None:
                return
            p[key] = val
            report["fields"][key] = report["fields"].get(key, 0) + 1
            touched.add(idx)

        put("xg", num(pick(row, "xg")))
        put("npxg", num(pick(row, "npxg")))
        put("shots", num(pick(row, "shots", "tiri")))
        put("sot", num(pick(row, "sot", "tiri_in_porta")))

        inj = row.get("inj")
        if isinstance(inj, list):
            put("inj", inj)
        else:
            for k in ("inj_days", "injd", "giorni_fuori"):
                d = num(row.get(k))
                if d and d > 0:
                    put("injDays", d)
            for k in ("inj_episodes", "inje", "episodi"):
                e = num(row.get(k))
                if e is not None:
                    put("injEpisodes", e)
            cell = pick(row, "inj", "injur", "infortuni")
            parsed = parse_inj_cell(cell)
            if parsed:
                put("inj", parsed)
        if touched:
            report["matched"] += 1
    src = {}
    for i in touched:
        src[i] = True
    for i in src:
        players[i]["advSource"] = "import"
    return report


def reset(players):
    n = 0
    for p in players:
        for k in ADV_FIELDS:
            if k in p:
                p.pop(k, None)
                n += 1
    return n


def main():
    ap = argparse.ArgumentParser(description="Importa xG, tiri e storico infortuni in app/data.json")
    ap.add_argument("file", nargs="?", help="CSV o JSON con i dati avanzati")
    ap.add_argument("--dry-run", action="store_true", help="mostra il report senza scrivere")
    ap.add_argument("--reset", action="store_true", help="rimuove tutti i campi avanzati")
    ap.add_argument("--report", action="store_true", help="quanti giocatori hanno già i dati")
    ap.add_argument("--no-build", action="store_true", help="non ricompilare fantatrade.html")
    args = ap.parse_args()

    if not DATA.exists():
        sys.exit(f"manca {DATA}")
    players = json.loads(DATA.read_text(encoding="utf-8"))

    if args.report or (not args.file and not args.reset):
        adv = sum(1 for p in players if any(k in p for k in ADV_FIELDS))
        xg = sum(1 for p in players if p.get("xg") is not None or p.get("npxg") is not None)
        inj = sum(1 for p in players if p.get("inj") or p.get("injDays"))
        print(f"{len(players)} giocatori · {adv} con dati avanzati (xG {xg}, infortuni {inj})")
        print("Colonne attese in un CSV: sid, nome, squadra, npxg, xg, shots, sot, inj_days, inj_episodes")
        return

    if args.reset:
        n = reset(players)
        if args.dry_run:
            print(f"[dry-run] rimuoverei {n} campi avanzati")
            return
        BAK.write_text(json.dumps(players, ensure_ascii=False), encoding="utf-8")
        DATA.write_text(json.dumps(players, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"rimossi {n} campi avanzati")
    else:
        path = pathlib.Path(args.file)
        if not path.exists():
            sys.exit(f"file non trovato: {path}")
        rows = load_rows(path)
        rep = merge(players, rows)
        print(f"righe lette: {len(rows)} · giocatori aggiornati: {rep['matched']} "
              f"(sid {rep['by_sid']}, nome {rep['by_name']})")
        if rep["fields"]:
            print("campi scritti: " + ", ".join(f"{k}={v}" for k, v in sorted(rep["fields"].items())))
        if rep["ambiguous"]:
            print("!! ambigui, saltati: " + "; ".join(rep["ambiguous"][:10]))
        if rep["missing"]:
            print("!! non trovati: " + "; ".join(rep["missing"][:10]) +
                  (f" (+{len(rep['missing']) - 10})" if len(rep["missing"]) > 10 else ""))
        if args.dry_run:
            print("[dry-run] nessun file scritto")
            return
        if BAK.exists():
            BAK.unlink()
        shutil.copyfile(DATA, BAK)
        DATA.write_text(json.dumps(players, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"scritto {DATA.relative_to(ROOT)} (backup in {BAK.relative_to(ROOT)})")

    if args.no_build:
        return
    print("ricompilo fantatrade.html …")
    subprocess.run([sys.executable, str(ROOT / "build.py")], check=True)


if __name__ == "__main__":
    main()
