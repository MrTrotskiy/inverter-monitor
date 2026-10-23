#!/usr/bin/python3
"""Local collector: reads the inverter through its Eybond Wi-Fi dongle, READ-ONLY, and stores every reading.

How it talks to the dongle (checked on a live unit, 2026-10-23, with a read-only probe):
  - UDP `set>server=<this Mac>:8899;` to port 58899 makes the dongle dial TCP 8899 here, next to its cloud link.
  - Eybond frames: FC=1 heartbeat once on connect, FC=4 carries a Modbus RTU request to the inverter (slave 1).
  - Only Modbus function 3 (read holding registers) is ever built: `mb_read` refuses anything else, so no
    register or setting can be written from here.

What it stores (data/dongle/, one file per local day, gzipped after two days):
  - every `--every` seconds the live block 201..234 (decoded fields + the raw words, so a later map can reread it);
  - once a minute the status block 100..109 (warnings / faults, raw).
  - data/dongle/status.json: the last reading and today's counters, rewritten after each reading (for the admin).
  - data/dongle/events.jsonl: connects, drops, back-offs.

Stepping aside for the settings writer (writer/settings_writer.py, a separate program): while data/dongle/yield.json
asks for it ({"job", "until"}), the collector drops the dongle, closes its port, stops announcing and says so in
status.json ("yielded"); when the file is gone or `until` has passed, it binds again and goes on reading. The
collector itself still only reads.

Guard for the cloud poller and the SmartESS app: if the cloud log (data/dessmonitor-log.jsonl, written by
scripts/poll.sh) gets no new device packet for `--stale-min` minutes while we hold the dongle, the collector
lets go for 30 minutes. If the cloud stays silent while we are away, the silence is not ours, and the guard
rests until the cloud is fresh again.
"""
import argparse
import gzip
import json
import os
import select
import shutil
import socket
import struct
import sys
import time
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "common"))
import localconfig  # noqa: E402  (config.json: the dongle's address on this LAN)

ap = argparse.ArgumentParser()
ap.add_argument("--every", type=float, default=5.0, help="seconds between live reads")
ap.add_argument("--data", default=os.path.join(ROOT, "data", "dongle"))
ap.add_argument("--cloud-log", default=os.path.join(ROOT, "data", "dessmonitor-log.jsonl"))
ap.add_argument("--dongle", default=localconfig.get("dongle.ip"), help="last known dongle address (announced to directly too)")
ap.add_argument("--broadcast", default=localconfig.get("dongle.broadcast", "255.255.255.255"))
ap.add_argument("--stale-min", type=float, default=20.0)
ap.add_argument("--backoff-min", type=float, default=30.0)
ap.add_argument("--once", type=float, default=0, help="stop after this many seconds (a test run); 0 = forever")
# a sandbox (writer/check_writer.py) runs a second collector against a fake dongle on other ports
ap.add_argument("--tcp-port", type=int, default=8899)
ap.add_argument("--udp-port", type=int, default=58899)
ap.add_argument("--me", default=None, help="the address announced to the dongle (default: this Mac's LAN address)")
args = ap.parse_args()

UDP_PORT, TCP_PORT, HEADER = args.udp_port, args.tcp_port, 8
SLAVE = 1
LIVE = (201, 34)
STATUS = (100, 10)
os.makedirs(args.data, exist_ok=True)
T_START = time.time()


# ---------- small helpers ----------
def now_local():
    return datetime.now().astimezone()


def iso(dt):
    return dt.isoformat(timespec="milliseconds")


