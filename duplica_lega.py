#!/usr/bin/env python3
"""
duplica_lega.py — copia una lega con un'altra "squadra mia".

Serve quando la stessa lega la usano due persone (per esempio tu e tuo figlio): le rose e i
crediti sono gli stessi, cambia solo quale squadra l'app considera "la tua". Ogni persona poi
sceglie la sua lega dal menu in alto (la scelta resta salvata nel browser di quel dispositivo).

Uso:
  python3 duplica_lega.py --lista                              # quali leghe e squadre ci sono
  python3 duplica_lega.py "Fantalegafamily" "Nome Squadra"      # crea la copia
  python3 duplica_lega.py "Fantalegafamily" "Nome Squadra" --nome "Fantalegafamily (figlio)"
  ... poi: python3 build.py
"""
import argparse, json, pathlib, sys, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent
APP = ROOT / "app"


def squash(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return "".join(ch for ch in s.lower() if ch.isalnum())


def find_league(leagues, name):
    for L in leagues:
        if squash(L["name"]) == squash(name) or squash(name) in squash(L["name"]):
            return L
    return None


def find_team(L, name):
    for t in L["teams"]:
        if squash(t["name"]) == squash(name) or squash(name) in squash(t["name"]):
            return t
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lega", nargs="?")
    ap.add_argument("squadra", nargs="?")
    ap.add_argument("--nome", help="nome della lega copiata (default: «<lega> (2)»)")
    ap.add_argument("--lista", action="store_true", help="mostra leghe e squadre")
    ap.add_argument("--rebuild", action="store_true")
    args = ap.parse_args()

    leagues = json.load(open(APP / "leagues.json"))

    if args.lista or not args.lega:
        for L in leagues:
            print(f"\n«{L['name']}» · budget {L.get('budget')} · {len(L['teams'])} squadre")
            for t in L["teams"]:
                print(f"   {'*' if t.get('me') else ' '} {t['name']}"
                      f"  ({len(t['players'])} giocatori, crediti {t.get('credits', 'stimati')})")
        print("\n* = la squadra segnata come «la mia»")
        return 0

    src = find_league(leagues, args.lega)
    if not src:
        print(f"! lega «{args.lega}» non trovata", file=sys.stderr)
        return 2
    team = find_team(src, args.squadra)
    if not team:
        print(f"! squadra «{args.squadra}» non trovata in «{src['name']}»", file=sys.stderr)
        print("  squadre:", ", ".join(t["name"] for t in src["teams"]), file=sys.stderr)
        return 2

    name = args.nome or (src["name"] + " (2)")
    if find_league(leagues, name):
        print(f"! esiste già una lega chiamata «{name}»: scegli un altro --nome", file=sys.stderr)
        return 2

    # copia profonda: rose, prezzi, crediti dichiarati e budget identici; cambia solo "me"
    copy = json.loads(json.dumps(src))
    copy["name"] = name
    for t in copy["teams"]:
        t.pop("me", None)
    for t in copy["teams"]:
        if squash(t["name"]) == squash(team["name"]):
            t["me"] = True

    leagues.append(copy)
    (APP / "leagues.json").write_text(json.dumps(leagues, ensure_ascii=False, indent=0))
    print(f"creata «{name}»: copia di «{src['name']}» con la squadra mia = {team['name']}")
    print(f"{len(copy['teams'])} squadre, crediti dichiarati: "
          f"{sum(1 for t in copy['teams'] if isinstance(t.get('credits'), int))}")

    if args.rebuild:
        import subprocess
        subprocess.run([sys.executable, str(ROOT / "build.py")], check=False)
    else:
        print("ricorda: python3 build.py per aggiornare fantatrade.html e dist/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
