"""This home's settings for the Python programs: config.json at the repository's root (ignored by git; see
config.example.json). get("dongle.ip", default) answers the value or the default; nothing here is printed."""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATH = Path(os.environ.get("INVERTER_CONFIG") or ROOT / "config.json")


def load():
    try:
        return json.loads(PATH.read_text())
    except (OSError, ValueError):
        return {}


def get(key, default=None):
    v = load()
    for k in key.split("."):
        if not isinstance(v, dict) or k not in v:
            return default
        v = v[k]
    return default if v in (None, "") else v


def path(key, default=None):
    v = get(key, default)
    return Path(os.path.expanduser(v)) if v else None
