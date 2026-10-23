#!/usr/bin/python3
"""Checks of notify.py as launchd runs it: the real script, in a sandbox, with a fake Telegram.

Each check copies notifier/*.py into a temp tree (tmp/notifier, tmp/data/dongle, tmp/data/notify), points HOME at
the tree (so the bot token it finds is a fake one), and loads a sitecustomize that replaces urllib's urlopen: every
"send" is written to tmp/sent.jsonl and answered {"ok": true}. Nothing reaches the network.

Run: /usr/bin/python3 notifier/check_notify.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent

FAKE_TELEGRAM = '''
import json, os, urllib.request, urllib.parse
class _R:
    def __init__(self, b): self.b = b
    def read(self): return self.b
    def __enter__(self): return self
    def __exit__(self, *a): return False
def _fake(url, data=None, timeout=None, **kw):
    u = url if isinstance(url, str) else url.full_url
    if "api.telegram.org" not in u:
        raise OSError("sandbox: no network")
    q = urllib.parse.parse_qs((data or b"").decode())
    with open(os.environ["FAKE_SENT"], "a") as f:
        f.write(json.dumps({"chat_id": q.get("chat_id", [""])[0], "text": q.get("text", [""])[0]}, ensure_ascii=False) + "\\n")
    return _R(b'{"ok": true}')
urllib.request.urlopen = _fake
'''


class Sandbox:
    def __init__(self):
        self.root = Path(tempfile.mkdtemp(prefix="notify-check-"))
        (self.root / "notifier").mkdir()
        for p in HERE.glob("*.py"):
            if not p.name.startswith("check_"):
                shutil.copy(p, self.root / "notifier" / p.name)
        (self.root / "data" / "dongle").mkdir(parents=True)
        (self.root / "data" / "notify").mkdir(parents=True)
        shutil.copytree(HERE.parent / "common", self.root / "common", ignore=shutil.ignore_patterns("__pycache__"))
        (self.root / "bot.env").write_text("BOT_TOKEN=000:fake\n")
        # the sandbox's own config.json: never the real one, never the real token
        (self.root / "config.json").write_text(json.dumps({"telegram": {"botEnv": str(self.root / "bot.env")}}))
        (self.root / "site").mkdir()
        (self.root / "site" / "sitecustomize.py").write_text(FAKE_TELEGRAM)
        (self.root / "data" / "notify" / "config.json").write_text(json.dumps({"chat_id": "42", "defer": []}))
        self.day = datetime.now().strftime("%Y-%m-%d")
        (self.root / "data" / "dongle" / f"{self.day}.jsonl").write_text("")

    def state(self, obj):
        (self.root / "data" / "notify" / "state.json").write_text(json.dumps(obj))

    def run(self, seconds=3.0):
        """One life of the service: start notify.py, let it run `seconds` (or die), stop it."""
        env = {**os.environ, "HOME": str(self.root), "PYTHONPATH": str(self.root / "site"),
               "FAKE_SENT": str(self.root / "sent.jsonl")}
        p = subprocess.Popen([sys.executable, str(self.root / "notifier" / "notify.py")], env=env,
                             stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            p.wait(seconds)
        except subprocess.TimeoutExpired:
            p.terminate()
            p.wait(5)
        return p.returncode

    def sent(self):
        f = self.root / "sent.jsonl"
        return [json.loads(x) for x in f.read_text().splitlines()] if f.exists() else []

    def close(self):
        shutil.rmtree(self.root, ignore_errors=True)


def rules_state(last_t, mode=2):
    return {"mode": mode, "last_t": last_t, "full": True}


def check_restarts_do_not_repeat_a_notice():
    """The collector has been silent 20 min while the Mac was on: one notice, then launchd restarts the service
    (crash or not) three times within a minute and a half. He must get the notice once."""
    sb = Sandbox()
    try:
        now = time.time()
        sb.state({"rules": {**rules_state(now - 20 * 60), "watch_since": now - 3600}, "held": [], "sent_times": [],
                  "day": sb.day, "offset": 0, "alive_at": now - 15})
        for _ in range(3):
            sb.run()
        s = sb.sent()
        print(f"    sent {len(s)}: {[x['text'][:40] for x in s]}")
        return len(s) == 1
    finally:
        sb.close()


def check_mac_off_is_not_an_inverter_fault():
    """The Mac mini was off 18:18 -> 19:58: the notifier starts with a state 100 min old. Nothing to tell him."""
    sb = Sandbox()
    try:
        now = time.time()
        sb.state({"rules": rules_state(now - 100 * 60), "held": [], "sent_times": [], "day": sb.day, "offset": 0,
                  "alive_at": now - 100 * 60})
        sb.run()
        sb.run()
        s = sb.sent()
        print(f"    sent {len(s)}: {[x['text'][:50] for x in s]}")
        return len(s) == 0
    finally:
        sb.close()


def check_only_his_chat():
    """Whatever it sends goes to the configured chat only."""
    sb = Sandbox()
    try:
        now = time.time()
        sb.state({"rules": {**rules_state(now - 20 * 60), "watch_since": now - 3600}, "held": [], "sent_times": [],
                  "day": sb.day, "offset": 0, "alive_at": now - 15})
        sb.run()
        return all(x["chat_id"] == "42" for x in sb.sent())
    finally:
        sb.close()


if __name__ == "__main__":
    checks = [v for k, v in sorted(globals().items()) if k.startswith("check_")]
    ok = 0
    for c in checks:
        try:
            good = c()
        except Exception as e:
            good = False
            print("  error", c.__name__, repr(e))
        ok += bool(good)
        print("✓" if good else "✗", c.__name__)
    print(f"{ok}/{len(checks)}")
    sys.exit(0 if ok == len(checks) else 1)
