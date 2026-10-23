"""The owner's outage schedule, for "the bank will not last until the power is back".

Source: svitlo-proxy (https://svitlo-proxy.svitlo-proxy.workers.dev), a public JSON copy of svitlo.live (Ukrainian
outage schedules). One GET answers every oblast, today and tomorrow, in half hours: 1 = on, 2 = off, 0 = unknown.
No token, nothing about the owner is sent.

The queue is not guessed: data/notify/config.json needs "region" (e.g. "kyivska-oblast") and "queue" (e.g. "1.1").
Without them the rule stays silent.
"""
import json
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

URL = "https://svitlo-proxy.svitlo-proxy.workers.dev"
UA = "inverter-monitor/1.0 (home battery notifier)"


def slots(data, region, queue):
    """{date: '48 chars'} for one queue, from the proxy's answer."""
    for r in data.get("regions", []):
        if r.get("cpu") == region:
            q = (r.get("schedule") or {}).get(queue) or {}
            return {day: "".join(str(v) for v in half.values()) for day, half in q.items() if len(half) == 48}
    return {}


def back_at(days, now):
    """When the power comes back by the schedule, if `now` falls in a scheduled outage: epoch s, else None.
    The end must be known (an 'on' half hour after the run of 'off'); a run into unknown slots answers None."""
    t = datetime.fromtimestamp(now)
    day0 = t.date()
    line = ""
    for i in range(2):
        line += days.get((day0 + timedelta(days=i)).isoformat(), "0" * 48)
    i = t.hour * 2 + t.minute // 30
    if line[i] != "2":
        return None
    j = i
    while j < len(line) and line[j] == "2":
        j += 1
    if j >= len(line) or line[j] != "1":
        return None
    start = datetime.combine(day0, datetime.min.time())
    return (start + timedelta(minutes=30 * j)).timestamp()


class Schedule:
    """Fetched at most every 30 min; the last good answer is kept on disk (data/notify/schedule.json)."""

    def __init__(self, cache: Path, region=None, queue=None, every_s=1800):
        self.cache, self.region, self.queue, self.every = cache, region, queue, every_s
        self.days, self.fetched = {}, 0.0
        try:
            c = json.loads(cache.read_text())
            if c.get("region") == region and c.get("queue") == queue:
                self.days, self.fetched = c["days"], c["fetched"]
        except (OSError, ValueError, KeyError):
            pass

    def refresh(self, now, log=lambda *a, **k: None):
        if not (self.region and self.queue) or now - self.fetched < self.every:
            return
        self.fetched = now  # also after a failure: no hammering
        try:
            req = urllib.request.Request(URL, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                days = slots(json.loads(r.read()), self.region, self.queue)
            if days:
                self.days = days
                tmp = str(self.cache) + ".tmp"
                Path(tmp).write_text(json.dumps({"region": self.region, "queue": self.queue, "fetched": now, "days": days}))
                Path(tmp).replace(self.cache)
            log("schedule", ok=bool(days), days=sorted(days))
        except Exception as e:
            log("schedule", ok=False, err=type(e).__name__)

    def back_at(self, now):
        return back_at(self.days, now) if self.days else None
