#!/usr/bin/env python3
"""Tell the owner in Telegram when an outage needs his attention.

Run by poll.sh after every poll. Each alert fires once per outage; what has
already been said is kept in data/alert-state.json, keyed by the outage start.

The message goes through the owner's own Telegram bot (config.json telegram.botEnv,
telegram.chatId). The token is read from that file at send time and never
printed, logged or passed on a command line.

Usage:
    python3 alert.py           # check the log, send what is due
    python3 alert.py --dry     # print what would be sent, send nothing
    python3 alert.py --test    # send one test message
"""

import datetime
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from energy import INVERTER_IDLE_W, USABLE_WH

DATA = Path(__file__).parent.parent / "data"
LOG_PATH = DATA / "dessmonitor-log.jsonl"
STATE_PATH = DATA / "alert-state.json"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "common"))
import localconfig  # noqa: E402

# the bot's token file and the owner's chat, from config.json (telegram.botEnv, telegram.chatId)
BOT_ENV = localconfig.path("telegram.botEnv") or Path("/nonexistent")
CHAT = localconfig.get("telegram.chatId", "")

# A hole longer than this splits two outages, and while off-grid it is itself
# worth telling: nothing is being measured.
MAX_GAP_MIN = 45
STALE_MIN = 30
# Displayed voltage, which sags ~0.15 V at ~100 W through this wiring. Two
# readings in a row must agree: a single low sample can be a load spike.
KNEE_V = 12.5
STOP_V = 12.2
SHARE_ALERTS = (0.5, 0.25)


def tell(text):
    token = next((line.split("=", 1)[1].strip().strip("\"'")
                  for line in BOT_ENV.read_text().splitlines()
                  if line.startswith("BOT_TOKEN=")), None)
    if not token:
        sys.exit("no BOT_TOKEN in the bot's token file")
    data = urllib.parse.urlencode({"chat_id": CHAT, "text": text}).encode()
    try:
        urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", data, timeout=20)
    except Exception as e:  # the URL holds the token, so never print the exception itself
        sys.exit(f"telegram failed: {type(e).__name__}")


def read_rows():
    rows = []
    for line in LOG_PATH.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("implausible") or row.get("load_w") is None:
            continue
        row["_t"] = datetime.datetime.strptime(row["ts"], "%Y-%m-%dT%H:%M:%SZ")
        rows.append(row)
    rows.sort(key=lambda r: r["_t"])
    return rows


def current_outage(rows):
    """The trailing run of off-grid rows with no hole longer than MAX_GAP_MIN."""
    run = []
    for row in reversed(rows):
        if row.get("grid_hz") != 0:
            break
        if run and (run[-1]["_t"] - row["_t"]).total_seconds() > MAX_GAP_MIN * 60:
            break
        run.append(row)
    return run[::-1]


def spent_wh(run):
    load = sum((a["load_w"] + b["load_w"]) / 2 * (b["_t"] - a["_t"]).total_seconds() / 3600
               for a, b in zip(run, run[1:]))
    hours = (run[-1]["_t"] - run[0]["_t"]).total_seconds() / 3600
    return load + INVERTER_IDLE_W * hours, hours


def hours_range(hours):
    """Quote a +/-15% range: the capacity is nameplate, not measured."""
    lo, hi = hours * 0.85, hours * 1.15
    return f"{lo:.1f}–{hi:.1f}" if hi < 3 else f"{lo:.0f}–{hi:.0f}"


def local(t):
    return (t + datetime.timedelta(hours=3)).strftime("%H:%M")


def due_alerts(rows, state, now):
    """Return (key, text) for every alert not yet sent for the current outage."""
    out = []
    run = current_outage(rows)
    last = rows[-1]

    if not run:
        # On the grid. If an outage was being tracked, it has just ended.
        ended = state.get("outage")
        if ended and "ended" not in state.get("sent", []):
            prev = [r for r in rows if r["_t"] >= datetime.datetime.fromisoformat(ended)
                    and r["grid_hz"] == 0]
            if prev:
                wh, hours = spent_wh(prev)
                out.append(("ended", f"⚡ Свет вернулся ({local(last['_t'])}). Отключение длилось "
                                     f"~{hours:.1f} ч, из банки ушло ~{wh:.0f} Вт·ч "
                                     f"(±20%). Идёт зарядка."))
        return run, out

    wh, hours = spent_wh(run)
    left = USABLE_WH - wh
    drain = last["load_w"] + INVERTER_IDLE_W
    hours_left = max(left, 0) / drain

    out.append(("started", f"🔋 Инвертор на батарее с {local(run[0]['_t'])}. Нагрузка "
                           f"{last['load_w']} Вт, {last['battery_v']} В. До резерва 10% "
                           f"~{hours_range(hours_left)} ч."))
    for share in SHARE_ALERTS:
        if left <= USABLE_WH * share:
            out.append((f"left{int(share * 100)}",
                        f"🔋 Осталось ~{max(left, 0) / USABLE_WH * 100:.0f}% полезной энергии "
                        f"(~{max(left, 0):.0f} Вт·ч). При {last['load_w']} Вт это "
                        f"~{hours_range(hours_left)} ч, {last['battery_v']} В."))

    tail = [r.get("battery_v") for r in run[-2:]]
    if len(tail) == 2 and all(v is not None and v <= KNEE_V for v in tail):
        out.append(("knee", f"⚠️ Началось колено: {tail[-1]} В при {last['load_w']} Вт, "
                            f"ушло ~{wh:.0f} Вт·ч. Дальше напряжение падает быстро."))
    if len(tail) == 2 and all(v is not None and v <= STOP_V for v in tail):
        out.append(("stop", f"🛑 {tail[-1]} В при {last['load_w']} Вт — пора выключать нагрузку. "
                            f"Ёмкость до этой точки: ~{wh:.0f} Вт·ч. Инвертор сам отключится "
                            f"при 11.7 В."))

    if (now - last["_t"]).total_seconds() > STALE_MIN * 60:
        out.append((f"stale{last['ts']}", f"❓ Нет данных с {local(last['_t'])} — облако или "
                                          f"регистратор молчат. Последнее: {last['battery_v']} В, "
                                          f"{last['load_w']} Вт."))
    return run, out


def main():
    if "--test" in sys.argv:
        tell("Тест: уведомления инвертора работают.")
        return
    dry = "--dry" in sys.argv
    state = json.loads(STATE_PATH.read_text()) if STATE_PATH.exists() else {}
    rows = read_rows()
    run, alerts = due_alerts(rows, state, datetime.datetime.utcnow())

    if run:
        start = run[0]["_t"].isoformat()
        if state.get("outage") != start:
            state = {"outage": start, "sent": []}
    sent = state.setdefault("sent", [])

    for key, text in alerts:
        if key in sent:
            continue
        print(text)
        if not dry:
            tell(text)
            sent.append(key)
    if not run and state.get("outage") and "ended" in sent:
        state = {}
    if not dry:
        STATE_PATH.write_text(json.dumps(state))


if __name__ == "__main__":
    main()
