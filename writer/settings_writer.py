#!/usr/bin/python3
"""The settings writer: one job (data/settings/jobs/<id>.json, written by the admin after the PIN and the checks),
done through the dongle, then it exits. The collector stays read-only; for the few seconds of a job it steps aside
(data/dongle/yield.json) and this program holds the dongle instead.

A job:
  1. asks the collector to step aside and waits until it has (or finds it not running);
  2. announces itself to the dongle, takes its connection, and reads the live block: the inverter must be on mains
     (mode 2) and not charging hard (> 40 A), or nothing is written;
  3. reads every setting (300..325, 327..343) as a snapshot: the way back. Each change's "from" must equal what the
     inverter holds now, or nothing is written (it was changed elsewhere since the page read it);
  4. writes one register at a time (Modbus function 6; 16 if the firmware refuses 6), waits, reads it back and
     compares. A refusal, a timeout or a different value stops the job, and every register already written is put
     back from the snapshot, each read back too;
  5. reads the settings again (data/settings/current.json), journals every step (journal.jsonl), lets the
     collector go back.

Only registers in writer/allowed.json, within their ranges, are ever written. `kind: read` does 1–3 and 5 only.

  settings_writer.py --job data/settings/jobs/<id>.json

Configuration by environment (the sandbox tests point it at a fake inverter): INVERTER_DATA, WRITER_DONGLE,
WRITER_BROADCAST, WRITER_UDP_PORT, WRITER_TCP_PORT, WRITER_ME, WRITER_SETTLE_S.
"""
import argparse
import json
import os
import socket
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "common"))
from eybond import Link  # noqa: E402
import localconfig  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("INVERTER_DATA") or ROOT / "data")
DONGLE_DIR = DATA / "dongle"
SET_DIR = DATA / "settings"
ALLOWED = {int(k): v for k, v in json.loads((Path(__file__).parent / "allowed.json").read_text()).items() if k.isdigit()}
DONGLE = os.environ.get("WRITER_DONGLE") or localconfig.get("dongle.ip")
BROADCAST = os.environ.get("WRITER_BROADCAST") or localconfig.get("dongle.broadcast", "255.255.255.255")
UDP_PORT = int(os.environ.get("WRITER_UDP_PORT", "58899"))
TCP_PORT = int(os.environ.get("WRITER_TCP_PORT", "8899"))
SETTLE_S = float(os.environ.get("WRITER_SETTLE_S", "1.0"))
BLOCKS = ((300, 26), (327, 17))
MAX_CHARGE_A = 40


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def save_json(p, obj):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1))
    os.replace(tmp, p)


def load_json(p, default=None):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return default


def my_ip():
    me = os.environ.get("WRITER_ME")
    if me:
        return me
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((DONGLE or BROADCAST, 9))  # the source address of a route towards the dongle; nothing is sent
        return s.getsockname()[0]
    finally:
        s.close()


class Job:
    def __init__(self, path):
        self.path = Path(path)
        self.j = load_json(self.path)
        if not self.j:
            raise SystemExit(f"no job at {path}")
        self.j.setdefault("steps", [])
        self.attempted = []

    def step(self, text, ok=True, **kw):
        self.j["steps"].append({"t": now_iso(), "text": text, "ok": ok, **kw})
        save_json(self.path, self.j)

    def state(self, s, **kw):
        self.j["state"] = s
        self.j.update(kw)
        save_json(self.path, self.j)


def journal(rec):
    SET_DIR.mkdir(parents=True, exist_ok=True)
    with open(SET_DIR / "journal.jsonl", "a") as f:
        f.write(json.dumps({"t": now_iso(), **rec}, ensure_ascii=False) + "\n")


