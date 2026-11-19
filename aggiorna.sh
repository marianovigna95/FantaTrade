#!/usr/bin/env bash
# Aggiorna FantaTrade in un colpo solo: quotazioni/statistiche -> xG -> ricompila.
# Pensato per cron o launchd: non si ferma se una fonte è giù, scrive tutto in aggiorna.log.
#
#   ./aggiorna.sh            aggiornamento completo
#   ./aggiorna.sh --check    dice com'è la situazione senza toccare niente
#
# Cron (ogni martedì alle 8:00):
#   crontab -e
#   0 8 * * 2  cd /percorso/di/fantatrade && ./aggiorna.sh >> aggiorna.log 2>&1
#
# macOS con launchd: LaunchAgents/com.fantatrade.aggiorna.plist con StartCalendarInterval
# (Weekday 2, Hour 8, Minute 0) e ProgramArguments = /percorso/di/fantatrade/aggiorna.sh

set -u
cd "$(dirname "$0")" || exit 1

PY=python3
[ -x ".venv/bin/python" ] && PY=".venv/bin/python"

stamp() { date '+%Y-%m-%d %H:%M:%S'; }

if [ "${1:-}" = "--check" ]; then
  echo "== $(stamp) =="
  $PY import_extra.py --report
  $PY - <<'EOF'
import json, pathlib, datetime as dt
f = pathlib.Path("app/data.json")
d = json.loads(f.read_text())
ts = dt.datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
adv = sum(1 for p in d if p.get("xg") is not None or p.get("inj") is not None or p.get("injDays"))
print(f"  data.json: {len(d)} giocatori, {adv} con dati avanzati, ultimo aggiornamento {ts}")
EOF
  exit 0
fi

echo "== $(stamp) aggiornamento =="
rc=0

# 1. quotazioni ufficiali + statistiche stagionali (riscrive app/data.json)
echo "-- refresh_data.py"
$PY refresh_data.py --min-price 0 || { echo "!! refresh_data.py fallito: tengo i dati precedenti"; rc=1; }

# 2. dati avanzati: xG e tiri. Va dopo il refresh, che riscrive data.json da zero.
echo "-- fetch_extra.py"
$PY fetch_extra.py || { echo "!! fetch_extra.py fallito: tengo i dati precedenti"; rc=1; }

# 3. ricompila l'app a file singolo (idempotente)
echo "-- build.py"
$PY build.py || { echo "!! build.py fallito"; rc=2; }

echo "-- esito"
$PY import_extra.py --report
echo "== $(stamp) fine (rc=$rc) =="
exit $rc
