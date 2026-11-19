#!/usr/bin/env python3
"""
refresh_data.py — aggiorna il database giocatori di FantaTrade e ricompila l'app.

Cosa fa:
  1. scarica il listone ufficiale 2026/27 da Fantacalcio.it (ruolo classico, squadra, quotazione iniziale QI,
     quotazione attuale QA, FVM, id giocatore): ~600 giocatori, la fonte ufficiale delle quotazioni;
  2. scarica l'elenco giocatori + statistiche della stagione in corso (presenze, titolarità, minuti, gol,
     assist, fantamedia) per i giocatori rilevanti (prezzo atteso >= soglia);
  3. incrocia le due fonti per nome e cognome;
  4. scrive app/data.json, allinea il parametro "giornate giocate" nel modello e ricompila fantatrade.html.

Il prezzo di riferimento usato dal modello ("a", in crediti d'asta) e' la quotazione ufficiale QA
moltiplicata per PRICE_K: cosi' i giocatori senza statistiche hanno comunque un valore, e le
soglie in crediti dei consigli restano sulla stessa scala di prima.

Uso:
  python3 refresh_data.py                # aggiorna tutto e ricompila
  python3 refresh_data.py --min-price 4  # include anche i giocatori meno costosi
  python3 refresh_data.py --rebuild-only # ricompila senza riscaricare

Note: usa solo pagine pubbliche, con pause fra le richieste. Se un sito cambia struttura
lo script va adattato: i punti da toccare sono le funzioni parse_quotazioni() e parse_stats().
"""
import argparse, json, re, sys, time, unicodedata, pathlib, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from difflib import get_close_matches

try:
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Serve BeautifulSoup: pip install beautifulsoup4 lxml")

ROOT = pathlib.Path(__file__).resolve().parent
UA = {"User-Agent": "Mozilla/5.0 (compatible; FantaTrade/1.0; uso personale)"}
FC = "https://www.fantacalcio.it"
DEV = "https://fantacalcio.dev"
PRICE_K = 1.5          # crediti d'asta = quotazione ufficiale * PRICE_K
FC_CODES = {
    "ATA": "Atalanta", "BOL": "Bologna", "CAG": "Cagliari", "COM": "Como", "FIO": "Fiorentina",
    "FRO": "Frosinone", "GEN": "Genoa", "INT": "Inter", "JUV": "Juventus", "LAZ": "Lazio",
    "LEC": "Lecce", "MIL": "Milan", "MON": "Monza", "NAP": "Napoli", "PAR": "Parma",
    "ROM": "Roma", "SAS": "Sassuolo", "TOR": "Torino", "UDI": "Udinese", "VEN": "Venezia",
}
SEASON = "2026-27"
ROLES = ["P", "D", "C", "A"]

# nomi che il matching automatico non prende
MANUAL_SLUGS = {
    "Martinez Jo.": "/giocatori/josep-martinez",
    "Sanchez Ro.": "/giocatori/robert-sanchez",
    "N'Dicka": "/giocatori/ndicka",
    "Yildiz": "/giocatori/yildiz",
    "Boga": "/giocatori/boga",
}


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 404:  # pagina oltre l'ultima: fine elenco
                return ""
            if i == tries - 1:
                print(f"  ! errore su {url}: {e}", file=sys.stderr)
                return ""
            time.sleep(1.5 * (i + 1))
        except Exception as e:  # rete instabile: riprovo
            if i == tries - 1:
                print(f"  ! errore su {url}: {e}", file=sys.stderr)
                return ""
            time.sleep(1.5 * (i + 1))


