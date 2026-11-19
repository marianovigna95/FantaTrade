#!/usr/bin/env python3
"""
fetch_consensus.py — la fantamedia vista da tre testate diverse, da FantaPazz.

Perché serve
-----------
La fantamedia che usiamo per i punti attesi arriva da una fonte sola. FantaPazz pubblica la
stessa statistica calcolata su tre "pagelle" diverse — FantaPazz, Gazzetta dello Sport e
Corriere dello Sport — per ogni giocatore. Da lì si ricava due cose che una fonte sola non può
dare:

  * il **consenso**: la mediana delle tre, meno esposta agli umori di una singola redazione;
  * la **divergenza**: quanto le tre testate sono distanti. Quando la differenza è alta il voto
    di quel giocatore è volatile (un 6,5 e un 7,5 sulla stessa partita), e vale la pena saperlo
    prima di pagarlo tanto in uno scambio.

Scrive `app/consensus.json`, che `build.py` incorpora nell'app. Se il sito è giù il file resta
quello della settimana prima.

Uso
---
    python3 fetch_consensus.py              # scarica, scrive app/consensus.json, ricompila
    python3 fetch_consensus.py --dry-run    # mostra gli abbinamenti, non scrive
    python3 fetch_consensus.py --from-file statistiche.html
"""
import argparse
import datetime
import json
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from fetch_avail import build_name_index, resolve_by_name  # riuso l'abbinamento dei nomi

OUT = ROOT / "app" / "consensus.json"
DATA = ROOT / "app" / "data.json"
URL = "https://www.fantapazz.com/fantacalcio/statistiche"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept-Language": "it-IT,it;q=0.9"}
# le tre testate, nell'ordine in cui compaiono le colonne
TESTATE = ("FantaPazz", "Gazzetta", "Corriere dello Sport")


def fetch(url):
    req = urllib.request.Request(url, headers=dict(UA, **{"Accept-Encoding": "gzip"}))
    with urllib.request.urlopen(req, timeout=40) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            import gzip
            raw = gzip.decompress(raw)
        return raw.decode("utf-8", "replace")


def fnum(x):
    try:
        v = float(str(x).replace(",", "."))
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def parse(html):
    """[{nome, ruolo, squadra, fm: [FantaPazz, Gazzetta, CdS], pres}]"""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    out = []
    for table in soup.select("table"):
        for tr in table.select("tr"):
            tds = [td.get_text(" ", strip=True) for td in tr.select("td")]
            if len(tds) < 14:
                continue
            ruolo = (tds[1] or "").strip().upper()[:1]
            if ruolo not in ("P", "D", "C", "A"):
                continue
            fm = [fnum(tds[5]), fnum(tds[7]), fnum(tds[9])]
            if not any(fm):
                continue
            out.append({"nome": tds[2].strip(), "ruolo": ruolo, "club": tds[4].strip(),
                        "fm": fm, "pres": fnum(tds[13])})
    return out


def run(html=None, dry=False, no_build=False):
    players = json.loads(DATA.read_text(encoding="utf-8"))
    bykey = build_name_index(players)
    rows = parse(html) if html else []
    print(f"righe lette da fantapazz: {len(rows)}")

    res, unknown = {}, []
    for r in rows:
        i = resolve_by_name(r["nome"], r["ruolo"], players, bykey)
        if i is None:
            unknown.append(f"{r['nome']} ({r['club'] or '?'})")
            continue
        vals = [v for v in r["fm"] if v is not None]
        if len(vals) < 2:
            continue
        vals_sorted = sorted(vals)
        med = vals_sorted[len(vals_sorted) // 2] if len(vals_sorted) % 2 else \
            (vals_sorted[len(vals_sorted) // 2 - 1] + vals_sorted[len(vals_sorted) // 2]) / 2
        res[str(players[i]["sid"])] = {
            "fm": [round(v, 2) if v is not None else None for v in r["fm"]],
            "med": round(med, 2),
            "spread": round(max(vals) - min(vals), 2),
            "pres": int(r["pres"]) if r["pres"] else 0,
            "n": players[i]["n"],
        }

    print(f"abbinati: {len(res)} · non riconosciuti {len(unknown)}"
          + (" · primi: " + "; ".join(unknown[:8]) if unknown else ""))
    if dry:
        for k, v in list(res.items())[:8]:
            print(f"  {v['n']:18} fm {v['fm']} → mediana {v['med']} (±{v['spread']})")
        return len(res)

    payload = {"date": datetime.date.today().isoformat(),
               "source": "fantapazz.com",
               "testate": list(TESTATE),
               "players": res}
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"scritto {OUT.name}: {len(res)} giocatori con tre fantamedie")

    if not no_build:
        subprocess.run([sys.executable, str(ROOT / "build.py")], check=True)
    return len(res)


def main():
    ap = argparse.ArgumentParser(description="Fantamedia secondo tre testate (FantaPazz)")
    ap.add_argument("--from-file", dest="from_file")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-build", action="store_true")
    args = ap.parse_args()

    if args.from_file:
        run(pathlib.Path(args.from_file).read_text(encoding="utf-8", errors="replace"),
            dry=args.dry_run, no_build=args.no_build)
        return 0

    try:
        html = fetch(URL)
        print("fantapazz: pagina scaricata")
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        print(f"! fantapazz non disponibile ({e}): tengo i dati della settimana prima")
        return 0
    run(html, dry=args.dry_run, no_build=args.no_build)
    return 0


if __name__ == "__main__":
    sys.exit(main())
