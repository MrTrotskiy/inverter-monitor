"""The notification rules, as a pure state machine over the collector's readings (no network, no files).

Feed readings in time order with `step(reading)`; call `tick(now)` for the clock-driven ones (silence, digests).
Both return a list of messages: {"kind", "text", "important"}. `important` ones may be sent at night;
the rest are held for the morning digest by the sender (notify.py), not here.

A reading is the collector's line: t (ISO), mode (2 mains, 3 battery), out_w, out_va, bat_v, bat_a, bat_w, temp_c, grid_v.
"""
from datetime import datetime, timedelta

CAP_WH = 2560 * 0.95  # usable energy assumed until a run to the cut-off measures it
IDLE_W = 20  # the inverter's own draw from the battery (measured 19-21 W, 2026-09-17)
LOSS = 0.02

RULES = {
    "blink_s": 60,  # an outage shorter than this is a blink, not an outage
    "levels": [50, 20],
    "overload_va": 2400, "overload_w": 1200, "overload_n": 3,  # 80 % of 3000 VA / 1500 W, three readings in a row
    "hot_c": 50, "cool_c": 45,
    "fast_w": 150, "fast_min": 15,
    "nocharge_min": 15,
    "full_a": 2.8, "full_min": 5,  # charge over: current at or below one step for five minutes
    "silent_min": 10,
    "hour_left_h": 1.0,
    "notfull_wh": 128,  # 5 % of the bank
    "short_margin_min": 10,  # "won't last until the power is back" only when it falls short by more than this
}


def hm(h):
    m = max(0, int(round(h * 60)))
    return f"{m // 60} ч {m % 60:02d} мин" if m >= 60 else f"{m} мин"


def clock(ts):
    return datetime.fromtimestamp(ts).strftime("%H:%M")


