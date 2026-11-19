#!/usr/bin/env python3
"""
build.py — compila l'app in due pezzi:

  1. fantatrade.html      file unico da aprire col doppio clic (offline, tutto incorporato)
  2. dist/                cartella pronta da trascinare su Netlify (o qualsiasi hosting statico):
        index.html         la stessa app, con meta tag social, favicon e theme-color
        og.png             immagine di anteprima per la condivisione (1200x630)
        apple-touch-icon.png
        _headers            cache + header di sicurezza per Netlify
        robots.txt
"""
import json, pathlib, shutil, subprocess

ROOT = pathlib.Path(__file__).resolve().parent
APP = ROOT / "app"
DIST = ROOT / "dist"

data = json.load(open(APP / "data.json"))
context = json.load(open(APP / "context.json"))
leagues = json.load(open(APP / "leagues.json")) if (APP / "leagues.json").exists() else []
import datetime
DATA_DATE = datetime.date.fromtimestamp((APP / "data.json").stat().st_mtime).strftime("%d/%m/%Y")
css = (APP / "styles.css").read_text()
body = (APP / "ui.html").read_text().replace("__DATA_DATE__", DATA_DATE)
model = (APP / "model.js").read_text()
ui = (APP / "ui.js").read_text()

SEASON = "2026/27"
TITLE = "FantaTrade — consigli sugli scambi di fantacalcio"
DESC = ("Valuta gli scambi di fantacalcio con i dati reali della Serie A " + SEASON +
        ": punti attesi a giornata, calendario, fantamedia attesa e scambi vantaggiosi per entrambe le squadre.")

FAVICON = (
    "data:image/svg+xml,"
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E"
    "%3Crect width='24' height='24' rx='6' fill='%230e2a1d'/%3E"
    "%3Cpath d='M5 9h11l-2.5-2.5M19 15H8l2.5 2.5' fill='none' stroke='%237ef0b0' "
    "stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"
)

BASE_HEAD = """<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="icon" href="{favicon}">
<meta name="theme-color" content="#0b1017">
"""

SOCIAL_HEAD = """<meta property="og:type" content="website">
<meta property="og:locale" content="it_IT">
<meta property="og:site_name" content="FantaTrade">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="og.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
"""


PWA_HEAD = """<link rel="manifest" href="./manifest.webmanifest">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="FantaTrade">
<script>
// il service worker esiste solo quando la pagina e' servita da http(s): aprendo il file
// con doppio clic (file://) questo blocco non fa nulla e l'app funziona identica
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* niente: si resta online */ });
  });
}
</script>
"""

