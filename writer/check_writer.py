#!/usr/bin/python3
"""The settings writer end to end, against a fake inverter (writer/fake_inverter.py), never the real one:
a sandbox data folder, the real collector.py on other ports reading the fake, and settings_writer.py doing jobs.

  python3 writer/check_writer.py          -> one line per check, "N/N" at the end
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PY = sys.executable
results = []


class Sandbox:
    port = 18900

    def __init__(self, *fake_args, collector=True):
        Sandbox.port += 2
        self.udp, self.tcp = Sandbox.port + 40000, Sandbox.port
        self.dir = Path(tempfile.mkdtemp(prefix="inv-writer-"))
        (self.dir / "dongle").mkdir()
        self.state = self.dir / "fake.json"
        self.fake = subprocess.Popen([PY, str(HERE / "fake_inverter.py"), "--udp-port", str(self.udp), "--state", str(self.state), *fake_args],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.coll = None
        time.sleep(0.4)
        if collector:
            self.coll = subprocess.Popen([PY, str(ROOT / "collector" / "collector.py"), "--data", str(self.dir / "dongle"), "--cloud-log", str(self.dir / "cloud.jsonl"),
                                          "--dongle", "127.0.0.1", "--broadcast", "127.0.0.1", "--udp-port", str(self.udp), "--tcp-port", str(self.tcp),
                                          "--me", "127.0.0.1", "--every", "1"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.wait(lambda: self.status().get("connected") and self.status().get("last"), 15)

    def env(self):
        return {**os.environ, "INVERTER_DATA": str(self.dir), "WRITER_DONGLE": "127.0.0.1", "WRITER_BROADCAST": "127.0.0.1",
                "WRITER_UDP_PORT": str(self.udp), "WRITER_TCP_PORT": str(self.tcp), "WRITER_ME": "127.0.0.1", "WRITER_SETTLE_S": "0.2"}

    def status(self):
        try:
            return json.loads((self.dir / "dongle" / "status.json").read_text())
        except (OSError, ValueError):
            return {}

    def regs(self):
        return {int(k): v for k, v in json.loads(self.state.read_text()).items()}

    def wait(self, cond, secs):
        end = time.time() + secs
        while time.time() < end:
            if cond():
                return True
            time.sleep(0.2)
        return False

    def job(self, changes, kind="write", jid=None, background=False):
        jid = jid or f"t{int(time.time() * 1000)}"
        p = self.dir / "settings" / "jobs" / f"{jid}.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"id": jid, "kind": kind, "changes": changes, "state": "queued"}))
        proc = subprocess.Popen([PY, str(HERE / "settings_writer.py"), "--job", str(p)], env=self.env(), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if background:
            return p, proc
        _, err = proc.communicate(timeout=120)
        if err.strip():
            print(err.decode()[-800:], file=sys.stderr)
        return json.loads(p.read_text())

    def journal(self):
        p = self.dir / "settings" / "journal.jsonl"
        return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []

    def close(self):
        for p in (self.coll, self.fake):
            if p:
                p.terminate()
                try:
                    p.wait(5)
                except subprocess.TimeoutExpired:
                    p.kill()
        shutil.rmtree(self.dir, ignore_errors=True)


def check(name):
    def wrap(fn):
        t = time.time()
        try:
            ok, note = fn()
        except Exception as e:  # a check that crashes is a failed check
            ok, note = False, f"{type(e).__name__}: {e}"
        results.append(ok)
        print(f"{'ok  ' if ok else 'FAIL'} {name} ({time.time() - t:.1f} s){'' if ok and not note else ' — ' + str(note)}", flush=True)
        return fn
    return wrap


C = lambda reg, frm, to, id=None: {"reg": reg, "from": frm, "to": to, "id": id or str(reg)}


@check("the collector reads the fake inverter")
def _():
    s = Sandbox()
    try:
        st = s.status()
        return st.get("connected") and st["last"]["mode"] == 2, f"mode {st.get('last', {}).get('mode')}"
    finally:
        s.close()


@check("a read job: snapshot and current.json, the collector steps aside and comes back")
def _():
    s = Sandbox()
    try:
        j = s.job([], kind="read")
        cur = json.loads((s.dir / "settings" / "current.json").read_text())
        n0 = s.status().get("reads_ok", 0)
        back = s.wait(lambda: s.status().get("connected") and s.status().get("reads_ok", 0) > n0 + 1, 20)
        ev = (s.dir / "dongle" / "events.jsonl").read_text()
        return j["state"] == "done" and cur["words"]["324"] == 141 and back and '"yielded"' in ev and '"resumed"' in ev, f"{j['state']}, back {back}"
    finally:
        s.close()


@check("backlight 0 → 1: written, read back, journaled; then 'return' puts 0 back")
def _():
    s = Sandbox()
    try:
        j = s.job([C(305, 0, 1, "light")])
        r1 = s.regs()[305]
        j2 = s.job([C(305, 1, 0, "light")], jid="t-return")
        r2 = s.regs()[305]
        jr = s.journal()
        ok = j["state"] == "done" and r1 == 1 and j2["state"] == "done" and r2 == 0 and len(jr) == 2 and all(x["ok"] for x in jr) and jr[0]["read_back"] == 1
        return ok, f"{j['state']}/{j2['state']}, regs {r1}->{r2}"
    finally:
        s.close()


@check("the inverter refuses the 2nd register: stop, the 1st is rolled back")
def _():
    s = Sandbox("--refuse", "325")
    try:
        j = s.job([C(324, 141, 144), C(325, 141, 143)])
        r = s.regs()
        kinds = [(x["kind"], x["reg"], x["ok"]) for x in s.journal()]
        return j["state"] == "failed" and r[324] == 141 and r[325] == 141 and ("rollback", 324, True) in kinds, f"{j['state']} {kinds}"
    finally:
        s.close()


@check("float above C.V. is refused by the inverter's own rule, and nothing stays changed")
def _():
    s = Sandbox()
    try:
        j = s.job([C(305, 0, 1), C(325, 141, 150)])
        r = s.regs()
        return j["state"] == "failed" and r[325] == 141 and r[305] == 0, f"{j['state']}, 305={r[305]} 325={r[325]}"
    finally:
        s.close()


@check("read back differs (the inverter ignores the write): stop, roll back what was written")
def _():
    s = Sandbox("--ignore-writes", "332")
    try:
        j = s.job([C(333, 500, 400), C(332, 500, 450)])
        r = s.regs()
        return j["state"] == "failed" and r[333] == 500 and r[332] == 500, f"{j['state']}, 333={r[333]}"
    finally:
        s.close()


@check("no answer to a write (timeout): stop and roll back")
def _():
    s = Sandbox("--silent-writes")
    try:
        j = s.job([C(305, 0, 1)])
        return j["state"] in ("failed", "failed-rollback") and s.regs()[305] == 0, j["state"]
    finally:
        s.close()


@check("the link drops right after a write: taken again, rolled back")
def _():
    s = Sandbox("--drop-after", "1")
    try:
        j = s.job([C(305, 0, 1), C(306, 1, 0)])
        r = s.regs()
        return j["state"] == "failed" and r[305] == 0 and r[306] == 1, f"{j['state']}, 305={r[305]} 306={r[306]}: {[x['text'] for x in j['steps']][-4:]}"
    finally:
        s.close()


@check("on battery (an outage): nothing is written")
def _():
    s = Sandbox("--battery")
    try:
        j = s.job([C(305, 0, 1)])
        return j["state"] == "refused" and s.regs()[305] == 0 and not s.journal(), j.get("why")
    finally:
        s.close()


@check("charging hard (50 A): nothing is written")
def _():
    s = Sandbox("--charging-a", "50")
    try:
        j = s.job([C(305, 0, 1)])
        return j["state"] == "refused" and s.regs()[305] == 0, j.get("why")
    finally:
        s.close()


@check("changed elsewhere since it was read: nothing is written")
def _():
    s = Sandbox("--set", "305=1")
    try:
        j = s.job([C(305, 0, 1)])
        return j["state"] == "refused" and "изменён" in j.get("why", ""), j.get("why")
    finally:
        s.close()


@check("a register outside writer/allowed.json, or out of range: refused before the dongle is touched")
def _():
    s = Sandbox()
    try:
        j1 = s.job([C(300, 0, 1)])
        j2 = s.job([C(324, 141, 200)])
        untouched = not (s.dir / "dongle" / "yield.json").exists() and not s.journal()
        return j1["state"] == "refused" and j2["state"] == "refused" and untouched and s.regs()[300] == 0, f"{j1.get('why')} | {j2.get('why')}"
    finally:
        s.close()


@check("a firmware that refuses function 6: function 16 is used")
def _():
    s = Sandbox("--no-fc6")
    try:
        j = s.job([C(303, 3, 1)])
        return j["state"] == "done" and s.regs()[303] == 1, j["state"]
    finally:
        s.close()


@check("a second job while one runs is refused")
def _():
    s = Sandbox()
    try:
        p, proc = s.job([C(305, 0, 1)], background=True)
        time.sleep(0.3)
        j2 = s.job([C(306, 1, 0)], jid="t-second")
        proc.wait(60)
        j1 = json.loads(p.read_text())
        return j1["state"] == "done" and j2["state"] == "refused" and s.regs()[306] == 1, f"{j1['state']}/{j2['state']}: {j2.get('why')}"
    finally:
        s.close()


@check("the collector not running: the writer works alone")
def _():
    s = Sandbox(collector=False)
    try:
        j = s.job([C(305, 0, 1)])
        return j["state"] == "done" and s.regs()[305] == 1, j["state"]
    finally:
        s.close()


@check("after a write the collector reads again, and yield.json is gone")
def _():
    s = Sandbox()
    try:
        s.job([C(305, 0, 1)])
        n0 = s.status().get("reads_ok", 0)
        back = s.wait(lambda: s.status().get("reads_ok", 0) > n0 + 2 and s.status().get("yielded") is None, 20)
        return back and not (s.dir / "dongle" / "yield.json").exists(), f"back {back}"
    finally:
        s.close()


if __name__ == "__main__":
    print(f"{sum(results)}/{len(results)}")
    sys.exit(0 if all(results) else 1)
