#!/bin/bash
# The collector as a LaunchAgent of this user: starts at login (and after a reboot), restarts if it dies.
#   collector/service.sh install | uninstall | status | log
set -e
LABEL=com.inverter-monitor.collector
HERE="$(cd "$(dirname "$0")" && pwd)"
DST="$HOME/Library/LaunchAgents/$LABEL.plist"
DATA="$(cd "$HERE/.." && pwd)/data/dongle"
. "$HERE/../common/launchagent.sh"
case "$1" in
  install)
    mkdir -p "$DATA" "$HOME/Library/LaunchAgents"
    write_plist "$LABEL" "$DST" "$HERE" "$DATA/collector.out" "$DATA/collector.err" 30 "" -- /usr/bin/python3 "$HERE/collector.py"
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$UID" "$DST"
    launchctl print "gui/$UID/$LABEL" | grep -E 'state|pid' | head -3 ;;
  uninstall)
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    rm -f "$DST"; echo "removed" ;;
  status)
    launchctl print "gui/$UID/$LABEL" 2>/dev/null | grep -E 'state|pid|last exit' | head -4 || echo "not loaded"
    python3 -c "import json;s=json.load(open('$DATA/status.json'));print({k:s.get(k) for k in ('written','connected','reads_ok','reads_failed','cloud_age_min')});print(s.get('today'))" ;;
  log)
    tail -20 "$DATA/events.jsonl" ;;
  *) echo "usage: $0 install|uninstall|status|log"; exit 1 ;;
esac
