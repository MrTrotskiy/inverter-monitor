#!/usr/bin/env python3
"""Integrate energy drawn from the battery bank over an off-grid window.

The inverter's own "Battery percentage" is a voltage mapping, not a coulomb
counter, so it cannot serve as a fuel gauge. This script integrates the
measured load instead and adds the inverter's measured idle draw.

Usage:
    python3 energy.py [path/to/log.jsonl]
"""

import datetime
import json
import sys
from pathlib import Path

# Bank: 2x Ritar 12.8V 100Ah LiFePO4 in parallel.
NOMINAL_WH = 2560
# Do not discharge below ~10%; that floor defines the usable reserve.
USABLE_WH = NOMINAL_WH * 0.9
# Inverter idle draw, measured three times: load 51W -> battery 72W,
# load 88W -> battery 107W, load 17W -> battery 36W.
INVERTER_IDLE_W = 20
# Outage of 2026-10-23. The datalogger had been silent since 2026-10-01 and its
# first sample (15:33:51 local, UTC+3) is already off-grid at 13.3 V, so the bank
# was near full and the cut came at or shortly before it. True start unconfirmed.
DISCHARGE_START = datetime.datetime(2026, 10, 23, 12, 33)


def load_samples(path):
    """Return off-grid samples as (utc_time, load_w, local_label, battery_v)."""
    samples = []
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        if row.get("grid_hz") != 0 or row.get("load_w") is None:
            continue
        if row.get("implausible") or "IMPLAUSIBLE" in str(row.get("note", "")):
            continue
        ts = datetime.datetime.strptime(row["ts"], "%Y-%m-%dT%H:%M:%SZ")
        samples.append((ts, row["load_w"], row.get("local"), row.get("battery_v")))
    samples.sort(key=lambda s: s[0])
    samples = [s for s in samples if s[0] >= DISCHARGE_START]
    # The first cloud sample lands ~34 min after the grid was cut; carry its
    # load back to the cut so that window is not silently dropped.
    if samples and samples[0][0] > DISCHARGE_START:
        local = DISCHARGE_START + datetime.timedelta(hours=3)
        samples.insert(0, (DISCHARGE_START, samples[0][1], local.strftime("%H:%M"), None))
    return samples


def integrate_wh(samples):
    """Trapezoidal integral of load power over time, in watt-hours."""
    total = 0.0
    for (t1, w1, _, _), (t2, w2, _, _) in zip(samples, samples[1:]):
        hours = (t2 - t1).total_seconds() / 3600
        total += (w1 + w2) / 2 * hours
    return total


def report(samples):
    first, last = samples[0], samples[-1]
    hours = (last[0] - first[0]).total_seconds() / 3600
    load_wh = integrate_wh(samples)
    idle_wh = INVERTER_IDLE_W * hours
    spent_wh = load_wh + idle_wh
    drain_w = last[1] + INVERTER_IDLE_W

    print(f"off-grid for        {hours:.1f} h  ({first[2]} -> {last[2]})")
    print(f"average load        {load_wh / hours:.0f} W")
    print(f"to the load         {load_wh:.0f} Wh")
    print(f"inverter idle       {idle_wh:.0f} Wh")
    print(f"SPENT               {spent_wh:.0f} Wh = {spent_wh / NOMINAL_WH * 100:.0f}% of {NOMINAL_WH}")
    print(f"left (to empty)     {NOMINAL_WH - spent_wh:.0f} Wh")
    print(f"left (to 10% floor) {USABLE_WH - spent_wh:.0f} Wh")
    print(f"hours left @ {last[1]}W   {(USABLE_WH - spent_wh) / drain_w:.1f} h")

    # Sampling is every ~30 min and the idle draw is one measured figure,
    # so quote a range rather than a false-precision single number.
    print("\nuncertainty range:")
    for idle, load_factor in ((15, 0.8), (20, 1.0), (25, 1.2)):
        spent = load_wh * load_factor + idle * hours
        print(
            f"  idle {idle}W, load x{load_factor}: "
            f"{spent:.0f} Wh ({spent / NOMINAL_WH * 100:.0f}%), "
            f"{USABLE_WH - spent:.0f} Wh left"
        )

    print("\ndisplayed voltage vs energy spent:")
    running = 0.0
    for (t1, w1, _, _), (t2, w2, label, volts) in zip(samples, samples[1:]):
        running += (w1 + w2) / 2 * (t2 - t1).total_seconds() / 3600
        if volts:
            spent_here = running + INVERTER_IDLE_W * (t2 - first[0]).total_seconds() / 3600
            print(f"  {label:>5}  {volts:>5} V  at {w2:>3} W load  |  {spent_here:>4.0f} Wh spent")


if __name__ == "__main__":
    default_log = Path(__file__).parent.parent / "data" / "dessmonitor-log.jsonl"
    report(load_samples(sys.argv[1] if len(sys.argv) > 1 else default_log))