def norm(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = s.replace("’", "'").replace("-", " ").replace(".", " ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


# ------------------------------------------------------- 1. listone ufficiale
def parse_quotazioni():
    """Listone ufficiale Fantacalcio.it: nome, ruolo classico, squadra, QI, QA, FVM, id."""
    html = get(f"{FC}/quotazioni-fantacalcio")
    soup = BeautifulSoup(html, "lxml")
    out, seen, rows = [], set(), soup.select("tr.player-row")

    def cell(tr, key):
        el = tr.select_one(f'[data-col-key="{key}"]')
        try:
            return int(el.get_text(strip=True))
        except (AttributeError, ValueError):
            return None

    for tr in rows:
        a = tr.select_one(".player-name a")
        if not a:
            continue
        name = a.get_text(" ", strip=True).replace("\u2019", "'")
        role_el = tr.select_one(".player-role-classic .role")
        role = (role_el.get("data-value") if role_el else "").upper()
        squad = tr.select_one('[data-col-key="sq"]')
        code = squad.get_text(strip=True).upper() if squad else ""
        if not name or role not in ROLES or code not in FC_CODES or (name, role) in seen:
            continue
        seen.add((name, role))
        pid = re.search(r"/(\d+)$", a.get("href", "") or "")
        out.append({
            "n": name, "r": role, "t": FC_CODES[code], "code": code,
            "qi": cell(tr, "c_qi"), "qa": cell(tr, "c_qa"), "fvm": cell(tr, "c_fvm"),
            "sid": int(pid.group(1)) if pid else None,
        })

    # chi non ha QA (raro) usa la quotazione iniziale
    for p in out:
        if not p["qa"]:
            p["qa"] = p["qi"] or 1
    print(f"  listone ufficiale fantacalcio.it: {len(out)} giocatori")
    (ROOT / "data" / "listone_fc_raw.json").write_text(json.dumps(out, ensure_ascii=False, indent=0))
    return out


# ---------------------------------------------------------------- 2. elenco + slug
def dev_index():
    def one(args):
        role, page = args
        soup = BeautifulSoup(get(f"{DEV}/giocatori?role={role}&page={page}"), "lxml")
        rows = []
        for a in soup.select('a[href^="/giocatori/"]'):
            slug = a["href"]
            txt = a.get_text(" ", strip=True)
            if "?" in slug or "/stagione/" in slug or not txt or len(txt) > 40:
                continue
            rows.append({"r": role, "slug": slug, "name": txt})
        return rows

    jobs = [(r, p) for r in ROLES for p in range(1, 46)]
    out = {}
    with ThreadPoolExecutor(max_workers=10) as ex:
        for rows in ex.map(one, jobs):
            for row in rows:
                out.setdefault(row["slug"], row)
    print(f"  elenco statistiche: {len(out)} giocatori")
    return list(out.values())


def match_names(quot, dev):
    idx = {}
    for d in dev:
        d["toks"] = norm(d["name"]).split()
        for t in set(d["toks"]):
            idx.setdefault(t, []).append(d)

    def best_for(p):
        if p["n"] in MANUAL_SLUGS:
            return MANUAL_SLUGS[p["n"]]
        toks = norm(p["n"]).split()
        if not toks:
            return None
        ini = ""
        if len(toks) >= 2 and len(toks[-1]) == 1:
            ini, toks = toks[-1], toks[:-1]
        sur = toks[-1]
        cands = list(idx.get(sur, []))
        if not cands:
            for c in get_close_matches(sur, list(idx.keys()), n=4, cutoff=0.86):
                cands += idx[c]
        if not cands:
            return None

        def score(d):
            dt = d["toks"]
            s = 10 if sur in dt else 0
            if dt == toks:
                s += 8                       # nome identico a quello del listone ufficiale
            first = dt[0]
            if ini and first.startswith(ini) and len(first) > 1:
                s += 6
            elif ini and first == ini:
                s += 3
            # ruolo diverso: sospetto omonimo, ma se il nome e' identico le statistiche restano valide
            s += 4 if d["r"] == p["r"] else (-2 if dt == toks else -10)
            if len(dt) < len(toks):
                s -= 4                       # candidato piu' corto del nome cercato
            return s - abs(len(dt) - len(toks))

        ordered = sorted(cands, key=score, reverse=True)
        # tengo i primi candidati: se il primo non ha statistiche provo i successivi
        return [d["slug"] for d in ordered[:3] if score(d) >= 10]

    for p in quot:
        slugs = best_for(p) or []
        p["slugs"] = slugs
        p["slug"] = slugs[0] if slugs else None
    hit = sum(1 for p in quot if p["slug"])
    print(f"  abbinamento nomi: {hit}/{len(quot)}")
    return quot


# ---------------------------------------------------------------- 3. statistiche
def parse_stats(html):
    soup = BeautifulSoup(html, "lxml")
    t = soup.get_text(" | ", strip=True)
    d = {}

    # storico stagioni: "2024-25 - Inter | Fantamedia | 7.75 | Voto medio | 6.33"
    hist = {}
    for m in re.finditer(r"(\d{4}-\d{2}) - [^|]+? \| Fantamedia \| ([\d.,]+) \| Voto medio \| ([\d.,]+)", t):
        try:
            hist[m.group(1)] = float(m.group(2).replace(",", "."))
        except ValueError:
            pass
    if hist:
        d["hist"] = {k: v for k, v in hist.items() if k != "2026-27"}

    # log partita per partita (tabella "Giornata | Data | Risultato | Min. | Voto | ... | Fantavoto")
    log = []
    for tr in soup.select("table tr"):
        cells = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
        if len(cells) >= 7 and cells[0].isdigit():
            try:
                voto = float(cells[4].replace(",", "."))
                fv = float(cells[6].replace(",", "."))
                log.append([int(cells[0]), voto, fv])
            except (ValueError, IndexError):
                continue
    if log:
        d["log"] = log[-6:]
    for label, key in [("media voto", "voto"), ("Fantamedia", "fm"), ("presenze", "pres"),
                       ("gol", "gol"), ("assist", "ass"), ("minuti giocati", "min"),
                       ("partite da titolare", "tit")]:
        m = re.search(r"([\d]+(?:,\d+)?)\s*\|?\s*" + re.escape(label), t)
        if m:
            d[key] = float(m.group(1).replace(",", "."))
    if "pres" not in d:
        m = re.search(r"ha giocato ([\d]+) partit", t)
        d["pres"] = float(m.group(1)) if m else (0.0 if "non contiene prestazioni" in t else None)
    return d


def fetch_stats(slugs):
    def one(slug):
        return slug, parse_stats(get(f"{DEV}{slug}/stagione/{SEASON}/statistiche"))
    out = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        for slug, st in ex.map(one, slugs):
            out[slug] = st
    print(f"  statistiche scaricate: {len(out)}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-price", type=float, default=6.0, help="prezzo atteso minimo per scaricare le statistiche")
    ap.add_argument("--rebuild-only", action="store_true")
    args = ap.parse_args()

    if args.rebuild_only:
        import subprocess
        subprocess.run([sys.executable, str(ROOT / "build.py")], check=True)
        return

    print("1/4 listone ufficiale fantacalcio.it…")
    quot = parse_quotazioni()
    print("2/4 indice statistiche…")
    dev = dev_index()
    print("3/4 abbinamento…")
    quot = match_names(quot, dev)

    print("4/4 statistiche…")
    sel = [p for p in quot if p["slug"] and (p["qa"] or 0) >= args.min_price]
    stats = fetch_stats([p["slug"] for p in sel])

    # chi e' rimasto senza statistiche: provo il candidato successivo (omonimie, nomi con iniziale)
    def has_stats(st):
        return bool(st) and st.get("pres") is not None and (st.get("pres") or 0) > 0

    retry = [p for p in sel if not has_stats(stats.get(p["slug"] or "", {}))]
    alt_slugs = [sl for p in retry for sl in p["slugs"][1:] if sl not in stats]
    if alt_slugs:
        print(f"  secondo tentativo su {len(alt_slugs)} candidati alternativi…")
        stats.update(fetch_stats(alt_slugs))
        recuperati = 0
        for p in retry:
            for sl in p["slugs"][1:]:
                if has_stats(stats.get(sl, {})):
                    p["slug"] = sl
                    recuperati += 1
                    break
        print(f"  recuperati {recuperati} giocatori")

    players, senza_stats = [], 0
    for p in quot:
        st = stats.get(p.get("slug") or "", {})
        if not st or st.get("pres") is None:
            st = {}
            senza_stats += 1
        credits = max(1, round((p["qa"] or 1) * PRICE_K))
        players.append({
            "n": p["n"], "r": p["r"], "t": p["t"],
            # "q" e "a": quotazione ufficiale scalata in crediti d'asta (usata dai consigli)
            "q": p["qa"], "a": credits, "qa": p["qa"], "qi": p["qi"], "fvm": p["fvm"], "sid": p["sid"],
            "pres": st.get("pres", 0), "tit": st.get("tit"), "fm": st.get("fm"),
            "voto": st.get("voto"), "gol": st.get("gol"), "ass": st.get("ass"),
            "min": st.get("min"), "prev": None,
            "hist": st.get("hist") or {},
            "log": st.get("log") or [],
        })
    players.sort(key=lambda x: (-(x["a"] or 0), x["n"]))
    print(f"  database finale: {len(players)} giocatori ({senza_stats} senza statistiche stagionali)")

    (ROOT / "app" / "data.json").write_text(json.dumps(players, ensure_ascii=False, indent=0))

    # allineo il numero di giornate giocate nel modello (usato per la continuità)
    gw = max((p["pres"] or 0) for p in players) if players else 11
    mpath = ROOT / "app" / "model.js"
    src = mpath.read_text()
    src2 = re.sub(r"GW:\s*\d+(\.\d+)?,", f"GW: {int(gw)},", src, count=1)
    if src2 != src:
        mpath.write_text(src2)
    print(f"  giornate giocate impostate a {int(gw)}")

    import subprocess
    subprocess.run([sys.executable, str(ROOT / "build.py")], check=True)
    print("Fatto: fantatrade.html aggiornato.")


if __name__ == "__main__":
    main()
