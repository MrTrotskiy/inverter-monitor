#!/usr/bin/env python3
"""Read one live sample from the inverter and optionally log it.

Usage:
    python3 dess_poll.py            # print the reading
    python3 dess_poll.py --append   # also append a line to data/dessmonitor-log.jsonl
    python3 dess_poll.py --raw      # dump every field the API returns
"""

import datetime
import json
import sys
from pathlib import Path

import dess_api
from dess_api import localconfig

# the device in the DessMonitor account, from config.json (cloud.device): pn, sn, devcode, devaddr
DEVICE = {**{k: localconfig.get(f"cloud.device.{k}") for k in ("pn", "devcode", "devaddr", "sn")}, "i18n": "en"}

LOG_PATH = Path(__file__).parent.parent / "data" / "dessmonitor-log.jsonl"

# Field titles vary between firmware builds, so match on keywords instead of
# exact names. First matching rule wins.
FIELD_RULES = (
    ("battery_v", ("battery", "voltage")),
    ("battery_a", ("battery", "current")),
    # Direct battery draw. Far better than load + an estimated inverter idle
    # figure, because it already includes the inverter's own consumption.
    ("battery_w", ("battery", "power")),
    ("load_pct", ("load", "percent")),
    ("temp_c", ("dc", "module")),
    ("load_w", ("output", "active", "power")),
    ("load_va", ("output", "apparent", "power")),
    ("grid_hz", ("grid", "frequency")),
    ("grid_w", ("grid", "power")),
    ("pv_w", ("pv", "power")),
)


def _number(text):
    try:
        return float(str(text).split()[0])
    except (ValueError, IndexError):
        return None


def _slug(title):
    """Normalise an API field title into a stable snake_case key."""
    out = []
    for char in str(title).lower():
        out.append(char if char.isalnum() else "_")
    return "_".join(part for part in "".join(out).split("_") if part)


def extract(points):
    """Map the API's title/value pairs onto log field names.

    Every field is kept. Known ones get our canonical names so the rest of the
    project can rely on them; anything unrecognised is stored under a slug of
    its API title rather than discarded, because a discharge we have not
    analysed yet may turn on a field we did not think mattered.
    """
    reading = {}
    claimed = set()
    for point in points:
        title = str(point.get("title", "")).lower()
        for name, keywords in FIELD_RULES:
            if name in reading:
                continue
            if all(word in title for word in keywords):
                value = _number(point.get("val"))
                if value is not None:
                    reading[name] = value
                    claimed.add(id(point))
                break

    for point in points:
        if id(point) in claimed:
            continue
        key = _slug(point.get("title"))
        if not key or key in reading:
            continue
        value = _number(point.get("val"))
        # Keep non-numeric fields verbatim: operating mode, output priority and
        # charger priority explain WHY a reading looks the way it does.
        reading[key] = value if value is not None else str(point.get("val", "")).strip()
    return reading


def main():
    creds = dess_api.load_token_autorenew()
    points = dess_api.call("queryDeviceLastData", DEVICE, creds)["dat"]

    if "--raw" in sys.argv:
        for point in points:
            print(f"{point.get('title')!r:55} = {point.get('val')} {point.get('unit', '')}")
        return

    reading = extract(points)
    if not reading:
        sys.exit("No known fields matched. Run with --raw to see what the API returns.")

    # The cloud occasionally returns a physically impossible sample (16.3 V on a
    # 12 V bank at 0 A, seen 2026-09-18 10:55). Flag rather than drop it: the
    # row is evidence that the source is unreliable, but nothing downstream
    # should integrate it.
    volts = reading.get("battery_v")
    if volts is not None and not 9.0 <= volts <= 15.6:
        reading["implausible"] = True

    now = datetime.datetime.now(datetime.timezone.utc)
    whole = {"load_w", "load_va", "grid_w", "pv_w", "battery_w", "load_pct", "temp_c"}
    row = {
        "ts": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "local": datetime.datetime.now().strftime("%H:%M"),
        **{k: (int(v) if k in whole and isinstance(v, float) else v)
           for k, v in reading.items()},
        "note": "IMPLAUSIBLE - excluded from analysis" if reading.get("implausible")
                else "polled via API",
    }

    for key in ("battery_v", "battery_a", "battery_w", "load_w", "load_va",
                "grid_w", "grid_hz", "temp_c"):
        if key in row:
            print(f"{key:<12} {row[key]}")

    if "--append" in sys.argv:
        # A datalogger that stops reporting leaves the cloud serving its last
        # sample forever (980 copies of 2026-10-01 17:51 were logged that way),
        # so a reading whose device timestamp has not moved is not new data.
        stamp = row.get("timestamp")
        lines = LOG_PATH.read_text().splitlines() if LOG_PATH.exists() else []
        if stamp and lines and json.loads(lines[-1]).get("timestamp") == stamp:
            print(f"device timestamp unchanged ({stamp}), not appended", file=sys.stderr)
            return
        with LOG_PATH.open("a") as handle:
            handle.write(json.dumps(row) + "\n")
        print(f"\nappended to {LOG_PATH}")


if __name__ == "__main__":
    main()
