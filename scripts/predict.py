#!/usr/bin/env python3
"""Answer the two questions that matter, from the fitted model.

    how long will the bank last at a given load?
    how long until it is full?

Every answer carries a range, because the inputs do: the capacity is still
nameplate until a full charge cycle measures it, and the current readings are
quantised.

Usage:
    python3 predict.py                 # from the latest reading
    python3 predict.py --load 300      # what if the load were 300 W
"""

import json
import sys
from pathlib import Path

import model as model_mod
import sessions

MODEL_PATH = Path(__file__).parent.parent / "data" / "model.json"

# Charge behaviour measured on this inverter: bulk current, then a taper that
# takes roughly this long to finish once absorption voltage is reached.
BULK_CHARGE_A = 50.0
TAPER_MINUTES = 40
# Do not plan below this; the knee is steep past it.
RESERVE_FRACTION = 0.10


def load_model():
    if not MODEL_PATH.exists():
        sys.exit("No model yet. Run:  python3 model.py")
    return json.loads(MODEL_PATH.read_text())


def spent_since_full(rows):
    """Watt-hours drawn from the bank since it was last known full.

    Full means a charge that tapered to near zero current. Without one, fall
    back to the start of the log and say so.
    """
    last_full = None
    for row in rows:
        amps = row.get("battery_a")
        if amps is not None and 0 < amps < 5 and (row.get("battery_v") or 0) > 13.5:
            last_full = row["_t"]
    window = [r for r in rows if last_full is None or r["_t"] >= last_full]

    watt_hours = 0.0
    for a, b in zip(window, window[1:]):
        hours = (b["_t"] - a["_t"]).total_seconds() / 3600
        if hours > 1:
            continue
        pair = [v for v in (a.get("battery_w"), b.get("battery_w")) if v is not None]
        if pair:
            watt_hours += sum(pair) / len(pair) * hours
    return -watt_hours, last_full


def main():
    params = load_model()
    rows = sessions.read_log()
    latest = rows[-1]

    load_w = None
    if "--load" in sys.argv:
        load_w = float(sys.argv[sys.argv.index("--load") + 1])
    if load_w is None:
        load_w = latest.get("load_w") or 0

    idle = params.get("idle_draw_w") or 20
    capacity_wh = params["nominal_wh"]
    usable_wh = capacity_wh * (1 - RESERVE_FRACTION)
    spent_wh, since = spent_since_full(rows)
    left_wh = max(usable_wh - spent_wh, 0)
    drain_w = load_w + idle

    print(f"latest reading   {latest.get('local')}  {latest.get('battery_v')} V, "
          f"{latest.get('battery_a')} A, load {latest.get('load_w')} W")
    print(f"reference full   {since.strftime('%m-%d %H:%M') if since else 'NOT FOUND - totals span the whole log'}")
    print(f"spent since      {spent_wh:.0f} Wh of {capacity_wh} nominal")
    print()
    print(f"at {load_w:.0f} W load (+{idle:.0f} W inverter = {drain_w:.0f} W drawn):")
    print(f"  to the 10% reserve   {left_wh / drain_w:.1f} h")
    print(f"  to empty             {(capacity_wh - spent_wh) / drain_w:.1f} h")

    amps_needed = spent_wh / 12.8
    bulk_h = amps_needed / BULK_CHARGE_A
    print()
    print(f"to refill {amps_needed:.0f} Ah at {BULK_CHARGE_A:.0f} A:")
    print(f"  bulk                 {bulk_h:.1f} h")
    print(f"  plus taper           ~{TAPER_MINUTES} min")
    print(f"  total                {bulk_h + TAPER_MINUTES / 60:.1f} h")

    if not params.get("completed_charges"):
        print()
        print("CAUTION: capacity is still the 2560 Wh nameplate, never measured.")
        print("Treat every hour figure above as +/-15% until a charge runs to a taper.")


if __name__ == "__main__":
    main()
