"""Read the reading log and cut it into charge / discharge / idle sessions.

Everything downstream depends on this segmentation, so it is deliberately
conservative: a session ends when the sign of the battery current changes or
when samples stop arriving for long enough that interpolating across the hole
would invent energy that was never measured.
"""

import datetime
import json
from pathlib import Path

LOG_PATH = Path(__file__).parent.parent / "data" / "dessmonitor-log.jsonl"

# Cron samples every 5 min. Anything beyond this is a real outage, not jitter,
# and must not be integrated across.
MAX_GAP_MIN = 45
# Below this the current reading is indistinguishable from zero: the inverter
# quantises battery current in 2.8 A steps.
CURRENT_DEADBAND_A = 1.5


def read_log(path=None):
    """Return every logged reading, oldest first, with parsed timestamps."""
    rows = []
    for line in Path(path or LOG_PATH).read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        if "ts" not in row:
            continue
        if row.get("implausible") or "IMPLAUSIBLE" in str(row.get("note", "")):
            continue
        row["_t"] = datetime.datetime.strptime(row["ts"], "%Y-%m-%dT%H:%M:%SZ")
        rows.append(row)
    rows.sort(key=lambda r: r["_t"])
    return rows


def classify(row):
    """One of 'charge', 'discharge' or 'idle' for a single reading."""
    amps = row.get("battery_a")
    if amps is None:
        # Older rows predate the API and carry no current. Fall back to whether
        # the grid was present.
        return "idle" if row.get("grid_hz") else "discharge"
    if amps > CURRENT_DEADBAND_A:
        return "charge"
    if amps < -CURRENT_DEADBAND_A:
        return "discharge"
    return "idle"


def segment(rows=None, max_gap_min=MAX_GAP_MIN):
    """Group readings into sessions of one kind, split on gaps."""
    rows = rows if rows is not None else read_log()
    sessions, current, kind = [], [], None

    for row in rows:
        row_kind = classify(row)
        gap_min = (
            (row["_t"] - current[-1]["_t"]).total_seconds() / 60 if current else 0
        )
        if current and (row_kind != kind or gap_min > max_gap_min):
            sessions.append({"kind": kind, "rows": current})
            current, kind = [], None
        if not current:
            kind = row_kind
        current.append(row)

    if current:
        sessions.append({"kind": kind, "rows": current})

    for session in sessions:
        _annotate(session)
    return [s for s in sessions if len(s["rows"]) >= 2]


def _annotate(session):
    """Attach duration and integrated energy to a session."""
    rows = session["rows"]
    session["start"], session["end"] = rows[0]["_t"], rows[-1]["_t"]
    session["hours"] = (session["end"] - session["start"]).total_seconds() / 3600
    session["local"] = f"{rows[0].get('local', '?')}-{rows[-1].get('local', '?')}"

    amp_hours = watt_hours = load_wh = 0.0
    for a, b in zip(rows, rows[1:]):
        hours = (b["_t"] - a["_t"]).total_seconds() / 3600
        if hours > max(MAX_GAP_MIN, 1) / 60:
            continue
        amp_hours += _mean(a.get("battery_a"), b.get("battery_a")) * hours
        watt_hours += _mean(a.get("battery_w"), b.get("battery_w")) * hours
        load_wh += _mean(a.get("load_w"), b.get("load_w")) * hours

    session["battery_ah"] = amp_hours
    session["battery_wh"] = watt_hours
    session["load_wh"] = load_wh
    session["v_start"] = rows[0].get("battery_v")
    session["v_end"] = rows[-1].get("battery_v")


def _mean(x, y):
    values = [v for v in (x, y) if v is not None]
    return sum(values) / len(values) if values else 0.0


if __name__ == "__main__":
    print(f"{'kind':<10}{'when':<16}{'hours':>6}{'Ah':>8}{'Wh':>8}{'V start':>9}{'V end':>7}{'n':>5}")
    for s in segment():
        print(
            f"{s['kind']:<10}{s['local']:<16}{s['hours']:>6.1f}"
            f"{s['battery_ah']:>8.1f}{s['battery_wh']:>8.0f}"
            f"{str(s['v_start']):>9}{str(s['v_end']):>7}{len(s['rows']):>5}"
        )
