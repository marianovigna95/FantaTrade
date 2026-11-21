#!/usr/bin/env python3
"""
aggiungi_lega.py — aggiunge UNA lega nuova a app/leagues.json senza toccare le altre.

`import_fantacalcio.py` ricostruisce il file da zero: comodo la prima volta, disastroso dopo,
perché butterebbe via le leghe già presenti e i crediti residui che hai scritto a mano.
Questo script importa un singolo export rose e lo accoda.

Uso:
  python3 aggiungi_lega.py uploads/premier-pianto-2016_rosters_*.csv
  python3 aggiungi_lega.py file.csv --nome "Premier Pianto 2016" --mine "WESTON VILLA" --rebuild
"""
import argparse, csv, json, math, pathlib, statistics, subprocess, sys, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent
APP = ROOT / "app"
PRICE_K = 1.5


def squash(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return "".join(ch for ch in s.lower() if ch.isalnum())


def league_name(path):
    stem = pathlib.Path(path).stem.strip("'\" ")
    for sep in ("_rosters", "_asta", "_fantaasta"):
        if sep in stem:
            stem = stem.split(sep)[0]
    return stem.replace("_", " ").replace("-", " ").strip().title() or "Lega"


def build(path, data, by_sid):
    rows = []
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.reader(f):
            if not row or len(row) < 2 or not row[1].strip().isdigit():
                continue
            team = row[0].strip()
            if not team or team == "$":
                continue
            try:
                price = int(float(row[2])) if row[2].strip() not in ("", "-") else 0
            except (ValueError, IndexError):
                price = 0
            rows.append((team, int(row[1]), price))

    teams, order, unknown = {}, [], []
    paid_total, model_total = 0, 0.0
    for team, pid, price in rows:
        idx = by_sid.get(pid)
        if idx is None:
            unknown.append(pid)
            continue
        if team not in teams:
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

    team_list = [teams[t] for t in order]
    k = round(paid_total / model_total, 2) if model_total else PRICE_K
    k = max(1.0, min(12.0, k))
    med = statistics.median([sum(t["paid"].values()) for t in team_list]) if team_list else 0
    budget = max(500, int(math.ceil(med / 250.0)) * 250)
    return {"name": league_name(path), "k": k, "budget": budget, "teams": team_list}, unknown


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--nome")
    ap.add_argument("--mine", help="quale squadra è la tua")
    ap.add_argument("--rebuild", action="store_true")
    args = ap.parse_args()

    data = json.load(open(APP / "data.json"))
    by_sid = {p["sid"]: i for i, p in enumerate(data) if p.get("sid")}
    leagues = json.load(open(APP / "leagues.json")) if (APP / "leagues.json").exists() else []

    new, unknown = build(args.csv, data, by_sid)
    if not new["teams"]:
        print("! nessun giocatore riconosciuto", file=sys.stderr)
        return 2

    name = args.nome or new["name"]
    if any(squash(L["name"]) == squash(name) for L in leagues):
        print(f"! esiste già una lega «{name}»: usa --nome per chiamarla diversamente", file=sys.stderr)
        return 2
    new["name"] = name

    if args.mine:
        hit = [t for t in new["teams"] if squash(t["name"]) == squash(args.mine)]
        if not hit:
            hit = [t for t in new["teams"] if squash(args.mine) in squash(t["name"])]
        if not hit:
            print(f"! squadra «{args.mine}» non trovata. Squadre:", file=sys.stderr)
            print("  " + ", ".join(t["name"] for t in new["teams"]), file=sys.stderr)
            return 2
        hit[0]["me"] = True

    leagues.append(new)
    (APP / "leagues.json").write_text(json.dumps(leagues, ensure_ascii=False, indent=0))

    print(f"aggiunta «{name}» · budget {new['budget']} · k {new['k']} · "
          f"{len(new['teams'])} squadre · {sum(len(t['players']) for t in new['teams'])} giocatori")
    if unknown:
        print(f"  ! {len(unknown)} id non presenti nel listone: {unknown[:8]}", file=sys.stderr)
    for t in new["teams"]:
        speso = sum(t["paid"].values())
        flag = "  ⚠ sopra il budget" if speso > new["budget"] + 1 else ""
        print(f"   {'*' if t.get('me') else ' '} {t['name'][:24]:24} speso {speso:4} · "
              f"restano {new['budget'] - speso:4}{flag}")
    print(f"leghe ora nel file: {', '.join(L['name'] for L in leagues)}")

    if args.rebuild:
        subprocess.run([sys.executable, str(ROOT / "build.py")], check=False)
    else:
        print("ricorda: python3 build.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