MANIFEST = {
    "name": "FantaTrade — scambi fantacalcio",
    "short_name": "FantaTrade",
    "description": "Valuta gli scambi di fantacalcio con i dati reali della Serie A 2026/27.",
    "lang": "it",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "background_color": "#0b1017",
    "theme_color": "#0b1017",
    "orientation": "portrait-primary",
    "icons": [
        {"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}

# service worker: shell in cache, navigazioni network-first con fallback offline,
# asset stale-while-revalidate. Versionato a mano: cambiare VERSION a ogni release.
SW_JS = """const VERSION = 'fantatrade-v2';
const CORE = ['./', './index.html', './manifest.webmanifest',
              './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION)
    .then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => undefined))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fantatrade-') && k !== VERSION)
      .map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;   // dati incorporati: nessuna API esterna

  // navigazioni: rete per prima, ma se la rete non risponde entro 3,5s o da errore -> cache
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3500)),
        ]);
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        }
        throw new Error('bad status');
      } catch (_) {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // resto: cache subito, aggiornamento in sottofondo
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
"""


def page(head_extra: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="it">
<head>
{BASE_HEAD.format(title=TITLE, desc=DESC, favicon=FAVICON)}{head_extra}<style>
{css}
</style>
</head>
<body>
{body}
<script>
window.FANTATRADE_DATA = {json.dumps(data, ensure_ascii=False, separators=(',', ':'))};
window.FANTATRADE_CTX = {json.dumps(context, ensure_ascii=False, separators=(',', ':'))};
window.FANTATRADE_LEAGUES = {json.dumps(leagues, ensure_ascii=False, separators=(',', ':'))};
</script>
<script>
{model}
</script>
<script>
{ui}
</script>
</body>
</html>
"""


def make_icon(path: pathlib.Path, size: int, maskable: bool = False):
    """Icona dell'app: stesso simbolo del logo (due frecce di scambio)."""
    from PIL import Image, ImageDraw
    S = size
    img = Image.new("RGB", (S, S), "#0e2a1d")
    d = ImageDraw.Draw(img)
    if not maskable:
        # angoli arrotondati disegnati sopra lo sfondo
        mask = Image.new("L", (S, S), 0)
        dm = ImageDraw.Draw(mask)
        dm.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
        bg = Image.new("RGB", (S, S), "#0b1017")
        img = Image.composite(img, bg, mask)
        d = ImageDraw.Draw(img)

    # contenuto dentro la "safe zone" (80% per le icone maskable)
    inner = 0.58 if maskable else 0.78
    w = max(2, int(S * 0.055))
    cx = cy = S / 2
    u = S * inner / 24.0          # unita' del viewBox 24x24
    ox, oy = cx - 12 * u, cy - 12 * u
    def P(x, y): return (ox + x * u, oy + y * u)

    c = "#7ef0b0"
    d.line([P(5, 9), P(16, 9)], fill=c, width=w)
    d.polygon([P(13.5, 5.6), P(17.4, 9), P(13.5, 12.4)], fill=c)
    d.line([P(19, 15), P(8, 15)], fill=c, width=w)
    d.polygon([P(10.5, 11.6), P(6.6, 15), P(10.5, 18.4)], fill=c)
    img.save(path, optimize=True)


def make_og_image(path: pathlib.Path):
    from PIL import Image, ImageDraw, ImageFont

    W, H = 1200, 630
    img = Image.new("RGB", (W, H), "#0b1017")
    d = ImageDraw.Draw(img)

    # sfondo: leggero gradiente verticale
    for y in range(H):
        t = y / H
        r = int(11 + 12 * (1 - t)); g = int(16 + 20 * (1 - t)); b = int(23 + 30 * (1 - t))
        d.line([(0, y), (W, y)], fill=(r, g, b))

    def font(size, bold=False):
        candidates = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        ]
        for c in candidates:
            if pathlib.Path(c).exists():
                return ImageFont.truetype(c, size)
        return ImageFont.load_default()

    # riquadro del logo
    d.rounded_rectangle([70, 70, 70 + 84, 70 + 84], radius=22, fill="#12301f", outline="#2c6a4b", width=2)
    d.line([(94, 100), (128, 100)], fill="#7ef0b0", width=6)
    d.line([(118, 91), (130, 100), (118, 109)], fill="#7ef0b0", width=6, joint="curve")
    d.line([(108, 126), (140, 126)], fill="#7ef0b0", width=6)
    d.line([(130, 117), (118, 126), (130, 135)], fill="#7ef0b0", width=6, joint="curve")

    d.text((172, 78), "FantaTrade", font=font(56, True), fill="#e8eef7")
    d.text((174, 142), "consigli sugli scambi di fantacalcio", font=font(26), fill="#8fa1b8")

    d.text((70, 232), "Valuta uno scambio in 10 secondi:", font=font(44, True), fill="#e8eef7")
    d.text((70, 296), "punti attesi a giornata, conguaglio in crediti,", font=font(32), fill="#c3d2e4")
    d.text((70, 342), "scambi vantaggiosi per entrambe le squadre.", font=font(32), fill="#c3d2e4")

    # pillole
    pills = [("Serie A 2026/27", "#2fd07b"), ("603 giocatori", "#4aa8ff"), ("calendario reale", "#ffb454")]
    x = 70
    for text, color in pills:
        f = font(24, True)
        w = d.textlength(text, font=f)
        d.rounded_rectangle([x, 470, x + w + 40, 470 + 52], radius=26, fill="#141c28", outline="#243040", width=1)
        d.text((x + 20, 484), text, font=f, fill=color)
        x += w + 60

    d.text((70, 556), "fantatrade", font=font(22), fill="#63758c")
    img.save(path, optimize=True)


def main():
    # 1. file unico (offline, doppio clic)
    single = page("")
    (ROOT / "fantatrade.html").write_text(single)
    print("scritto fantatrade.html", len(single), "byte")

    # 2. cartella di deploy
    DIST.mkdir(exist_ok=True)
    (DIST / "index.html").write_text(page(SOCIAL_HEAD.format(title=TITLE, desc=DESC) + PWA_HEAD))

    # PWA: manifest, service worker, icone
    (DIST / "manifest.webmanifest").write_text(json.dumps(MANIFEST, ensure_ascii=False, indent=2))
    (DIST / "sw.js").write_text(SW_JS)
    make_og_image(DIST / "og.png")
    for name, size, mask in [("icon-192.png", 192, False), ("icon-512.png", 512, False),
                             ("icon-maskable-512.png", 512, True), ("apple-touch-icon.png", 180, False)]:
        make_icon(DIST / name, size, maskable=mask)

    (DIST / "_headers").write_text("""/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin

/index.html
  Cache-Control: public, max-age=0, must-revalidate

/og.png
  Cache-Control: public, max-age=604800

/sw.js
  Cache-Control: public, max-age=0, must-revalidate

/manifest.webmanifest
  Content-Type: application/manifest+json
  Cache-Control: public, max-age=3600
""")
    (DIST / "robots.txt").write_text("User-agent: *\nAllow: /\n")
    print("scritto dist/ (index.html, manifest.webmanifest, sw.js, icone, og.png, _headers, robots.txt)")


if __name__ == "__main__":
    main()
