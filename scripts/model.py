"""Fit this specific system's parameters from its own logged behaviour.

Nothing here is taken from a datasheet. Every number is regressed from readings
this inverter produced, because the inverter's voltmeter is offset and its
current readings are quantised, so generic figures do not transfer.

Writes data/model.json. Run it again whenever new cycles have accumulated.
"""

import json
import statistics
from pathlib import Path

import sessions

MODEL_PATH = Path(__file__).parent.parent / "data" / "model.json"

NOMINAL_AH = 200
NOMINAL_WH = 2560
# Battery current is quantised in 2.8 A steps, truncated toward zero, so on
# average each reading understates the true current by half a step.
CURRENT_STEP_A = 2.8
TRUNCATION_BIAS_A = CURRENT_STEP_A / 2


def fit_resistance(rows):
    """Pack + wiring resistance, from voltage swings against current swings.

    V = OCV - I*R. Over a few minutes OCV barely moves, so between two nearby
    samples the voltage difference is almost entirely the current difference
    times R. Needs a big current step to beat the 0.1 V display resolution.
    """
    estimates = []
    for a, b in zip(rows, rows[1:]):
        minutes = (b["_t"] - a["_t"]).total_seconds() / 60
        if not 0 < minutes <= 20:
            continue
        va, vb = a.get("battery_v"), b.get("battery_v")
        ia, ib = a.get("battery_a"), b.get("battery_a")
        if None in (va, vb, ia, ib):
            continue
        d_amps = ib - ia
        if abs(d_amps) < 4:
            continue
        estimates.append(-(vb - va) / d_amps)

    if len(estimates) < 3:
        return None, len(estimates)
    return statistics.median(estimates), len(estimates)


def fit_idle_draw(rows):
    """The inverter's own consumption, as watts drawn beyond the load."""
    estimates = []
    for row in rows:
        amps, load = row.get("battery_a"), row.get("load_w")
        volts = row.get("battery_v")
        if None in (amps, load, volts) or amps >= 0:
            continue
        # Undo the truncation before comparing against the load.
        true_amps = abs(amps) + TRUNCATION_BIAS_A
        estimates.append(true_amps * volts - load)

    if len(estimates) < 5:
        return None, len(estimates)
    return statistics.median(estimates), len(estimates)


def ocv(row, resistance):
    """Open-circuit voltage implied by a reading, once IR sag is removed."""
    volts, amps = row.get("battery_v"), row.get("battery_a")
    if volts is None or resistance is None:
        return None
    if amps is None:
        return volts
    true_amps = amps - TRUNCATION_BIAS_A if amps > 0 else amps + TRUNCATION_BIAS_A
    # Discharge current is negative, so this adds back the sag either way.
    return round(volts - true_amps * resistance, 3)


def measured_capacity(all_sessions):
    """Ah returned by a charge that ran to a taper — what the bank really holds.

    Only a charge that ends near zero current has reached full, and only then
    does the integral mean "this is what had been taken out".
    """
    completed = []
    for session in all_sessions:
        if session["kind"] != "charge":
            continue
        if abs(session["rows"][-1].get("battery_a") or 99) > 5:
            continue
        completed.append(session)
    return completed


def build():
    rows = sessions.read_log()
    all_sessions = sessions.segment(rows)

    resistance, r_n = fit_resistance(rows)
    idle, idle_n = fit_idle_draw(rows)
    charges = measured_capacity(all_sessions)

    model = {
        "nominal_ah": NOMINAL_AH,
        "nominal_wh": NOMINAL_WH,
        "resistance_ohm": round(resistance, 4) if resistance else None,
        "resistance_samples": r_n,
        "idle_draw_w": round(idle, 1) if idle else None,
        "idle_samples": idle_n,
        "completed_charges": [
            {"when": c["local"], "ah": round(c["battery_ah"], 1),
             "wh": round(c["battery_wh"])}
            for c in charges
        ],
        "readings": len(rows),
        "sessions": len(all_sessions),
    }

    # Say plainly what the data does not yet support.
    missing = []
    if resistance is None:
        missing.append("resistance: needs samples with a >4 A current step")
    if idle is None:
        missing.append("idle draw: needs more discharge samples")
    if not charges:
        missing.append("usable capacity: needs one charge that runs to a taper")
    model["not_yet_measurable"] = missing
    return model


if __name__ == "__main__":
    model = build()
    MODEL_PATH.write_text(json.dumps(model, indent=2) + "\n")
    print(json.dumps(model, indent=2))
    if model["not_yet_measurable"]:
        print("\nStill unmeasured:")
        for item in model["not_yet_measurable"]:
            print(f"  - {item}")
