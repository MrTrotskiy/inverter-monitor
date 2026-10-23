# collector/

Local, read-only reader of the inverter through its Eybond Wi-Fi dongle. Runs on the Mac mini as a
LaunchAgent, next to the cloud poller (`scripts/poll.sh`), which it does not touch.

- `collector.py` — announces itself to the dongle (UDP `set>server=<mac>:8899;` → port 58899), the dongle
  dials TCP 8899, and every 5 s the collector reads Modbus registers 201..234 (live) and once a minute
  100..109 (status). Only function 3 (read) can be built: `mb_read` refuses anything else.
- `service.sh install | uninstall | status | log` — the LaunchAgent `com.inverter-monitor.collector`
  (`~/Library/LaunchAgents/`), RunAtLoad + KeepAlive: starts at login, after a reboot, and again if it dies.
- the plist is written by `install` for this checkout (`common/launchagent.sh`); the dongle's address comes from
  `config.json` (`dongle.ip`, `dongle.broadcast`).

Data (`data/dongle/`, kept out of git by its own `.gitignore`):

- `<YYYY-MM-DD>.jsonl` — one line per reading: decoded fields and the raw words `r` (201..234), so a better
  register map can reread history. Lines with `status` are the status block. Files older than two days are gzipped.
- `status.json` — the last reading, today's counters (Wh/Ah in and out of the bank, output Wh, grid Wh),
  connection state, the cloud log's newest device packet. Rewritten after every reading.
- `events.jsonl` — start, connected, disconnected, read-failed, backoff, gzipped.

Register map used (SMG family, oleks-p/ha-eybond-local `smg.py`; checked against the cloud 2026-10-23):
201 mode (2 mains, 3 battery), 202 grid V ×0.1, 203 grid Hz ×0.01, 204 grid W, 208 inverter W (signed),
209 charging W, 210 output V ×0.1, 211 output A ×0.1, 212 output Hz ×0.01, 213 output W, 214 output VA,
215 battery V ×0.1, 216 battery A ×0.1 signed (2.8 A steps, truncated toward zero), 217 battery W signed,
225 load %, 226 temperature °C, 229 the inverter's battery % (voltage-based, not a fuel gauge).
Unmapped but stored: 218, 230–234 (233 ≈ the cloud's "AC charging current").

Guard for the cloud: if the cloud log gets no new device packet for 20 min while the collector holds the
dongle (and has held it 20 min), the collector lets go for 30 min. If the cloud stays silent without it too,
the guard rests until the cloud is fresh again. Checked 2026-10-23: the cloud kept getting packets
(17:38:24, 17:43:3x, …) while the collector read every 5 s.

Stepping aside for the settings writer (`writer/`, a separate program; the collector still only reads): while
`data/dongle/yield.json` (`{"job", "until"}`) is in force, the collector drops the dongle, closes port 8899, stops
announcing and writes `"yielded": {"job", "since"}` to status.json; when the file is gone or `until` has passed
(at most 5 min), it binds again and reads on (events `yielded`, `resumed`). `--tcp-port`, `--udp-port` and `--me`
exist for the sandbox tests (`writer/check_writer.py`), which run a second collector against a fake inverter.
