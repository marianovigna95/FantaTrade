#!/usr/bin/env python3
"""
verifica_leghe.py — controlla che le rose incorporate nell'app siano davvero quelle della lega.

Serve a rispondere alla domanda "i crediti sono giusti?" con dei numeri, invece che a occhio.
Confronta `app/leagues.json` (quello che l'app usa) con gli export CSV di Fantacalcio.it
(quello che dice il sito) e stampa, squadra per squadra:

  · giocatori e crediti identici all'export? (uno per uno, per id ufficiale)
  · quanto ha speso ogni squadra, quanto le resta, se ha speso più del budget
  · se le posizioni salvate nel listone puntano ancora ai giocatori giusti: se un giorno
    `data.json` viene riordinato, i prezzi finirebbero sui giocatori sbagliati e questo
    controllo lo dice subito.

Uso:
  python3 verifica_leghe.py                       # cerca uploads/*_rosters_*.csv
  python3 verifica_leghe.py file1.csv file2.csv   # CSV specifici
  python3 verifica_leghe.py --quiet               # solo gli errori

Esce con codice 1 se trova qualcosa che non torna.
"""
import argparse, csv, json, pathlib, sys, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent
APP = ROOT / "app"


def squash(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return "".join(ch for ch in s.lower() if ch.isalnum())


def read_rosters(path):
    """{squadra: [(sid, crediti), ...]} — righe `Squadra,id,crediti`."""
    teams = {}
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.reader(f):
            if not row or len(row) < 2 or not row[1].strip().isdigit():
                continue
            team = row[0].strip()
            if not team or team == "$":
                continue
            sid = int(row[1])
            try:
                price = int(float(row[2])) if row[2].strip() not in ("", "-") else 0
            except (ValueError, IndexError):
                price = 0
            teams.setdefault(team, []).append((sid, price))
    return teams


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", nargs="*")
    ap.add_argument("--quiet", action="store_true", help="stampa solo i problemi")
    args = ap.parse_args()

    paths = [pathlib.Path(p) for p in args.csv] or \
        sorted(ROOT.glob("uploads/*_rosters_*.csv")) or sorted(ROOT.glob("*_rosters_*.csv"))
    if not paths:
        print("nessun export trovato (cerca uploads/*_rosters_*.csv)", file=sys.stderr)
        return 2

    data = json.load(open(APP / "data.json"))
    by_sid = {p["sid"]: i for i, p in enumerate(data) if p.get("sid")}
    leagues = json.load(open(APP / "leagues.json")) if (APP / "leagues.json").exists() else []

    problems = 0
    for path in paths:
        truth = read_rosters(path)
        if not truth:
            print(f"! {path.name}: nessuna riga valida", file=sys.stderr)
            continue
        # a quale lega corrisponde questo export?
        tag = squash(path.name.split("_rosters")[0].strip("'\" "))
        league = next((L for L in leagues if tag and (squash(L["name"]) in tag or tag in squash(L["name"]))), None)
        print(f"\n=== {path.name}")
        if league is None:
            print(f"  ! nessuna lega incorporata che corrisponda a «{tag}»")
            problems += 1
            continue
        budget = league.get("budget") or 0
        print(f"  lega «{league['name']}» · budget {budget} cr · {len(league['teams'])} squadre")

        for t in league["teams"]:
            rows = truth.get(t["name"])
            if rows is None:                       # nomi che differiscono per maiuscole/accenti
                k = squash(t["name"])
                rows = next((v for n, v in truth.items() if squash(n) == k), None)
            if rows is None:
                print(f"  ! {t['name']}: non è nell'export")
                problems += 1
                continue

            # 1. i giocatori sono gli stessi, uno per uno?
            app_names = [data[i]["n"] if 0 <= i < len(data) else f"(posizione {i} vuota)"
                         for i in t.get("players", [])]
            true_names = [data[by_sid[s]]["n"] if s in by_sid else f"(id {s} non nel listone)"
                          for s, _ in rows]
            drift = [(a, b) for a, b in zip(app_names, true_names) if a != b]
            if len(app_names) != len(true_names):
                drift.append((f"{len(app_names)} giocatori", f"{len(true_names)} nell'export"))

            # 2. i crediti sono quelli giusti, sul giocatore giusto?
            paid = {int(k2): v for k2, v in (t.get("paid") or {}).items()}
            cr_bad = []
            for (sid, price), name in zip(rows, true_names):
                idx = by_sid.get(sid)
                if idx is None:
                    continue
                got = paid.get(idx, 0)
                if got != price:
                    cr_bad.append((name, price, got))

            spent_app = sum(paid.values())
            spent_csv = sum(p for _, p in rows)
            residuo = budget - spent_csv
            flag = ""
            if spent_csv > budget + 1:
                flag = "  ⚠ speso più del budget"
            if not args.quiet or drift or cr_bad:
                print(f"  {t['name'][:24]:24} {len(rows):2} giocatori · speso {spent_csv:4} · "
                      f"restano {residuo:4}{flag}")
            if drift:
                problems += 1
                print(f"     ! {len(drift)} giocatori non corrispondono all'export (posizioni del listone cambiate?)")
                for a, b in drift[:5]:
                    print(f"       nell'app: {a:22} · nell'export: {b}")
            if cr_bad:
                problems += 1
                print(f"     ! {len(cr_bad)} crediti diversi:")
                for n, exp, got in cr_bad[:5]:
                    print(f"       {n:22} export {exp:3} · app {got:3}")
            if spent_app != spent_csv and not args.quiet:
                print(f"     · spesa totale: app {spent_app}, export {spent_csv}")

    print()
    if problems:
        print(f"PROBLEMI TROVATI: {problems}")
        return 1
    print("tutto coerente: giocatori, crediti e spese corrispondono agli export.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