class Lock:
    def __init__(self):
        self.p = SET_DIR / "writer.lock"

    def __enter__(self):
        SET_DIR.mkdir(parents=True, exist_ok=True)
        try:
            fd = os.open(self.p, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pid = int((self.p.read_text().strip() or "0"))
            try:
                os.kill(pid, 0)
                raise SystemExit("another job is running")
            except (ProcessLookupError, PermissionError):
                self.p.unlink(missing_ok=True)  # left by a job that died
                fd = os.open(self.p, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return self

    def __exit__(self, *a):
        self.p.unlink(missing_ok=True)


class Dongle:
    """Takes the dongle from the collector, and gives it back."""

    def __init__(self, job_id):
        self.job_id, self.srv, self.udp, self.link = job_id, None, None, None

    def ask_collector(self, wait_s=20):
        save_json(DONGLE_DIR / "yield.json", {"job": self.job_id, "until": time.time() + 300, "by": "settings-writer"})
        end = time.time() + wait_s
        while time.time() < end:
            st = load_json(DONGLE_DIR / "status.json", {})
            if (st.get("yielded") or {}).get("job") == self.job_id:
                return "yielded"
            try:
                written = datetime.fromisoformat(st["written"]).timestamp()
            except (KeyError, ValueError, TypeError):
                written = 0
            if time.time() - written > 90:
                return "not running"
            time.sleep(0.3)
        return None

    def connect(self, timeout=45):
        self.srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        bind_end = time.time() + 10
        while True:
            try:
                self.srv.bind(("0.0.0.0", TCP_PORT))
                break
            except OSError:
                if time.time() > bind_end:
                    raise
                time.sleep(0.5)
        self.srv.listen(2)
        self.srv.settimeout(0.5)
        self.udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.udp.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        return self.accept(timeout)

    def accept(self, timeout):
        msg = f"set>server={my_ip()}:{TCP_PORT};".encode()
        end, last = time.time() + timeout, 0
        while time.time() < end:
            if time.time() - last >= 3:
                for dest in [x for x in (DONGLE, BROADCAST) if x]:
                    try:
                        self.udp.sendto(msg, (dest, UDP_PORT))
                    except OSError:
                        pass
                last = time.time()
            try:
                s, _ = self.srv.accept()
            except socket.timeout:
                continue
            if self.link:
                self.link.close()
            self.link = Link(s)
            self.link.hello()
            return self.link
        return None

    def release(self):
        if self.link:
            self.link.close()
        for x in (self.srv, self.udp):
            if x:
                x.close()
        (DONGLE_DIR / "yield.json").unlink(missing_ok=True)


def read_all(link):
    words = {}
    for start, n in BLOCKS:
        w, note = link.read(start, n)
        if w is None:
            return None, f"{start}..{start + n - 1}: {note}"
        for i, x in enumerate(w):
            words[start + i] = x
    return words, "ok"


def check_change(c):
    a = ALLOWED.get(int(c["reg"]))
    if not a:
        return f"регистр {c['reg']} не разрешён"
    if not (a["lo"] <= int(c["to"]) <= a["hi"]) or ("only" in a and int(c["to"]) not in a["only"]):
        return f"регистр {c['reg']}: {c['to']} вне {a['lo']}..{a['hi']}"
    return None


def run(job):
    j = job.j
    changes = j.get("changes", [])
    if j.get("kind", "write") == "write":
        if not changes:
            return job.state("refused", why="нет изменений")
        for c in changes:
            bad = check_change(c)
            if bad:
                job.step(bad, ok=False)
                return job.state("refused", why=bad)

    d = Dongle(j["id"])
    try:
        job.state("waiting")
        who = d.ask_collector()
        if who is None:
            job.step("коллектор не уступил донгл", ok=False)
            return job.state("failed", why="коллектор не уступил донгл")
        job.step("коллектор уступил донгл" if who == "yielded" else "коллектор не запущен")
        job.state("connecting")
        link = d.connect()
        if not link:
            job.step("донгл не подключился за 45 с", ok=False)
            return job.state("failed", why="нет связи с донглом")
        job.step("донгл на связи")

        live, note = link.read(201, 34)
        if live is None:
            job.step(f"живые данные не прочитаны: {note}", ok=False)
            return job.state("failed", why="инвертор не ответил")
        mode = live[0]
        bat_a = (live[15] - 0x10000 if live[15] & 0x8000 else live[15]) / 10
        if j.get("kind", "write") == "write" and (mode != 2 or bat_a > MAX_CHARGE_A):
            why = "дом от батареи" if mode != 2 else f"идёт заряд {bat_a:.0f} А"
            job.step(f"условия: {why} — ничего не пишу", ok=False)
            return job.state("refused", why=why)
        job.step(f"режим {'сеть' if mode == 2 else mode}, ток батареи {bat_a:+.1f} А")

        job.state("reading")
        snap, note = read_all(link)
        if snap is None:
            job.step(f"снимок не прочитан: {note}", ok=False)
            return job.state("failed", why="настройки не прочитаны")
        save_json(SET_DIR / "snapshots" / f"{j['id']}.json", {"at": now_iso(), "job": j["id"], "words": snap})
        save_json(SET_DIR / "current.json", {"at": now_iso(), "source": "dongle", "words": snap})
        job.step("снимок всех настроек сохранён")
        if j.get("kind") == "read":
            return job.state("done")

        for c in changes:
            if snap.get(int(c["reg"])) != int(c["from"]):
                why = f"регистр {c['reg']} сейчас {snap.get(int(c['reg']))}, а не {c['from']}: изменён в другом месте"
                job.step(why, ok=False)
                return job.state("refused", why=why)

        job.state("writing")
        failed = None
        for c in changes:
            reg, to = int(c["reg"]), int(c["to"])
            job.attempted.append(c)  # from here on it may have changed: a rollback looks at it
            note = link.write(reg, to)
            if note == "exception 1":  # the firmware does not take function 6
                note = link.write(reg, to, multi=True)
            time.sleep(SETTLE_S)
            got, rnote = link.read(reg, 1)
            rb = got[0] if got else None
            ok = note == "ok" and rb == to
            journal({"job": j["id"], "kind": "change", "id": c.get("id"), "reg": reg, "from": int(c["from"]), "to": to,
                     "read_back": rb, "ok": ok, "note": note if note != "ok" else rnote, "revert_of": j.get("revert_of")})
            job.step(f"рег {reg}: {c['from']} → {to}, прочитано {rb}", ok=ok)
            if not ok:
                failed = (c, note, rb)
                break

        if failed:
            job.state("rolling-back", why=f"рег {failed[0]['reg']}: {failed[1] if failed[1] != 'ok' else f'прочитано {failed[2]}'}")
            back_ok = rollback(job, d, job.attempted)
            final(job, d)
            return job.state("failed" if back_ok else "failed-rollback")
        final(job, d)
        return job.state("done")
    except (OSError, ConnectionError) as e:
        job.step(f"связь прервалась: {type(e).__name__}", ok=False)
        if job.attempted:
            job.state("rolling-back", why="связь прервалась во время записи")
            back_ok = rollback(job, d, job.attempted)
            if back_ok:
                final(job, d)
            return job.state("failed" if back_ok else "failed-rollback", why="связь прервалась во время записи")
        return job.state("failed", why="связь прервалась")
    finally:
        d.release()
        job.j["finished"] = now_iso()
        save_json(job.path, job.j)


def rollback(job, d, done):
    """Every register this job tried to write back to its snapshot value, newest first, each read back; one that
    still holds its old value is only read. The link is taken again once if it broke."""
    ok_all = True
    for c in reversed(done):
        reg, back = int(c["reg"]), int(c["from"])
        for attempt in range(2):
            try:
                link = d.link
                got, _ = link.read(reg, 1)
                if got and got[0] == back:
                    journal({"job": job.j["id"], "kind": "rollback", "id": c.get("id"), "reg": reg, "from": back, "to": back, "read_back": back, "ok": True, "note": "не менялся"})
                    job.step(f"рег {reg} не менялся ({back})")
                    break
                note = link.write(reg, back)
                if note == "exception 1":
                    note = link.write(reg, back, multi=True)
                time.sleep(SETTLE_S)
                got, _ = link.read(reg, 1)
                rb = got[0] if got else None
                ok = note == "ok" and rb == back
                journal({"job": job.j["id"], "kind": "rollback", "id": c.get("id"), "reg": reg, "from": int(c["to"]), "to": back, "read_back": rb, "ok": ok})
                job.step(f"откат рег {reg} → {back}, прочитано {rb}", ok=ok)
                ok_all = ok_all and ok
                break
            except (OSError, ConnectionError):
                job.step("связь прервалась при откате, подключаюсь снова", ok=False)
                if not d.accept(30):
                    if attempt:
                        ok_all = False
                    continue
        else:
            ok_all = False
    return ok_all


def final(job, d):
    try:
        snap, note = read_all(d.link)
        if snap:
            save_json(SET_DIR / "current.json", {"at": now_iso(), "source": "dongle", "words": snap})
            job.step("настройки прочитаны заново")
    except (OSError, ConnectionError):
        job.step("после записи настройки не перечитаны", ok=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    a = ap.parse_args()
    job = Job(a.job)
    try:
        with Lock():
            run(job)
    except SystemExit as e:
        job.state("refused", why=str(e))


if __name__ == "__main__":
    main()
