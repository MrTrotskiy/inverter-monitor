# admin/

The inverter's admin for the home LAN, a dark single-screen web app served by the Mac (or any always-on machine)
that runs the collector:

- `/` (also `/admin`, `/admin?day=YYYY-MM-DD`): the bank now — charge, countdown to cut-off or to full, where the
  power goes — and any day with readings, scrubbed on a timeline. Today always opens on the current time. When the
  inverter is not on the line: «нет связи с HH:MM» at the top, the charge at the last reading in the sphere, how long
  and why under it, every stretch without a link grey on the timeline; when it answers again the screen goes live
  and says so for a minute.
- `/history`: a month or three at a glance.
- `/settings`: the inverter's settings (Modbus registers 300–343 and the panel's program numbers), grouped, with the
  inverter's range, the band good for the bank and a risk level; changes behind the PIN (below).
- `/bot`: the Telegram notifications, behind the same PIN.
- `/bank`: what the bank holds, hours at a load, the discharge curve, the discharge-test mode.

The server reads what the collector (`collector/`) and the cloud poller (`scripts/`) write and never talks to the
inverter, the dongle or the cloud itself; a settings change is a job for `writer/settings_writer.py`.

**Address:** `http://<this Mac's name>.local:<port>/` (Bonjour, stable whatever IP the router gives) or
`http://<its LAN IP>:<port>/`; the port is `admin.port` in `config.json` (8080 if unset).

## How it runs

- `server.mjs`: Node, no packages. Serves `dist/` and the API:
  - `/api/collector?day=YYYY-MM-DD&step=15`: the collector's status, last events, and the day's points (collector
    readings thinned to `step` s, merged with the cloud's real packets, from 6 h before the day's midnight).
  - `/api/days`: every day with readings: outages, hours on battery, Wh out of and into the bank, sources.
  - `/api/settings`, `/api/bot`, `/api/bank`, `/api/health`; the changes are under «Changes».
- `feed.mjs`: the data side; files are read once and then only their new bytes, and a past day's summary is kept
  until its files change.
- `service.sh install | uninstall | restart | status | log`: LaunchAgent `com.inverter-monitor.admin`
  (`~/Library/LaunchAgents/`, written for this checkout by `common/launchagent.sh`), RunAtLoad + KeepAlive +
  Nice 5: starts at login (and after a reboot if the Mac logs in by itself), restarts if it dies. Logs in
  `data/admin/`.
- Cost, measured: ~50–90 MB of memory; one open admin tab polls every 10 s and costs the server about 0.13 s of CPU
  a minute.

**Home LAN only.** It listens on the Mac's private IPv4 addresses (192.168/16, 10/8, 172.16/12) and 127.0.0.1,
never on 0.0.0.0, so a VPN address (e.g. Tailscale's 100.x) or an SSH tunnel does not reach it; the list is re-read
every minute, so a new DHCP address is followed. It answers only clients from those ranges, and only a Host that is
an IP, `*.local` or `localhost` (no DNS rebinding). Nothing is published to the internet. With the macOS firewall
on, Node must be allowed to accept connections (after a Homebrew upgrade of Node the firewall may ask again).

## The app

- `src/pages/*`, `src/lib/admin`: the screens and the bank's model (`model.js`: one moment of the bank, live or
  replayed; `model.check.js` checks it).
- `src/space/`: a few small helpers (a full-window frame, an animation clock, a canvas, a drawer, number format).

After a change in `src/`: `npm run build && ./service.sh restart`. `npm run dev` serves the app with hot reload
on 127.0.0.1:5173 and sends `/api` to the running server.

## Changes: the PIN, the settings, the bot

Every change (an inverter setting, the bot's config, the bot on/off, a test message) needs the PIN. Without a PIN
set, the admin is view-only.

- **The PIN** is set on the Mac itself: `admin/pin.sh set` (asks twice, hidden; 4–12 digits; refused: all the
  same, runs like 1234 / 4321, repeated pairs like 1212, and the most common PINs). Only a scrypt hash is kept, in
  `data/admin/pin.json` (mode 600, ignored by git). 5 wrong PINs lock changes for 15 min; 3 such locks without a
  right PIN in between lock them until `admin/pin.sh unlock` on the Mac — so a 4-digit PIN gets at most 15 guesses
  before someone at the Mac has to step in.
  `pin.sh remove` forgets it, `pin.sh status` says what is set. Attempts (never the digits) go to
  `data/admin/security.jsonl`. The page sends the PIN with each change over the home LAN's plain HTTP.
- **Settings** (`/settings`): `actions.mjs` checks the PIN, the setting (not grey, not cloud-only, in range, an
  allowed option), the inverter's rules (catalog `problems()`), a 2-second hold for red ones, and the moment
  (on the line, on mains, not charging above 40 A); then it hands a job to `writer/settings_writer.py`. The page
  shows the job's steps live, the journal keeps every write and rollback, each with «вернуть».
- **Бот** (`/bot`): which notifications, their thresholds, night hours and what still comes at night, the outage
  queue, on/off, a test message. See `notifier/README.md`.
- Only same-origin JSON POSTs are taken (`Origin` checked, a form cannot send JSON), at most 16 KB.

## The bank: the discharge test and what it measured

- `/bank`: what the bank holds from full (to a 10 % floor, and to the inverter's cut-off), the inverter's own draw,
  hours at a load, the discharge curve; the datasheet's numbers until a test has been made. «Начать тест» turns on
  the test mode (`data/admin/test.json`; display only, no PIN).
- In test mode the admin's strip becomes the test: waiting for full → energy out, the stop and time left →
  «скоро стоп» → a red «СТОП — включите сеть» with a red frame. STOP is whichever comes first (model.js `TEST`,
  `discharge()`): 90 % of the bank out; the knee (load-corrected voltage down ≥ 0.2 V over the last 100 Wh); ≤ 12.2 V
  corrected; ≤ 12.0 V on the screen (a 12 V inverter of this kind cuts at ~11.7 V at its own terminals, and under
  load the wiring takes a few tenths, so the cut can come before 10 %).
- After the test: `node admin/calibrate.mjs <day> --write`: energy out by the recharge (best), the battery meter
  and the load; the inverter's own draw; the wiring's resistance from load steps; the curve; whether the knee was
  reached → `data/calibration.json`. The admin then counts with the measured bank (model.js `calibrate()`).
- The collector writes each reading with fsync (a power cut loses at most the one being read), and
  `data/dongle/guard-off.json {"until"}` keeps the cloud guard from letting go of the dongle during a test.

## Checks

- `node check.mjs`: the model, the settings catalog, the writer's register list against the catalog, the feed
  against the data files (if there are any).
- `node check_server.mjs`: every change path in a sandbox: PIN, lock, refusals, a write, «вернуть», a red pair with
  the hold, the bot's config / on / off / test, the PIN nowhere on disk or in logs, nothing on battery.
- `node check_pin.mjs`: the PIN rules: 4–12 digits, the obvious ones refused, the 15-minute lock, the hard lock after
  three, unlock, the digits nowhere on disk.
- `node check_calibrate.mjs`: the calibration on a made-up test day with a known truth.
- `python3 ../writer/check_writer.py`: the writer against a fake inverter.
- `node sandbox.mjs --host <LAN address> --port 8801`: the whole admin against a fake inverter, to try it by hand
  (sandbox PIN 4829); a real inverter is never touched.
