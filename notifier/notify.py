#!/usr/bin/python3
"""Sends the owner notifications through his own Telegram bot, to his chat only.

Reads the collector's day files (data/dongle/<day>.jsonl) as they grow, runs rules.py over each reading, and
sends what is due. The token is read from the file named by config.json `telegram.botEnv` (BOT_TOKEN=...) at send
time and never printed or logged; the only chat it ever writes to is data/notify/config.json `chat_id`, or else
config.json `telegram.chatId`.

Night (23:00-08:00): only `important` messages go out (overload, heat, 20 %, the last hour, silence while on
battery); the rest wait and come at 08:00 as one message.

Once means once (fixed 2026-10-23 after three copies of one notice): every message has a key naming its event;
the key is written to state.json BEFORE the message is sent, so a crash or a restart after sending never sends it
again (at most once: a crash between the write and the send loses that one message, it never doubles it).
An error inside the loop is logged and the loop goes on; it does not hand the process to launchd's restarts.

A break in watching is not the inverter's silence: when the Mac was off, asleep, or this service was not running
(state.json not touched for 2 min, or the Mac booted after it was), silence is counted from the moment watching
resumed (rules.resume).

While scripts/alert.py (cron, the cloud poller) still sends outage alerts through the same bot, the kinds it
covers are not sent from here (`defer` in config.json): no double messages. Empty `defer` = this sender says all.

  notify.py            run (LaunchAgent com.inverter-monitor.notifier)
  notify.py --replay DAY [--from HH:MM]   print what the rules would have sent over a day file, send nothing
  notify.py --dry      run, print instead of sending
"""
import argparse
import json
import os
import subprocess
import sys
import time
import traceback
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "common"))
from rules import RULES, Rules, is_night, clock  # noqa: E402
from schedule import Schedule  # noqa: E402
import localconfig  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DONGLE = ROOT / "data" / "dongle"
HERE = ROOT / "data" / "notify"
BOT_ENV = Path(os.environ["BOT_ENV"]) if os.environ.get("BOT_ENV") else (localconfig.path("telegram.botEnv") or Path("/nonexistent"))
DEFAULT_CONFIG = {
    "chat_id": None,
    # covered by scripts/alert.py today: outage start/end + its summary, 50 %, 25 %/knee/stop, no data
    # (tokens: lvl1 / lvl2 are the first and the second level of rules.levels, whatever their percent)
    "defer": ["off", "on", "sum", "lvl1", "lvl2"],
    "night": [23, 8],
    "max_per_hour": 12,
    # the owner's outage queue for "won't last until the power is back" (schedule.py); unset = that rule is off
    "region": None,
    "queue": None,
    # set from the admin's Бот page: kinds he switched off, kinds that may come at night, thresholds over rules.RULES
    "off": [],
    "night_kinds": ["over", "hot", "lvl2", "hour", "short", "data"],
    "rules": {},
}
OLD_TOKENS = {"lvl50": "lvl1", "lvl20": "lvl2"}


def token(kind, levels):
    """A message kind as the config names it: lvl<percent> -> lvl1 / lvl2 by its place in `levels`."""
    if kind.startswith("lvl") and kind[3:].isdigit():
        return "lvl1" if levels and int(kind[3:]) == levels[0] else "lvl2"
    return kind


def load_config():
    cfg = {**DEFAULT_CONFIG, **load_json(HERE / "config.json", {})}
    for k in ("defer", "off", "night_kinds"):
        cfg[k] = [OLD_TOKENS.get(x, x) for x in cfg[k]]
    cfg["rules"] = {**RULES, **{k: v for k, v in (cfg.get("rules") or {}).items() if k in RULES}}
    cfg["chat_id"] = cfg.get("chat_id") or localconfig.get("telegram.chatId")
    return cfg


BREAK_S = 120  # state.json older than this at start, or a loop step longer than this: watching had a break
LOOP_S = 10
KEEP_KEYS_S = 3 * 86400

ap = argparse.ArgumentParser()
ap.add_argument("--replay")
ap.add_argument("--from", dest="since", default="00:00")
ap.add_argument("--dry", action="store_true")
args = ap.parse_args()


