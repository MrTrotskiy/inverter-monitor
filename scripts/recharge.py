#!/usr/bin/env python3
"""Measure how much charge the bank takes back after a discharge.

This is the honest measurement of what a discharge actually cost. The
discharge-side figure from energy.py is an integral of load plus an estimated
inverter idle draw; this one counts what physically goes back in.

Accuracy is far better here than on discharge: battery current is quantised in
2.8 A steps and truncated toward zero, so at a ~50 A charge the error is a few
percent, against tens of percent at the 3-11 A currents seen while discharging.
Being a truncation, it biases the result LOW — the true figure is a little
higher than what this prints.

Usage:
    python3 recharge.py [path/to/log.jsonl]
"""

import datetime
import json
import sys
from pathlib import Path

NOMINAL_AH = 200
NOMINAL_WH = 2560


def charging_samples(path):
    """Samples where the grid is present and current flows INTO the battery."""
    rows = []
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        amps = row.get("battery_a")
        if amps is None or amps <= 0:
            continue
        rows.append((
            datetime.datetime.strptime(row["ts"], "%Y-%m-%dT%H:%M:%SZ"),
            amps,
            row.get("battery_v"),
            row.get("local"),
        ))
    rows.sort(key=lambda r: r[0])
    return rows


def split_sessions(rows, max_gap_minutes=30):
    """Group samples into separate charge sessions."""
    sessions, current = [], []
    for row in rows:
        if current and (row[0] - current[-1][0]).total_seconds() > max_gap_minutes * 60:
            sessions.append(current)
            current = []
        current.append(row)
    if current:
        sessions.append(current)
    return sessions


def report(session):
    amp_hours = watt_hours = 0.0
    for (t1, a1, v1, _), (t2, a2, v2, _) in zip(session, session[1:]):
        hours = (t2 - t1).total_seconds() / 3600
        amp_hours += (a1 + a2) / 2 * hours
        if v1 and v2:
            watt_hours += (a1 * v1 + a2 * v2) / 2 * hours

    hours = (session[-1][0] - session[0][0]).total_seconds() / 3600
    print(f"charge session   {session[0][3]} -> {session[-1][3]}  ({hours:.1f} h)")
    print(f"peak current     {max(r[1] for r in session):.1f} A")
    print(f"last current     {session[-1][1]:.1f} A   (a taper to ~0 means full)")
    print(f"RETURNED         {amp_hours:.1f} Ah = {watt_hours:.0f} Wh")
    print(f"                 {amp_hours / NOMINAL_AH * 100:.0f}% of {NOMINAL_AH} Ah nominal")
    if session[-1][1] > 5:
        print("\nStill charging — this is a running total, not the final figure.")
    else:
        print(f"\nIf the bank started full, this is what the discharge really cost.")
        print(f"Compare against the discharge-side estimate from energy.py.")


if __name__ == "__main__":
    default_log = Path(__file__).parent.parent / "data" / "dessmonitor-log.jsonl"
    rows = charging_samples(sys.argv[1] if len(sys.argv) > 1 else default_log)
    if not rows:
        sys.exit("No charging samples in the log yet (battery current is still negative).")
    for session in split_sessions(rows):
        report(session)
        print()
