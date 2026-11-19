#!/usr/bin/env python3
"""
import_crediti.py — scrive in app/leagues.json i crediti che restano davvero a ogni squadra.

Perché serve: su Fantacalcio.it i crediti viaggiano insieme ai giocatori, quindi dopo uno
scambio "budget meno la somma dei prezzi delle rose" non è più il residuo vero (è così che
una squadra arriva a 1188 su un budget di 1000). Il file delle rose non contiene i residui:
o li leggi sul sito e li scrivi qui una volta, o l'app resta sulla stima.

Uso:
  1. riempi la colonna "crediti_residui_veri" di crediti-residui.csv con i numeri che leggi
     su Fantacalcio.it (lascia vuota la riga di chi non vuoi toccare: resta la stima)
  2. python3 import_crediti.py                 # aggiorna app/leagues.json
     python3 import_crediti.py --rebuild       # e ricompila fantatrade.html
  3. per tornare alla stima automatica: python3 import_crediti.py --reset

Il valore scritto viene salvato come `credits` della squadra: l'app lo usa al posto del
calcolo e lo mostra senza il segno ⚠.
"""
import argparse, csv, json, pathlib, subprocess, sys, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent
APP = ROOT / "app"
CSV_DEFAULT = ROOT / "crediti-residui.csv"


def squash(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return "".join(ch for ch in s.lower() if ch.isalnum())


def load_rows(path):
    rows = []
    with open(path, encoding="utf-8-sig") as f:
        rd = csv.DictReader(f)
        for r in rd:
            val = (r.get("crediti_residui_veri") or "").strip().replace(".", "").replace(",", "")
            if not val:
                continue
            try:
                rows.append((r.get("lega", "").strip(), r.get("squadra", "").strip(), int(float(val))))
            except ValueError:
                print(f"  ! valore non numerico per {r.get('squadra')}: {val!r}", file=sys.stderr)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", nargs="?", default=str(CSV_DEFAULT))
    ap.add_argument("--reset", action="store_true", help="torna alla stima automatica (budget meno spesa)")
    ap.add_argument("--rebuild", action="store_true")
    args = ap.parse_args()

    path = pathlib.Path(args.csv)
    leagues = json.load(open(APP / "leagues.json"))

    if args.reset:
        n = 0
        for lg in leagues:
            for t in lg["teams"]:
                if "credits" in t:
                    del t["credits"]
                    n += 1
        print(f"crediti dichiarati rimossi da {n} squadre: si torna alla stima")
    else:
        if not path.exists():
            print(f"! {path} non esiste: crealo con python3 verifica_leghe.py --template", file=sys.stderr)
            return 2
        rows = load_rows(path)
        if not rows:
            print("nessun valore compilato in", path.name, "— niente da fare")
            return 0
        settati, mancanti = 0, []
        for lega, squadra, cr in rows:
            found = False
            for lg in leagues:
                if lega and squash(lega) not in squash(lg["name"]) and squash(lg["name"]) not in squash(lega):
                    continue
                for t in lg["teams"]:
                    if squash(t["name"]) == squash(squadra):
                        t["credits"] = max(0, cr)
                        settati += 1
                        found = True
                        print(f"  {squadra[:24]:24} -> {cr} cr")
            if not found:
                mancanti.append(f"{lega}/{squadra}")
        if mancanti:
            print("  ! non trovate:", ", ".join(mancanti), file=sys.stderr)
        print(f"aggiornate {settati} squadre")

    # controllo di conservazione: se i crediti passano solo da una squadra all'altra negli
    # scambi, allora (prezzi delle rose + crediti residui) deve dare squadre × budget.
    # Se non torna, c'è un numero digitato male o un prezzo mancante nell'export.
    print()
    for lg in leagues:
        budget = lg.get("budget") or 0
        n = len(lg["teams"])
        tot_paid = sum(sum((t.get("paid") or {}).values()) for t in lg["teams"])
        tot_res = 0
        noti = 0
        for t in lg["teams"]:
            if isinstance(t.get("credits"), int):
                tot_res += t["credits"]
                noti += 1
            else:
                tot_res += max(0, budget - sum((t.get("paid") or {}).values()))
        atteso = budget * n
        delta = tot_paid + tot_res - atteso
        stato = "ok" if abs(delta) <= 5 else f"! differenza {delta:+d} cr"
        print(f"  {lg['name']}: prezzi {tot_paid} + residui {tot_res} = {tot_paid + tot_res} "
              f"su {atteso} attesi ({noti}/{n} dichiarati) -> {stato}")
        if abs(delta) > 5:
            print(f"     nei crediti non torna: qualche numero è digitato male o un prezzo manca nell'export")

    (APP / "leagues.json").write_text(json.dumps(leagues, ensure_ascii=False, indent=0))
    print("scritto app/leagues.json")

    if args.rebuild:
        subprocess.run([sys.executable, str(ROOT / "build.py")], check=False)
    else:
        print("ricorda: python3 build.py per aggiornare fantatrade.html e dist/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