def event(kind, **kw):
    rec = {"t": iso(now_local()), "kind": kind, **kw}
    with open(os.path.join(args.data, "events.jsonl"), "a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(json.dumps(rec, ensure_ascii=False), file=sys.stderr, flush=True)


def write_json_atomic(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def guard_off():
    """data/dongle/guard-off.json {"until": epoch}: the cloud guard does not let go of the dongle until then
    (a discharge test must not get a 30-minute hole because the cloud went quiet)."""
    try:
        with open(os.path.join(args.data, "guard-off.json")) as f:
            return float(json.load(f).get("until", 0)) > time.time()
    except (OSError, ValueError, TypeError):
        return False


def s16(w):
    return w - 0x10000 if w & 0x8000 else w


# ---------- Modbus RTU, reads only ----------
def crc16_modbus(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def mb_read(slave, address, count, function=3):
    if function not in (3, 4):
        raise ValueError("refused: only reads (function 3 or 4)")
    body = struct.pack(">BBHH", slave, function, address, count)
    return body + struct.pack("<H", crc16_modbus(body))


def mb_parse(payload, count):
    if not payload or len(payload) < 5:
        return None, "short"
    if crc16_modbus(payload[:-2]) != struct.unpack("<H", payload[-2:])[0]:
        return None, "crc"
    if payload[1] & 0x80:
        return None, f"exception 0x{payload[2]:02x}"
    size = payload[2]
    if size != 2 * count or len(payload) < 3 + size + 2:
        return None, "size"
    return list(struct.unpack(f">{size // 2}H", payload[3:3 + size])), "ok"


# Live block 201..234, SMG-family map (oleks-p/ha-eybond-local smg.py), fields checked against the cloud on
# 2026-10-23: 202/203 grid V/Hz, 204 grid W, 209 charging W, 213 output W, 214 VA, 215/216/217 battery V/A/W.
def decode_live(w):
    g = lambda reg: w[reg - LIVE[0]]
    return {
        "mode": g(201),  # 2 = on mains, 3 = on battery (seen 2026-10-23)
        "grid_v": g(202) / 10, "grid_hz": g(203) / 100, "grid_w": s16(g(204)),
        "inv_w": s16(g(208)), "chg_w": s16(g(209)),
        "out_v": g(210) / 10, "out_a": g(211) / 10, "out_hz": g(212) / 100, "out_w": s16(g(213)), "out_va": g(214),
        "bat_v": g(215) / 10, "bat_a": s16(g(216)) / 10, "bat_w": s16(g(217)),
        "load_pct": g(225), "temp_c": g(226), "soc": g(229),
    }


# ---------- Eybond framing ----------
def header(tid, devcode, total, devaddr, fc):
    return struct.pack(">HHHBB", tid, devcode, total - 6, devaddr, fc)


def heartbeat(tid, interval=60):
    n = datetime.now(timezone.utc)
    p = bytes([n.year - 2000, n.month, n.day, n.hour, n.minute, n.second]) + struct.pack(">H", interval)
    return header(tid, 0, HEADER + len(p), 1, 1) + p


def forward(tid, frame, devcode=0x0994, devaddr=1):
    return header(tid, devcode, HEADER + len(frame), devaddr, 4) + frame


class Conn:
    def __init__(self, sock, peer):
        self.s, self.peer, self.buf, self.tid = sock, peer, b"", 0
        self.since = time.time()
        self.s.settimeout(None)

    def next_tid(self):
        self.tid = (self.tid + 1) & 0xFFFF
        return self.tid

    def read_frame(self, timeout):
        end = time.time() + timeout
        while True:
            if len(self.buf) >= HEADER:
                tid, devcode, wl, addr, fc = struct.unpack(">HHHBB", self.buf[:HEADER])
                total = wl + 6
                if len(self.buf) >= total:
                    payload, self.buf = self.buf[HEADER:total], self.buf[total:]
                    return tid, devcode, addr, fc, payload
            rem = end - time.time()
            if rem <= 0:
                return None
            r, _, _ = select.select([self.s], [], [], rem)
            if not r:
                return None
            chunk = self.s.recv(4096)
            if not chunk:
                raise ConnectionError("dongle closed the connection")
            self.buf += chunk

    def read_regs(self, addr, count, timeout=6.0):
        tid = self.next_tid()
        t = time.time()
        self.s.sendall(forward(tid, mb_read(SLAVE, addr, count, 3)))
        while True:
            f = self.read_frame(timeout - (time.time() - t))
            if f is None:
                return None, "timeout", time.time() - t
            rtid, _, _, fc, payload = f
            if fc == 4 and rtid == tid:
                words, note = mb_parse(payload, count)
                return words, note, time.time() - t

    def close(self):
        try:
            self.s.close()
        except OSError:
            pass


# ---------- storage ----------
class Store:
    def __init__(self):
        self.day = None
        self.f = None
        self.status = {"started": iso(now_local()), "reads_ok": 0, "reads_failed": 0}
        self.today = None
        self.prev = None  # (time, reading) for the counters

    def _open(self, d):
        if self.f:
            self.f.close()
        self.day = d
        self.f = open(os.path.join(args.data, f"{d}.jsonl"), "a")
        self.today = {"day": d, "reads": 0, "bat_out_wh": 0.0, "bat_in_wh": 0.0, "bat_out_ah": 0.0, "bat_in_ah": 0.0,
                      "out_wh": 0.0, "grid_wh": 0.0, "on_battery_s": 0.0, "gaps_s": 0.0}
        self.prev = None
        self.replay(d)
        self._gzip_old()

    def _gzip_old(self):
        keep = {(now_local().date() - timedelta(days=i)).isoformat() for i in range(3)}
        for name in os.listdir(args.data):
            if name.endswith(".jsonl") and name[:10] not in keep and name[:4].isdigit():
                p = os.path.join(args.data, name)
                with open(p, "rb") as src, gzip.open(p + ".gz", "wb") as dst:
                    shutil.copyfileobj(src, dst)
                os.remove(p)
                event("gzipped", file=name)

    def write(self, rec):
        d = rec["t"][:10]
        if d != self.day:
            self._open(d)
        self.f.write(json.dumps(rec, separators=(",", ":")) + "\n")
        self.f.flush()
        os.fsync(self.f.fileno())  # each reading on the disk before the next: a power cut loses at most the one being read

    def replay(self, d):
        """After a restart: today's counters again, from today's file."""
        p = os.path.join(args.data, f"{d}.jsonl")
        if not os.path.exists(p):
            return
        with open(p) as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if "bat_w" in rec:
                    self._count(datetime.fromisoformat(rec["t"]).timestamp(), rec)

    def reading(self, t_epoch, rec):
        d = rec["t"][:10]
        self.write(rec)
        self._count(t_epoch, rec)
        self.status["reads_ok"] += 1
        self.status["last"] = rec
        self.status["today"] = {k: (round(v, 2) if isinstance(v, float) else v) for k, v in self.today.items()}
        self.flush_status()

    def _count(self, t_epoch, rec):
        """Counters: energy by the trapezoid between consecutive readings; a gap over 60 s is not bridged."""
        td = self.today
        td["reads"] += 1
        if self.prev and self.prev[1]["t"][:10] == rec["t"][:10]:
            dt = t_epoch - self.prev[0]
            if dt <= 60:
                a, b = self.prev[1], rec
                h = dt / 3600
                bw = (a["bat_w"] + b["bat_w"]) / 2
                ba = (a["bat_a"] + b["bat_a"]) / 2
                if bw < 0:
                    td["bat_out_wh"] += -bw * h
                else:
                    td["bat_in_wh"] += bw * h
                if ba < 0:
                    td["bat_out_ah"] += -ba * h
                else:
                    td["bat_in_ah"] += ba * h
                td["out_wh"] += (a["out_w"] + b["out_w"]) / 2 * h
                td["grid_wh"] += max(0, (a["grid_w"] + b["grid_w"]) / 2) * h
                if b["mode"] == 3:
                    td["on_battery_s"] += dt
            else:
                td["gaps_s"] += dt
        self.prev = (t_epoch, rec)

    def flush_status(self, **extra):
        self.status.update(extra)
        self.status["written"] = iso(now_local())
        write_json_atomic(os.path.join(args.data, "status.json"), self.status)


# ---------- the cloud poller's freshness ----------
def cloud_last_packet():
    """Device time of the newest row in the cloud log, as epoch seconds (None if unreadable)."""
    try:
        with open(args.cloud_log, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 8192))
            lines = f.read().decode("utf-8", "replace").strip().split("\n")
        for line in reversed(lines):
            try:
                ts = json.loads(line).get("timestamp")
            except ValueError:
                continue
            if ts:
                return datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").astimezone().timestamp()
    except OSError:
        return None
    return None


# ---------- main loop ----------
def my_ip():
    """This Mac's address on the dongle's network: the source address of a route towards it (nothing is sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((args.dongle or args.broadcast, 9))
        return s.getsockname()[0]
    finally:
        s.close()


def bind_listener(retry_s=30):
    while True:
        try:
            srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            srv.bind(("0.0.0.0", TCP_PORT))
            srv.listen(2)
            return srv
        except OSError as e:
            event("listen-failed", err=str(e), retry_s=retry_s)
            srv.close()
            time.sleep(retry_s)


def yield_request():
    """The writer's request to step aside: {"job", "until"} while it is in force, else None."""
    try:
        with open(os.path.join(args.data, "yield.json")) as f:
            y = json.load(f)
        return y if float(y.get("until", 0)) > time.time() else None
    except (OSError, ValueError, TypeError):
        return None


def main():
    store = Store()
    srv = bind_listener()
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    udp.bind(("0.0.0.0", 0))
    event("start", every_s=args.every, pid=os.getpid())

    conn = None
    last_announce = 0.0
    next_live = time.time()
    next_status = 0.0
    next_cloud_check = 0.0
    fails = 0
    resting_until = 0.0  # back-off: no announcing, no connection
    guard_armed = True
    released_cloud_ts = None

    yielded = None
    while not args.once or time.time() - T_START < args.once:
        now = time.time()

        # the settings writer asks for the dongle: let go of it and of the port until it is done
        y = yield_request()
        if y:
            if yielded != y.get("job"):
                if conn:
                    conn.close()
                    conn = None
                if srv:
                    srv.close()
                    srv = None
                yielded = y.get("job")
                event("yielded", job=yielded)
                store.flush_status(connected=False, yielded={"job": yielded, "since": iso(now_local())})
            time.sleep(0.3)
            continue
        if yielded is not None:
            srv = bind_listener(retry_s=3)
            event("resumed", job=yielded)
            yielded = None
            last_announce = 0.0
            store.flush_status(yielded=None)

        # the guard: is the cloud still getting packets while we hold the dongle?
        if now >= next_cloud_check:
            next_cloud_check = now + 60
            cts = cloud_last_packet()
            age_min = (now - cts) / 60 if cts else None
            store.flush_status(cloud_last_packet=iso(datetime.fromtimestamp(cts).astimezone()) if cts else None,
                               cloud_age_min=round(age_min, 1) if age_min is not None else None,
                               guard_armed=guard_armed, resting_until=iso(datetime.fromtimestamp(resting_until).astimezone()) if resting_until > now else None)
            if age_min is not None and age_min < args.stale_min and not guard_armed:
                guard_armed = True
                event("guard-armed", note="the cloud is fresh again")
            if released_cloud_ts is not None and now >= resting_until:
                if cts and cts > released_cloud_ts:
                    event("cloud-back-while-away", note="the cloud got packets once we let go: holding may be the cause")
                else:
                    guard_armed = False
                    event("cloud-silent-while-away", note="the cloud stayed silent without us too: not ours; guard rests")
                released_cloud_ts = None
            if (conn and guard_armed and not guard_off() and age_min is not None and age_min >= args.stale_min
                    and now - conn.since >= args.stale_min * 60):
                event("backoff", cloud_age_min=round(age_min, 1), rest_min=args.backoff_min)
                conn.close()
                conn = None
                store.flush_status(connected=False)
                resting_until = now + args.backoff_min * 60
                released_cloud_ts = cts

        if conn is None:
            if now < resting_until:
                time.sleep(min(30, resting_until - now))
                continue
            if now - last_announce >= 15:
                msg = f"set>server={args.me or my_ip()}:{TCP_PORT};".encode()
                for dest in [d for d in (args.dongle, args.broadcast) if d]:
                    try:
                        udp.sendto(msg, (dest, UDP_PORT))
                    except OSError as e:
                        event("udp-error", dest=dest, err=str(e))
                last_announce = now
            r, _, _ = select.select([srv, udp], [], [], 1.0)
            if udp in r:
                udp.recvfrom(2048)
            if srv in r:
                s, addr = srv.accept()
                conn = Conn(s, addr[0])
                fails = 0
                try:
                    conn.s.sendall(heartbeat(conn.next_tid(), 60))
                    f = conn.read_frame(8)
                    pn = f[4][:20].decode("ascii", "replace").strip("\x00") if f else None
                except (OSError, ConnectionError) as e:
                    pn = f"error: {e}"
                event("connected", peer=addr[0], pn=pn)
                store.flush_status(connected=True, connected_since=iso(now_local()), pn=pn)
                next_live = time.time()
            continue

        # a second dial-in replaces the first connection
        r, _, _ = select.select([srv], [], [], 0)
        if srv in r:
            s, addr = srv.accept()
            event("redial", peer=addr[0])
            conn.close()
            conn = Conn(s, addr[0])

        try:
            if now >= next_status:
                words, note, secs = conn.read_regs(*STATUS)
                if words:
                    store.write({"t": iso(now_local()), "status": words})
                next_status = now + 60
            if now >= next_live:
                next_live = max(next_live + args.every, now + args.every * 0.5)
                t0 = time.time()
                words, note, secs = conn.read_regs(*LIVE)
                if words:
                    fails = 0
                    rec = {"t": iso(datetime.fromtimestamp(t0).astimezone()), "ms": round(secs * 1000), **decode_live(words), "r": words}
                    store.reading(t0, rec)
                else:
                    fails += 1
                    store.status["reads_failed"] += 1
                    if fails in (1, 3) or fails % 20 == 0:
                        event("read-failed", note=note, in_a_row=fails)
                    if fails >= 6:
                        raise ConnectionError(f"{fails} reads failed in a row")
        except (OSError, ConnectionError) as e:
            event("disconnected", err=str(e), held_s=round(time.time() - conn.since))
            conn.close()
            conn = None
            last_announce = 0.0
            store.flush_status(connected=False)
            time.sleep(5)
            continue
        time.sleep(max(0.05, min(next_live, next_status) - time.time()))

    if conn:
        conn.close()
    event("stop", note="--once elapsed")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        event("stop", note="interrupted")