def log(event, **kw):
    HERE.mkdir(parents=True, exist_ok=True)
    rec = {"t": datetime.now().astimezone().isoformat(timespec="seconds"), "event": event, **kw}
    with open(HERE / "log.jsonl", "a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def load_json(p, default):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return default


def save_json(p, obj):
    tmp = str(p) + ".tmp"
    Path(tmp).write_text(json.dumps(obj, ensure_ascii=False))
    os.replace(tmp, p)


def boot_time():
    """When this Mac last booted (epoch s), or None."""
    try:
        out = subprocess.run(["sysctl", "-n", "kern.boottime"], capture_output=True, text=True, timeout=5).stdout
        return float(out.split("sec =")[1].split(",")[0])
    except (OSError, IndexError, ValueError, subprocess.SubprocessError):
        return None


def why_silent(now):
    """What the collector's status says about the cause, in a few words for the silence notice."""
    st = load_json(DONGLE / "status.json", {})
    try:
        written = datetime.fromisoformat(st["written"]).timestamp()
    except (KeyError, ValueError, TypeError):
        written = 0
    if now - written > 180:
        return "Коллектор не работает."
    age = st.get("cloud_age_min")
    if age is not None and age < 20:
        return "Облако данные получает: донгл в сети, но не отвечает коллектору."
    cl = st.get("cloud_last_packet")
    if cl:
        return f"Облако тоже ничего не получает с {cl[11:16]}: донгл или инвертор не в сети."
    return ""


def send(chat_id, text):
    """-> True when Telegram accepted it. The URL holds the token: errors are reduced to their type."""
    token = None
    try:
        for line in BOT_ENV.read_text().splitlines():
            if line.startswith("BOT_TOKEN="):
                token = line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    if not token or not chat_id:
        log("send-skipped", why="no token or no chat_id")
        return False
    data = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode()
    try:
        with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", data, timeout=20) as r:
            return json.loads(r.read()).get("ok", False)
    except Exception as e:  # never str(e): it may carry the URL
        log("send-error", err=type(e).__name__, code=getattr(e, "code", None))
        return False


def readings(path, offset):
    """New complete lines of a day file from byte offset -> (list, new offset)."""
    out = []
    try:
        with open(path, "rb") as f:
            f.seek(offset)
            chunk = f.read()
    except OSError:
        return out, offset
    end = chunk.rfind(b"\n") + 1
    for line in chunk[:end].decode("utf-8", "replace").splitlines():
        if '"bat_w"' in line:
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    return out, offset + end


def replay(day, since):
    rules = Rules()
    path = DONGLE / f"{day}.jsonl"
    rows, _ = readings(path, 0)
    t0 = datetime.fromisoformat(f"{day}T{since}:00").timestamp()
    for rd in rows:
        t = datetime.fromisoformat(rd["t"]).timestamp()
        if t < t0:
            continue
        for m in rules.step(rd) + rules.tick(t):
            print(f"{clock(t)}  {'!' if m['important'] else ' '} {m['kind']:9} {m['text']}")
    print(f"-- {len(rows)} readings, state: soc {rules.soc():.0f} %, full {rules.s['full']}")


def main():
    HERE.mkdir(parents=True, exist_ok=True)
    cfg = load_config()
    st = load_json(HERE / "state.json", {})
    rules = Rules(st.get("rules"), cfg["rules"])
    sched = Schedule(HERE / "schedule.json", cfg.get("region"), cfg.get("queue"))
    S = {
        "held": st.get("held", []),  # night messages waiting for the morning
        "sent_times": st.get("sent_times", []),
        "told": st.get("told", {}),  # event key -> when it was handed to Telegram
        "day": st.get("day") or datetime.now().strftime("%Y-%m-%d"),
        "offset": st.get("offset"),
    }

    def save(now):
        save_json(HERE / "state.json", {"rules": rules.state(), "held": S["held"], "sent_times": S["sent_times"],
                                        "told": S["told"], "day": S["day"], "offset": S["offset"], "alive_at": now})

    now = time.time()
    alive_at, boot = st.get("alive_at"), boot_time()
    if alive_at is None or now - alive_at > BREAK_S or (boot and boot > alive_at):
        rules.resume(now)
        log("resume", away_min=round((now - alive_at) / 60, 1) if alive_at else None,
            booted=datetime.fromtimestamp(boot).isoformat(timespec="seconds") if boot else None)
    if S["offset"] is None:  # first run: start from the end of today's file, do not replay the past
        p = DONGLE / f"{S['day']}.jsonl"
        S["offset"] = p.stat().st_size if p.exists() else 0
        if not args.dry and cfg.get("chat_id") and "hello" not in S["told"]:
            S["told"]["hello"] = now
            save(now)
            ok = send(cfg["chat_id"], "🔔 Уведомления об инверторе включены, только вам. "
                                      "Ночью (23–8) — только важное: перегрев, перегрузка, 20 %, последний час.")
            log("hello", ok=ok)
    save(now)
    log("start", dry=args.dry, defer=cfg["defer"])

    def deliver(m, now):
        key = m.get("key") or f"{m['kind']}:{m['text']}"
        if key in S["told"]:
            log("already-told", kind=m["kind"], key=key)
            return
        tok = token(m["kind"], cfg["rules"]["levels"])
        if tok in cfg["off"]:
            log("off-by-owner", kind=m["kind"])
            return
        if tok in cfg["defer"]:
            log("deferred-to-alert-py", kind=m["kind"], text=m["text"])
            return
        if is_night(now, *cfg["night"]) and not (tok in cfg["night_kinds"] and (tok != "data" or m["important"])):
            S["told"][key] = now
            S["held"].append(f"{clock(now)} {m['text']}")
            save(now)
            log("held", kind=m["kind"])
            return
        recent = [x for x in S["sent_times"] if now - x < 3600]
        if len(recent) >= cfg["max_per_hour"] and not m["important"]:
            log("rate-limited", kind=m["kind"])
            return
        S["told"][key] = now
        S["sent_times"].append(now)
        save(now)  # written down before it goes: a crash after this line can lose it, never repeat it
        if args.dry:
            print("DRY", m)
            ok = True
        else:
            ok = send(cfg["chat_id"], m["text"])
        log("sent" if ok else "failed", kind=m["kind"], key=key, text=m["text"])

    last_loop = now
    while True:
        now = time.time()
        try:
            if now - last_loop > BREAK_S:  # the Mac slept, or this process was stopped
                rules.resume(now)
                log("resume", away_min=round((now - last_loop) / 60, 1), note="clock jump inside the loop")
            today = datetime.now().strftime("%Y-%m-%d")
            if today != S["day"]:  # finish yesterday's file, then start today's from the top
                rows, _ = readings(DONGLE / f"{S['day']}.jsonl", S["offset"])
                S["day"], S["offset"] = today, 0
                for rd in rows:
                    for m in rules.step(rd):
                        deliver(m, now)
            rows, S["offset"] = readings(DONGLE / f"{S['day']}.jsonl", S["offset"])
            for rd in rows:
                for m in rules.step(rd):
                    deliver(m, now)
            sched.refresh(now, log)
            for m in rules.tick(now, why_silent(now), sched.back_at(now)):
                deliver(m, now)
            if S["held"] and not is_night(now, *cfg["night"]):
                text = "🌙 Ночью:\n" + "\n".join(S["held"])
                held, S["held"] = S["held"], []
                save(now)
                ok = True if args.dry else send(cfg["chat_id"], text)
                log("morning" if ok else "failed", text=text)
                if not ok:  # Telegram said no: keep them for the next try
                    S["held"] = held + S["held"]
            S["sent_times"] = [x for x in S["sent_times"] if now - x < 3600]
            S["told"] = {k: v for k, v in S["told"].items() if k == "hello" or now - v < KEEP_KEYS_S}
            save(now)
        except Exception as e:  # logged, and the loop goes on: a crash loop under launchd repeats messages
            log("loop-error", err=type(e).__name__, where=traceback.format_exc(limit=3)[-600:])
        last_loop = now
        time.sleep(LOOP_S)


if __name__ == "__main__":
    if args.replay:
        replay(args.replay, args.since)
    else:
        main()
