#!/bin/bash
# The admin as a LaunchAgent of this user: starts at login (and after a reboot), restarts if it dies.
#   admin/service.sh install | uninstall | restart | status | log
# install builds the app first if dist/ is missing (npm ci + vite build); after a change in src/, run
# `npm run build` and `service.sh restart`.
set -e
LABEL=com.inverter-monitor.admin
HERE="$(cd "$(dirname "$0")" && pwd)"
DST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$(cd "$HERE/.." && pwd)/data/admin"
NODE="$(command -v node || echo /usr/local/bin/node)"
PORT="$("$NODE" -e "import('$HERE/localconfig.mjs').then(m=>console.log(m.get('admin.port',8080)))" 2>/dev/null || echo 8080)"
. "$HERE/../common/launchagent.sh"
case "$1" in
  install)
    mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"
    if [ ! -f "$HERE/dist/index.html" ]; then (cd "$HERE" && npm ci && npm run build); fi
    # TZ: the admin counts days in Kyiv time (Ukrainian outage schedules); the port comes from config.json
    write_plist "$LABEL" "$DST" "$HERE" "$LOGS/server.out" "$LOGS/server.err" 10 "Europe/Kyiv" -- "$NODE" "$HERE/server.mjs"
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$UID" "$DST"
    launchctl print "gui/$UID/$LABEL" | grep -E 'state|pid' | head -3 ;;
  uninstall)
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    rm -f "$DST"; echo "removed" ;;
  restart)
    launchctl kickstart -k "gui/$UID/$LABEL" ;;
  status)
    launchctl print "gui/$UID/$LABEL" 2>/dev/null | grep -E 'state|pid|last exit' | head -4 || echo "not loaded"
    curl -s --max-time 3 "http://127.0.0.1:$PORT/api/health"; echo
    tail -3 "$LOGS/server.out" 2>/dev/null ;;
  log)
    tail -20 "$LOGS/server.out" "$LOGS/server.err" ;;
  *) echo "usage: $0 install|uninstall|restart|status|log"; exit 1 ;;
esac
