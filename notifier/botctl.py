#!/usr/bin/python3
"""What the admin's Бот page asks of the notifier, apart from its config:

  botctl.py test     send one test message to the owner's chat now -> prints {"ok": true|false, "why": ...}

The token is read from the file config.json `telegram.botEnv` names, at send time, and never printed or logged; the
chat is data/notify/config.json `chat_id` or config.json `telegram.chatId`. For tests: INVERTER_DATA, BOT_ENV,
TELEGRAM_API.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("INVERTER_DATA") or ROOT / "data")
sys.path.insert(0, str(ROOT / "common"))
import localconfig  # noqa: E402

BOT_ENV = Path(os.environ["BOT_ENV"]) if os.environ.get("BOT_ENV") else (localconfig.path("telegram.botEnv") or Path("/nonexistent"))
API = os.environ.get("TELEGRAM_API", "https://api.telegram.org")


def token():
    try:
        for line in BOT_ENV.read_text().splitlines():
            if line.startswith("BOT_TOKEN="):
                return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        return None
    return None


def test():
    try:
        cfg = json.loads((DATA / "notify" / "config.json").read_text())
    except (OSError, ValueError):
        cfg = {}
    chat, tok = cfg.get("chat_id") or localconfig.get("telegram.chatId"), token()
    if not chat or not tok:
        return {"ok": False, "why": "нет чата или токена бота"}
    on = "включены" if os.environ.get("NOTIFIER_ON") == "1" else "выключены"
    text = f"🔔 Проверка из админки, {datetime.now().strftime('%H:%M')}: бот на связи. Уведомления сейчас {on}."
    data = urllib.parse.urlencode({"chat_id": chat, "text": text}).encode()
    try:
        with urllib.request.urlopen(f"{API}/bot{tok}/sendMessage", data, timeout=20) as r:
            ok = bool(json.loads(r.read()).get("ok"))
        return {"ok": ok, "why": None if ok else "Telegram не принял"}
    except Exception as e:  # never str(e): it may carry the URL with the token
        return {"ok": False, "why": f"ошибка отправки: {type(e).__name__}"}


if __name__ == "__main__":
    if sys.argv[1:] == ["test"]:
        print(json.dumps(test(), ensure_ascii=False))
    else:
        print("usage: botctl.py test", file=sys.stderr)
        sys.exit(1)
