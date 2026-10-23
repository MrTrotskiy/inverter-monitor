# notifier/

Notifications to the owner through a Telegram bot of his own, to his chat only. The token file and the chat id are
in `config.json` (`telegram.botEnv`, `telegram.chatId`; not in git; `data/notify/config.json` may hold `chat_id`
too). Built on the collector's 5-second readings.

- `rules.py`: the rules, a pure state machine (no network, no files). `check_rules.py`: 14 checks on made-up series.
- `notify.py`: the LaunchAgent `com.inverter-monitor.notifier`. It follows `data/dongle/<day>.jsonl`, runs the rules
  and sends. `--replay <day>` prints what would have been sent; `--dry` prints instead of sending.
- `check_notify.py`: 3 checks of notify.py as launchd runs it (the real script in a sandbox, fake Telegram, restarts).
- `service.sh install | uninstall | status | log`.

Kinds: off, on, sum (outage summary), notfull, lvl50, lvl20, fast, hour (last hour), full (charge over),
nocharge, over (overload), hot, data (silence), blink. Night 23:00–08:00: only important ones (over, hot,
lvl20, hour, data while on battery); the rest come at 08:00 in one message.

## Once, and only about the inverter (fixed 2026-10-23)

After the Mac mini was off 18:18 → 19:58, the owner got "Инвертор молчит 10 мин… Последнее чтение 18:18" three
times. Two faults, both reproduced in `check_notify.py` before the fix:

1. `log("sent", kind=…)` raised TypeError right after the send and before the state was saved; launchd restarted
   the process every 30 s, and each life sent the same notice again. Now every message carries a `key` naming its
   event (`data:<last reading>`, `off:<outage start>`…). The key goes into `state.json` before the send, so a
   restart can lose a message but never repeat it. Errors in the loop are logged (`loop-error`) and the loop goes on.
2. Silence was counted from the last reading, over the time the Mac itself was off. Now the rules count it from
   `watch_since`: the start of this service after a break (state.json untouched for 2 min, or the Mac booted after
   it was last touched), or a clock jump inside the loop (sleep). If nothing is read for 10 min after the Mac comes
   back, the notice says so ("Mac работает с …, а инвертор так и не прочитан"), and adds what the collector's status
   tells of the cause (the collector is down / the cloud still gets packets / the cloud is silent too).
   An outage that began or ended inside such a break is reported without the moment or total it cannot know.

`defer` in config.json lists kinds NOT sent from here because scripts/alert.py (cron, cloud) already sends
them through the same bot: off, on, sum, lvl50, lvl20. When alert.py is retired, empty the list.

## "Won't last until the power is back" (kind `short`, important, day and night)

`schedule.py` reads the public svitlo-proxy feed (a JSON copy of svitlo.live; no token, nothing about the owner is
sent) every 30 min for `region` + `queue` in data/notify/config.json, e.g. `"region": "kyivska-oblast",
"queue": "1.1"`. On battery, inside a scheduled outage whose end is published, if the bank at the last 15 minutes'
mean load runs out more than 10 min before that end, one notice per outage: the hour the power is due, the hour
the bank ends, and the load that would last. Unset region/queue = the rule is off. Oblenergo channels that publish
schedules of their own are not read.

## Set up from the admin (the Бот page, behind the PIN)

The admin's `/bot` page writes `data/notify/config.json` and switches the service:

- `off`: kinds the owner switched off; `night_kinds`: kinds that may come at night (`data` only while on battery);
  `night`: [from, to] hours; `max_per_hour`; `region`, `queue`; `rules`: thresholds over `rules.RULES`
  (`levels` [first, second] %, `fast_w`, `fast_min`, `hot_c`, `overload_va`, `overload_w`, `silent_min`,
  `nocharge_min`, `short_margin_min`, `blink_s`). Kind tokens: `lvl1` / `lvl2` are the first and second level,
  whatever their percent (old `lvl50` / `lvl20` in a config are read as those).
- On / off is `service.sh install` / `uninstall`; `service.sh state` answers `on` / `off`. Off removes the plist
  from ~/Library/LaunchAgents, so it does not come back at the next login. (Until 2026-10-23 "off" was only a
  `bootout` and the plist stayed: the reboot at 19:58 started it again. Removed that evening; it stays off.)
- `botctl.py test` sends one test message to the chat in config.json (the token from the bot's token file, never
  printed). A save while the notifier is on restarts it, since it reads its config when it starts.
