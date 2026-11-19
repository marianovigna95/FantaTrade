#!/usr/bin/env python3
"""
import_fantacalcio.py — importa gli export CSV di Fantacalcio.it (rose delle leghe)
e li converte in app/leagues.json, il file che l'app incorpora.

Come ottenerli: su Fantacalcio.it, nella tua lega, "Esporta rose" (o il download di fine asta).
Sono file tipo `fantalegafamily_rosters_1794939392131.csv` con righe `Squadra,ID_giocatore,crediti`.

L'ID è quello ufficiale di Fantacalcio.it, lo stesso salvato in data.json: l'abbinamento è esatto,
non serve confrontare i nomi.

Uso:
  python3 import_fantacalcio.py uploads/*_rosters_*.csv      # scrive app/leagues.json
  python3 import_fantacalcio.py uploads/*_rosters_*.csv --rebuild   # e ricompila l'app
"""
import argparse, csv, json, math, pathlib, statistics, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent
APP = ROOT / "app"
PRICE_K = 1.5          # valore di riferimento quando il prezzo reale non si conosce


def parse_rosters(path):
    """righe (squadra, id, crediti) dell'export rose."""
    rows = []
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.reader(f):
            if not row or row[0].strip() in ("$", "", "#"):
                continue
            if len(row) < 2 or not row[1].strip().isdigit():
                continue
            team = row[0].strip()
            pid = int(row[1])
            try:
                price = int(float(row[2])) if len(row) > 2 and row[2].strip() not in ("", "-") else 0
            except ValueError:
                price = 0
            rows.append((team, pid, price))
    return rows


def league_name(path):
    stem = pathlib.Path(path).stem.strip("'\" ")
    for sep in ("_rosters", "_asta", "_fantaasta"):
        if sep in stem:
            stem = stem.split(sep)[0]
    return stem.replace("_", " ").replace("-", " ").strip().title() or "Lega"


def build(csv_paths):
    data = json.load(open(APP / "data.json"))
    by_sid = {p["sid"]: i for i, p in enumerate(data) if p.get("sid")}
    print(f"database: {len(data)} giocatori, {len(by_sid)} con id ufficiale")

    leagues = []
    for path in csv_paths:
        rows = parse_rosters(path)
        if not rows:
            print(f"  ! {path}: nessuna riga valida", file=sys.stderr)
            continue

        teams, order, unknown, paid_total, model_total = {}, [], [], 0, 0.0
        for team, pid, price in rows:
            idx = by_sid.get(pid)
            if idx is None:
                unknown.append(pid)
                continue
            if team not in teams:
                # players/paid sono posizioni nel listone (comode per l'app), sids/paidSid
                # sono gli id ufficiali: se un giorno data.json cambia ordine, l'app rimappa
                # dalle rose per id invece di fidarsi delle posizioni
                teams[team] = {"name": team, "players": [], "sids": [], "paid": {}, "paidSid": {}}
                order.append(team)
            if idx not in teams[team]["players"]:
                teams[team]["players"].append(idx)
                teams[team]["sids"].append(pid)
            if price:
                teams[team]["paid"][idx] = price
                teams[team]["paidSid"][str(pid)] = price
                paid_total += price
                model_total += max(1.0, (data[idx].get("qa") or 1) * PRICE_K)

        # moltiplicatore della lega: serve a dare un valore in crediti "locali" anche ai
        # giocatori che nella lega non ci sono (svincolati), restando sulla stessa scala
        k = round(paid_total / model_total, 2) if model_total else PRICE_K
        k = max(1.0, min(12.0, k))

        team_list = [teams[t] for t in order]
        # budget d'asta stimato: la spesa mediana arrotondata per eccesso a 250 (min 500).
        # Serve solo a sapere quanti crediti restano a ogni squadra per i conguagli: si può
        # correggere a mano nella scheda Lega.
        median_spend = statistics.median([sum(t["paid"].values()) for t in team_list]) if team_list else 0
        budget = max(500, int(math.ceil(median_spend / 250.0)) * 250)
        leagues.append({"name": league_name(path), "k": k, "budget": budget,
                        "teams": team_list})
        print(f"  {league_name(path)}: {len(team_list)} squadre, "
              f"{sum(len(t['players']) for t in team_list)} giocatori, "
              f"spesa mediana {median_spend:.0f} cr, budget stimato {budget}, k={k}")
        if unknown:
            print(f"    ! {len(unknown)} id non presenti in data.json: {unknown[:8]}")

    (APP / "leagues.json").write_text(json.dumps(leagues, ensure_ascii=False, indent=0))
    print(f"scritto app/leagues.json ({len(leagues)} leghe)")
    return leagues


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", nargs="+", help="export rose di Fantacalcio.it")
    ap.add_argument("--rebuild", action="store_true", help="ricompila fantatrade.html dopo l'import")
    ap.add_argument("--mine", action="append", default=[], metavar="LEGA=SQUADRA",
                    help="quale squadra è la tua, es. --mine 'fantalegafamily=la magica de bobby'")
    args = ap.parse_args()
    paths = [p for pattern in args.csv for p in sorted(pathlib.Path().glob(pattern))] or \
            [pathlib.Path(p) for p in args.csv]
    leagues = build(paths)

    # segno qual è la mia squadra in ogni lega
    for spec in args.mine:
        if "=" not in spec:
            continue
        lega, team = [x.strip().lower() for x in spec.split("=", 1)]
        for L in leagues:
            squash = lambda x: "".join(ch for ch in x.lower() if ch.isalnum())
            if squash(lega) not in squash(L["name"]):
                continue
            found = False
            for t in L["teams"]:
                t["me"] = t["name"].strip().lower() == team
                found = found or t["me"]
            print(("  la mia squadra in %s: %s" % (L["name"], team)) if found
                  else ("  ! squadra '%s' non trovata in %s" % (team, L["name"])))
    (APP / "leagues.json").write_text(json.dumps(leagues, ensure_ascii=False, indent=0))
    if args.rebuild:
        subprocess.run([sys.executable, str(ROOT / "build.py")], check=True)


if __name__ == "__main__":
    main()