class Rules:
    def __init__(self, state=None, rules=RULES):
        self.r = rules
        s = state or {}
        self.s = {
            "mode": s.get("mode"), "last_t": s.get("last_t"),
            "spent_wh": s.get("spent_wh", 0.0),  # since the bank was last full
            "outage_start": s.get("outage_start"), "outage_wh": s.get("outage_wh", 0.0), "outage_peak": s.get("outage_peak", 0),
            "outage_told": s.get("outage_told", False),
            "levels_told": s.get("levels_told", []), "fast_told": s.get("fast_told", False), "hour_told": s.get("hour_told", False),
            "grid_since": s.get("grid_since"), "charged_seen": s.get("charged_seen", False), "low_since": s.get("low_since"),
            "nocharge_told": s.get("nocharge_told", False), "full": s.get("full", True),
            "charge_start": s.get("charge_start"), "charge_ah": s.get("charge_ah", 0.0),
            "over_n": s.get("over_n", 0), "over_told": s.get("over_told", False),
            "hot_told": s.get("hot_told", False), "hot_since": s.get("hot_since"),
            "silent_told": s.get("silent_told", False),
            # since when this Mac has been up and watching without a break: a gap while it was off or asleep is
            # nobody's fault and is never reported as the inverter's silence (2026-10-23, 18:18 -> 19:58)
            "watch_since": s.get("watch_since"),
            "gap_before": s.get("gap_before", False),  # the last reading came after a break in watching
            "blinks": s.get("blinks", []), "recent": s.get("recent", []),  # recent: [t, out_w] of the last 15 min on battery
            "outages": s.get("outages", []),  # [{start, end, wh}] of the last 8 days, for digests
        }

    def state(self):
        return self.s

    # ---------- readings ----------
    def step(self, rd):
        s, r = self.s, self.r
        t = datetime.fromisoformat(rd["t"]).timestamp()
        out = []
        prev_t = s["last_t"]
        if s["watch_since"] is None:
            s["watch_since"] = t
        dt =t - prev_t if prev_t and 0 < t - prev_t <= 60 else 0
        on_bat = rd["mode"] == 3

        if s["silent_told"]:
            out.append(msg("data", "📡 Снова читаю инвертор.", False, key=f"back:{prev_t}"))
            s["silent_told"] = False
        # a change of mode across a break in watching happened at an unknown moment inside the break
        unseen = bool(prev_t and t - prev_t > 60 and s["watch_since"] and prev_t < s["watch_since"])

        # energy since full, and in this outage
        if on_bat and dt:
            draw = rd["out_w"] * (1 + LOSS) + IDLE_W
            s["spent_wh"] = min(CAP_WH, s["spent_wh"] + draw * dt / 3600)
            if s["outage_start"]:
                s["outage_wh"] += draw * dt / 3600
        if on_bat:
            s["recent"] = [x for x in s["recent"] if t - x[0] <= r["fast_min"] * 60] + [[t, rd["out_w"]]]
            s["outage_peak"] = max(s["outage_peak"], rd["out_w"])

        # grid lost / back
        if on_bat and s["mode"] != 3:
            s["outage_start"] = t
            s["outage_wh"], s["outage_peak"], s["outage_told"] = 0.0, rd["out_w"], False
            s["fast_told"], s["hour_told"], s["recent"] = False, False, [[t, rd["out_w"]]]
            s["short_told"] = False
            s["grid_since"], s["nocharge_told"], s["charged_seen"] = None, False, False
            s["gap_before"] = unseen
        if on_bat and s["outage_start"] and not s["outage_told"] and t - s["outage_start"] >= r["blink_s"]:
            s["outage_told"] = True
            s["full"] = False
            left = self.left_h(rd["out_w"])
            if s["gap_before"]:  # it went out while nobody watched: the moment and what the bank gave are unknown
                out.append(msg("off", f"⚡ Света нет: вижу с {clock(s['outage_start'])}, после перерыва в наблюдении. Когда пропал и сколько ушло из банка за перерыв — не знаю; при {rd['out_w']} Вт хватит не больше ≈ {hm(left)}.", False, key=f"off:{s['outage_start']}"))
            else:
                out.append(msg("off", f"⚡ Свет пропал в {clock(s['outage_start'])}. Банк ≈ {self.soc():.0f} %, при {rd['out_w']} Вт хватит ≈ {hm(left)}.", False, key=f"off:{s['outage_start']}"))
            if s["spent_wh"] > r["notfull_wh"]:
                out.append(msg("notfull", f"⚠️ Свет пропал, а банк заряжен лишь на ≈ {self.soc():.0f} %: хватит ≈ {hm(left)}, не {hm(CAP_WH / (rd['out_w'] * (1 + LOSS) + IDLE_W))}.", False, key=f"notfull:{s['outage_start']}"))
        if not on_bat and s["mode"] == 3 and s["outage_start"]:
            dur = t - s["outage_start"]
            if not s["outage_told"]:
                s["blinks"].append(s["outage_start"])
            elif unseen or s["gap_before"]:  # part of this outage was not watched: no duration, no total
                out.append(msg("on", f"✅ Свет есть: вижу с {clock(t)}, после перерыва в наблюдении.", False, key=f"on:{s['outage_start']}"))
            else:
                out.append(msg("on", f"✅ Свет есть в {clock(t)}. Было без света {hm(dur / 3600)}.", False, key=f"on:{s['outage_start']}"))
                wh = s["outage_wh"]
                out.append(msg("sum", f"🧾 Отключение {clock(s['outage_start'])}–{clock(t)}: ушло ≈ {wh:.0f} Вт·ч ({100 * wh / 2560:.0f} % банка), пик {s['outage_peak']} Вт.", False, key=f"sum:{s['outage_start']}"))
                s["outages"] = [o for o in s["outages"] if t - o["end"] < 8 * 86400] + [{"start": s["outage_start"], "end": t, "wh": round(wh)}]
            s["outage_start"] = None
            s["gap_before"] = False
            s["grid_since"] = t

        # levels, fast drain, last hour (on battery, after the blink window)
        if on_bat and s["outage_told"]:
            soc = self.soc()
            for lv in r["levels"]:
                if soc <= lv and lv not in s["levels_told"]:
                    s["levels_told"].append(lv)
                    out.append(msg(f"lvl{lv}", f"{'🔴' if lv <= 20 else '🟡'} {lv} %. При {rd['out_w']} Вт осталось ≈ {hm(self.left_h(rd['out_w']))}.", lv <= 20, key=f"lvl{lv}:{s['outage_start']}"))
            mean = sum(x[1] for x in s["recent"]) / len(s["recent"])
            span = s["recent"][-1][0] - s["recent"][0][0]
            if span >= (r["fast_min"] - 1) * 60 and mean > r["fast_w"] and not s["fast_told"]:
                s["fast_told"] = True
                out.append(msg("fast", f"🔥 {r['fast_min']} мин подряд ≈ {mean:.0f} Вт из батарей: хватит ≈ {hm(self.left_h(mean))}.", False))
            if span >= 60 and mean < r["fast_w"] * 0.8:
                s["fast_told"] = False
            if self.left_h(mean) <= r["hour_left_h"] and not s["hour_told"]:
                s["hour_told"] = True
                out.append(msg("hour", f"⛔ Осталось ≈ {hm(self.left_h(mean))}: инвертор скоро отключится. Сохраните работу.", True, key=f"hour:{s['outage_start']}"))

        # charging: when it is over, and when it does not start
        if not on_bat:
            if rd["bat_a"] > r["full_a"]:
                s["charged_seen"] = True
                s["low_since"] = None
                if not s["charge_start"]:
                    s["charge_start"], s["charge_ah"] = t, 0.0
            elif s["charged_seen"] and s["low_since"] is None:
                s["low_since"] = t
            if s["charge_start"] and dt:
                s["charge_ah"] += max(0.0, rd["bat_a"]) * dt / 3600
            if s["charged_seen"] and s["low_since"] and t - s["low_since"] >= r["full_min"] * 60:
                mins = (s["low_since"] - s["charge_start"]) / 60 if s["charge_start"] else 0
                if s["charge_ah"] >= 1.0:  # a float top-up of a few seconds is not a charge
                    out.append(msg("full", f"🔋 Банк полный в {clock(s['low_since'])}: зарядка шла {hm(mins / 60)}, вернулось ≈ {s['charge_ah']:.0f} А·ч.", False, key=f"full:{s['low_since']}"))
                s.update(full=True, spent_wh=0.0, levels_told=[], charged_seen=False, low_since=None, charge_start=None, charge_ah=0.0)
            if (s["grid_since"] and not s["full"] and not s["charged_seen"] and not s["nocharge_told"]
                    and t - s["grid_since"] >= r["nocharge_min"] * 60):
                s["nocharge_told"] = True
                out.append(msg("nocharge", f"❓ Свет есть {r['nocharge_min']} мин, а в батарею не идёт ток. Банк ≈ {self.soc():.0f} %.", False, key=f"nocharge:{s['grid_since']}"))

        # overload and heat: important day and night
        over = rd["out_va"] >= r["overload_va"] or rd["out_w"] >= r["overload_w"]
        s["over_n"] = s["over_n"] + 1 if over else 0
        if s["over_n"] >= r["overload_n"] and not s["over_told"]:
            s["over_told"] = True
            out.append(msg("over", f"🟥 Нагрузка {rd['out_va']} ВА / {rd['out_w']} Вт — {100 * rd['out_va'] / 3000:.0f} % предела инвертора. Выключите что-нибудь.", True, key=f"over:{t - r['overload_n'] * 5:.0f}"))
        if rd["out_va"] < r["overload_va"] * 0.8 and rd["out_w"] < r["overload_w"] * 0.8:
            s["over_told"] = False
        if rd["temp_c"] >= r["hot_c"]:
            s["hot_since"] = s["hot_since"] or t
            if t - s["hot_since"] >= 60 and not s["hot_told"]:
                s["hot_told"] = True
                out.append(msg("hot", f"🌡 Инвертор {rd['temp_c']} °C при {rd['out_w']} Вт. Проверьте, не закрыта ли решётка.", True, key=f"hot:{s['hot_since']}"))
        else:
            s["hot_since"] = None
            if rd["temp_c"] <= r["cool_c"]:
                s["hot_told"] = False

        s["mode"], s["last_t"] = rd["mode"], t
        return out

    # ---------- the clock ----------
    def resume(self, now):
        """The Mac (or this service) was off or asleep until `now`: silence is counted from here, not from the
        last reading. Call it on start after a break and whenever the clock jumps."""
        self.s["watch_since"] = now

    def tick(self, now, why="", back_at=None):
        """`why`: what the sender knows of the cause (the collector's and the cloud's state), added to the text.
        `back_at`: when the power is back by the owner's outage schedule (epoch s), or None if unknown."""
        s, out = self.s, []
        # on battery, by the schedule: will the bank last until the power is back? Once per outage, day and night.
        if (back_at and s["mode"] == 3 and s["outage_told"] and s["recent"] and not s.get("short_told")
                and s["last_t"] and now - s["last_t"] < 120):
            mean = sum(x[1] for x in s["recent"]) / len(s["recent"])
            ends = now + self.left_h(mean) * 3600
            if ends < back_at - self.r["short_margin_min"] * 60:
                s["short_told"] = True
                out.append(msg("short", f"🪫 Не дотянет до света: по графику свет в {clock(back_at)}, а банка при ≈ {mean:.0f} Вт хватит до ≈ {clock(ends)} — на {hm((back_at - ends) / 3600)} раньше. Что выключить, чтобы дотянуть: нужно ≤ {self.load_for(back_at - now):.0f} Вт.", True, key=f"short:{s['outage_start']}"))
        if s["watch_since"] is None:
            s["watch_since"] = now
        since = max(s["last_t"] or 0, s["watch_since"])
        if s["last_t"] and now - since >= self.r["silent_min"] * 60 and not s["silent_told"]:
            s["silent_told"] = True
            onb = s["mode"] == 3
            if s["last_t"] >= s["watch_since"]:
                head = f"📡 Инвертор молчит {self.r['silent_min']} мин. Последнее чтение {clock(s['last_t'])}"
            else:  # nothing read since this Mac came back
                head = f"📡 Mac работает с {clock(s['watch_since'])}, а инвертор так и не прочитан. Последнее чтение {clock(s['last_t'])}"
            out.append(msg("data", f"{head}{', от батарей' if onb else ''}.{(' ' + why) if why else ''}", onb,
                           key=f"data:{s['last_t']}"))
        cut = [b for b in s["blinks"] if now - b >= 3600]
        if cut and len(s["blinks"]) and now - s["blinks"][0] >= 3600:
            n = len(s["blinks"])
            out.append(msg("blink", f"〰️ За час свет пропадал {n} раз{'а' if 2 <= n % 10 <= 4 and n not in (12, 13, 14) else ''}, каждый раз меньше минуты.", False, key=f"blink:{s['blinks'][0]}"))
            s["blinks"] = []
        return out

    # ---------- helpers ----------
    def soc(self):
        return max(0.0, 100 * (1 - self.s["spent_wh"] / CAP_WH))

    def left_h(self, load_w):
        return max(0.0, CAP_WH - self.s["spent_wh"]) / (load_w * (1 + LOSS) + IDLE_W)

    def load_for(self, secs):
        """The load (W at the socket) the bank holds for `secs`."""
        return max(0.0, (max(0.0, CAP_WH - self.s["spent_wh"]) / (secs / 3600) - IDLE_W) / (1 + LOSS))


def msg(kind, text, important, key=None):
    """`key` names the event, not the wording: the sender sends each key once, across restarts too."""
    return {"kind": kind, "text": text, "important": important, "key": key or f"{kind}:{text}"}


def is_night(ts, start=23, end=8):
    h = datetime.fromtimestamp(ts).hour
    return h >= start or h < end
