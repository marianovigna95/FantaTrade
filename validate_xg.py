#!/usr/bin/env python3
"""
validate_xg.py — verifica, con dati veri, se xG/90 prevede meglio di gol/90.

Come funziona
-------------
Il repository committa `app/data.json` a ogni aggiornamento settimanale: quelle versioni
sono una serie temporale gratuita. Lo script le rilegge da git e, per ogni coppia di
settimane (prima → dopo), calcola:

  * il dato disponibile *prima*:  xG/90 e gol/90 di ogni giocatore
  * il risultato *dopo*:          fantapunti per partita guadagnati nel frattempo
                                  (Δ(fm × presenze) / Δpresenze)

Poi misura quale dei due predittori spiega meglio quel risultato, e cerca il peso
migliore della miscela xG + gol. Nessun dato inventato, nessuna stima: solo quello che
il repository ha già registrato.

Uso
---
    python3 validate_xg.py                # storia del repository in cui sta lo script
    python3 validate_xg.py --repo /percorso --min-games 3
    python3 validate_xg.py --weeks 1      # solo coppie di settimane consecutive

Quando ci sono meno di 2 settimane di storico dice semplicemente che serve aspettare.
"""
import argparse
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent


def git(repo, *args):
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if r.returncode != 0:
        return ""
    return r.stdout


def snapshots(repo):
    """[(data, {nome|squadra: giocatore})] dal più vecchio al più recente."""
    out = git(repo, "log", "--format=%H|%cI", "--", "app/data.json").strip().splitlines()
    snaps = []
    for line in reversed(out):                     # dal più vecchio
        if "|" not in line:
            continue
        sha, date = line.split("|", 1)
        raw = git(repo, "show", f"{sha}:app/data.json")
        if not raw.strip():
            continue
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        snaps.append((date[:10], {f"{p.get('n')}|{p.get('t')}": p for p in data if p.get("n")}))
    return snaps


def rate(v, minutes):
    return (v / (minutes / 90.0)) if (v is not None and minutes and minutes > 0) else None


def corr(xs, ys):
    n = len(xs)
    if n < 5:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = sum((x - mx) ** 2 for x in xs) ** 0.5
    dy = sum((y - my) ** 2 for y in ys) ** 0.5
    return num / (dx * dy) if dx and dy else None


def zscores(values):
    n = len(values)
    m = sum(values) / n
    sd = (sum((v - m) ** 2 for v in values) / n) ** 0.5 or 1.0
    return [(v - m) / sd for v in values]


def build_pairs(snaps, min_games):
    """Righe (xG/90 prima, gol/90 prima, punti per partita nell'intervallo)."""
    pairs = []
    for (d1, a), (d2, b) in zip(snaps, snaps[1:]):
        for key, p in a.items():
            q = b.get(key)
            if not q:
                continue
            pres1, pres2 = p.get("pres") or 0, q.get("pres") or 0
            gained = pres2 - pres1
            if gained < min_games:
                continue
            min1, min2 = p.get("min") or 0, q.get("min") or 0
            if min1 < 180 or min2 <= min1:
                continue
            fm1, fm2 = p.get("fm"), q.get("fm")
            if fm1 is None or fm2 is None:
                continue
            target = (fm2 * pres2 - fm1 * pres1) / gained
            xg90 = rate(p.get("xg"), min1)
            g90 = rate(p.get("gol"), min1)
            if xg90 is None or g90 is None:
                continue
            pairs.append({"da": d1, "a": d2, "n": p.get("n"), "t": p.get("t"),
                          "xg90": xg90, "g90": g90, "target": target, "gained": gained})
    return pairs


def main():
    ap = argparse.ArgumentParser(description="xG/90 batte gol/90? Verifica sui dati realmente registrati")
    ap.add_argument("--repo", default=str(ROOT), help="cartella del repository (default: quella dello script)")
    ap.add_argument("--min-games", type=int, default=2, help="partite minime per considerare l'intervallo")
    args = ap.parse_args()

    repo = pathlib.Path(args.repo)
    snaps = snapshots(repo)
    if len(snaps) < 2:
        print(f"storico insufficiente: {len(snaps)} versioni di app/data.json nel repository.")
        print("Servono almeno due aggiornamenti settimanali: torna fra qualche settimana.")
        print("Nel frattempo gli xG restano attivi con CFG.W_XG = 0,45 (valore prudente).")
        return 0

    pairs = build_pairs(snaps, args.min_games)
    per_player = {}
    for r in pairs:
        per_player[(r["n"], r["t"])] = r        # l'intervallo più recente vince
    rows = list(per_player.values())
    print(f"versioni di data.json: {len(snaps)} ({snaps[0][0]} → {snaps[-1][0]})")
    print(f"giocatori con un intervallo utile: {len(rows)}")
    if len(rows) < 30:
        print("campione troppo piccolo per una risposta affidabile (servono almeno 30 giocatori).")
        return 0

    xs = [r["xg90"] for r in rows]
    gs = [r["g90"] for r in rows]
    ys = [r["target"] for r in rows]
    c_xg, c_g = corr(xs, ys), corr(gs, ys)
    print(f"\ncorrelazione con i fantapunti successivi per partita:")
    print(f"  xG/90  : {c_xg:+.3f}")
    print(f"  gol/90 : {c_g:+.3f}")

    zn_xg, zn_g = zscores(xs), zscores(gs)
    best_w, best_c = None, None
    for i in range(0, 101, 5):
        w = i / 100
        c = corr([w * a + (1 - w) * b for a, b in zip(zn_xg, zn_g)], ys)
        if c is not None and (best_c is None or c > best_c):
            best_w, best_c = w, c
    print(f"\nmiscela migliore: {best_w:.2f}·xG/90 + {1 - best_w:.2f}·gol/90  → r = {best_c:+.3f}")

    print("\nverdetto:")
    if c_xg is None or c_g is None:
        print("  dati non sufficienti")
    elif c_xg > c_g + 0.05:
        print(f"  xG/90 batte gol/90 di {c_xg - c_g:+.2f}: CFG.W_XG = 0,45 è confermato (si può salire verso 0,6).")
    elif c_xg > c_g - 0.05:
        print("  i due predittori si equivalgono: tenere W_XG = 0,45 (miscela prudente) va bene.")
    else:
        print(f"  gol/90 batte xG/90 di {c_g - c_xg:+.2f}: abbassare CFG.W_XG (0,2-0,3) o azzerarlo.")
    print("\nnota: i fantapunti includono i bonus, quindi il confronto è onesto verso xG;")
    print("      ma il campione è di una stagione sola: usare come indicazione, non come certezza.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
