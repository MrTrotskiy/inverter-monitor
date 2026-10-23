#!/bin/bash
# Take one reading and append it to the log. Meant for cron.
# Failures are recorded rather than mailed, so a dead token is visible in the log.
# The cloud times out often, so a failed poll is retried a couple of times.
# alert.py runs after every poll, failed ones too: silence during an outage is itself news.
cd "$(dirname "$0")" || exit 1
LOG="$PWD/../data/poll.err"
ok=
for attempt in 1 2 3; do
  /usr/bin/python3 dess_poll.py --append >/dev/null 2>>"$LOG" && { ok=1; break; }
  sleep 20
done
[ -n "$ok" ] || echo "$(date '+%F %T') poll failed" >> "$LOG"
/usr/bin/python3 alert.py >/dev/null 2>>"$LOG" || echo "$(date '+%F %T') alert failed" >> "$LOG"
