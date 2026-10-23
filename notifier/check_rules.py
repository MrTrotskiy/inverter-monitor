#!/usr/bin/python3
"""Checks of rules.py on made-up series (5 s readings). Run: /usr/bin/python3 notifier/check_rules.py"""
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from rules import Rules  # noqa: E402

T0 = datetime(2026, 10, 24, 15, 0, 0).astimezone()


def rd(sec, mode=2, out_w=60, out_va=80, bat_a=0.0, temp=25):
    return {"t": (T0 + timedelta(seconds=sec)).isoformat(), "mode": mode, "out_w": out_w, "out_va": out_va,
            "bat_v": 13.0, "bat_a": bat_a, "bat_w": int(bat_a * 13), "temp_c": temp, "grid_v": 0 if mode == 3 else 220}


def run(series, rules=None):
    r = rules or Rules()
    out = []
    for x in series:
        out += r.step(x)
        out += r.tick(datetime.fromisoformat(x["t"]).timestamp())
    return r, out


def kinds(msgs):
    return [m["kind"] for m in msgs]


def check_outage_then_charge():
    s = [rd(i * 5) for i in range(12)]  # grid
    s += [rd(60 + i * 5, mode=3, out_w=100, bat_a=-8.4) for i in range(12 * 120)]  # 2 h on battery at 100 W
    t = 60 + 12 * 120 * 5
    s += [rd(t + i * 5, bat_a=50.4) for i in range(12 * 20)]  # 20 min at 50 A
    t += 12 * 20 * 5
    s += [rd(t + i * 5, bat_a=0) for i in range(12 * 6)]  # quiet: full
    r, m = run(s)
    k = kinds(m)
    full = next(x for x in m if x["kind"] == "full")
    return k[:3] == ["off", "on", "sum"] and k.count("full") == 1 and "17 А·ч" in full["text"] and r.s["spent_wh"] == 0


def check_outage_energy():
    s = [rd(0)] + [rd(5 + i * 5, mode=3, out_w=100) for i in range(12 * 60 + 1)] + [rd(5 + (12 * 60 + 1) * 5)]
    r, m = run(s)
    summ = next(x for x in m if x["kind"] == "sum")
    return "≈ 122 Вт·ч" in summ["text"]  # 1 h × (100 × 1.02 + 20) W


def check_blink_is_not_an_outage():
    s = [rd(0)] + [rd(5 + i * 5, mode=3) for i in range(6)] + [rd(40 + i * 5) for i in range(12 * 61)]
    r, m = run(s)
    return "off" not in kinds(m) and kinds(m).count("blink") == 1


def check_overload_once_and_important():
    s = [rd(i * 5, out_w=1300, out_va=2600) for i in range(10)]
    r, m = run(s)
    return kinds(m) == ["over"] and m[0]["important"]


def check_heat_after_a_minute():
    early = run([rd(i * 5, temp=52) for i in range(10)])[1]  # 45 s: not yet
    s = [rd(i * 5, temp=52) for i in range(14)]  # 65 s
    r, m = run(s)
    return early == [] and kinds(m) == ["hot"] and m[0]["important"]


def check_no_charge_after_grid_back():
    s = [rd(0)] + [rd(5 + i * 5, mode=3, out_w=100) for i in range(12 * 10)]
    t = 5 + 12 * 10 * 5
    s += [rd(t + i * 5, bat_a=0) for i in range(12 * 16)]
    r, m = run(s)
    return "nocharge" in kinds(m)


def check_float_blip_is_not_a_charge():
    s = [rd(i * 5, bat_a=5.6 if i == 3 else 0) for i in range(12 * 7)]
    r, m = run(s)
    return "full" not in kinds(m)


def check_levels_and_last_hour():
    # 1400 W on battery from a full bank of 2432 Wh: 50 % after ~51 min, the last hour after ~1 h 40 min
    s = [rd(0)] + [rd(5 + i * 5, mode=3, out_w=1100, out_va=1300) for i in range(12 * 110)]
    r, m = run(s)
    k = kinds(m)
    return "lvl50" in k and "fast" in k and "hour" in k and k.index("lvl50") < k.index("hour")


