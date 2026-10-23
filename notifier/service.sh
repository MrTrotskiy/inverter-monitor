#!/bin/bash
# The notifier as a LaunchAgent of this user: starts at login (and after a reboot), restarts if it dies.
#   notifier/service.sh install | uninstall | status | log
set -e
LABEL=com.inverter-monitor.notifier
HERE="$(cd "$(dirname "$0")" && pwd)"
DST="$HOME/Library/LaunchAgents/$LABEL.plist"
DATA="$(cd "$HERE/.." && pwd)/data/notify"
. "$HERE/../common/launchagent.sh"
case "$1" in
  install)
    mkdir -p "$DATA" "$HOME/Library/LaunchAgents"
    write_plist "$LABEL" "$DST" "$HERE" "$DATA/notifier.out" "$DATA/notifier.err" 30 "" -- /usr/bin/python3 "$HERE/notify.py"
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$UID" "$DST"
    launchctl print "gui/$UID/$LABEL" | grep -E 'state|pid' | head -3 ;;
  uninstall)
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    rm -f "$DST"; echo "removed" ;;
  status)
    launchctl print "gui/$UID/$LABEL" 2>/dev/null | grep -E 'state|pid|last exit' | head -4 || echo "not loaded" ;;
  state)
    # on | off, for the admin's Бот page (off also means the plist is gone: it will not start at the next login)
    if launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then echo on; else echo off; fi ;;
  log)
    tail -20 "$DATA/log.jsonl" ;;
  *) echo "usage: $0 install|uninstall|state|status|log"; exit 1 ;;
esac