def check_silence():
    r = Rules()
    r.step(rd(0, mode=3))
    m = r.tick(datetime.fromisoformat(rd(11 * 60)["t"]).timestamp())
    back = r.step(rd(11 * 60 + 5, mode=3))
    return kinds(m) == ["data"] and m[0]["important"] and kinds(back)[:1] == ["data"]


def check_mac_off_gap_is_not_silence():
    """2026-10-23: last reading 18:18, the Mac off until 19:58. The gap is not the inverter's silence; readings
    that come back after it do not say "back" either. Ten minutes of watching with no reading: one notice."""
    r = Rules()
    r.step(rd(0))
    t = datetime.fromisoformat(rd(0)["t"]).timestamp()
    boot = t + 100 * 60
    r.resume(boot)
    at_boot = r.tick(boot + 30) + r.tick(boot + 5 * 60)
    still = r.step(rd(100 * 60 + 120))
    quiet = r.tick(boot + 9 * 60)
    # a second boot with no reading for 11 min: one notice that says the Mac is up and nothing was read
    r2 = Rules()
    r2.step(rd(0))
    r2.resume(boot)
    m = r2.tick(boot + 11 * 60) + r2.tick(boot + 12 * 60)
    return (at_boot == [] and still == [] and quiet == [] and kinds(m) == ["data"]
            and "Mac работает с" in m[0]["text"])


def check_outage_across_a_gap_says_what_it_does_not_know():
    """On mains before the Mac went off, on battery after it came back: the moment the power went is unknown."""
    r = Rules()
    r.step(rd(0))
    t = datetime.fromisoformat(rd(0)["t"]).timestamp()
    r.resume(t + 3600)
    _, m = run([rd(3600 + 10 + i * 5, mode=3) for i in range(20)], r)
    off = [x for x in m if x["kind"] == "off"]
    return len(off) == 1 and "после перерыва" in off[0]["text"] and "пропал в" not in off[0]["text"]


def check_wont_last_until_the_schedule_says_power_is_back():
    """On battery at 600 W from a full bank (≈ 3 h 45 min), power back by the schedule in 5 h: one important
    notice that names the hour and the load that would last; at 100 W (≈ 20 h) nothing."""
    def go(w):
        r = Rules()
        out = []
        series = [rd(0)] + [rd(5 + i * 5, mode=3, out_w=w) for i in range(12 * 20)]
        for x in series:
            t = datetime.fromisoformat(x["t"]).timestamp()
            out += r.step(x) + r.tick(t, back_at=datetime.fromisoformat(rd(0)["t"]).timestamp() + 5 * 3600)
        return out
    heavy = [m for m in go(600) if m["kind"] == "short"]
    light = [m for m in go(100) if m["kind"] == "short"]
    return len(heavy) == 1 and heavy[0]["important"] and "по графику свет в 20:00" in heavy[0]["text"] and "≤ 4" in heavy[0]["text"] and light == []


def check_schedule_back_at():
    from schedule import back_at, slots
    day = "2026-10-24"
    line = "1" * 28 + "2" * 4 + "1" * 16  # off 14:00-16:00
    days = {day: line}
    t = lambda hm: datetime.fromisoformat(f"{day}T{hm}:00").timestamp()
    data = {"regions": [{"cpu": "kyivska-oblast", "schedule": {"1.1": {day: {f"{i // 2:02d}:{30 * (i % 2):02d}": int(c) for i, c in enumerate(line)}}}}]}
    across = {day: "1" * 46 + "22", "2026-10-25": "22" + "1" * 46}  # off 23:00-01:00
    unknown = {day: "1" * 46 + "22"}  # tomorrow not published: the end is not known
    return (back_at(days, t("14:40")) == t("16:00") and back_at(days, t("13:10")) is None
            and slots(data, "kyivska-oblast", "1.1") == days
            and back_at(across, t("23:20")) == datetime.fromisoformat("2026-10-25T01:00:00").timestamp()
            and back_at(unknown, t("23:20")) is None)


def check_every_message_has_an_event_key():
    s = [rd(0)] + [rd(5 + i * 5, mode=3, out_w=1100, out_va=1300) for i in range(12 * 110)] + [rd(7000 + i * 5) for i in range(30)]
    r, m = run(s)
    return m and all(x.get("key") for x in m) and len({x["key"] for x in m}) == len(m)


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
