"""Eybond framing and Modbus RTU for the settings writer and the fake inverter (the same wire format as
collector/collector.py, which keeps its own read-only copy on purpose)."""
import select
import struct
import time
from datetime import datetime, timezone

HEADER = 8
SLAVE = 1


def crc16(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def rtu(body):
    return body + struct.pack("<H", crc16(body))


def crc_ok(frame):
    return len(frame) >= 4 and crc16(frame[:-2]) == struct.unpack("<H", frame[-2:])[0]


def mb_read(addr, count, slave=SLAVE):
    return rtu(struct.pack(">BBHH", slave, 3, addr, count))


def mb_write(addr, value, slave=SLAVE):
    """Function 6: write one holding register."""
    return rtu(struct.pack(">BBHH", slave, 6, addr, value))


def mb_write_multi(addr, value, slave=SLAVE):
    """Function 16 with one register: for firmwares that refuse function 6."""
    return rtu(struct.pack(">BBHHBH", slave, 16, addr, 1, 2, value))


def header(tid, devcode, total, devaddr, fc):
    return struct.pack(">HHHBB", tid, devcode, total - 6, devaddr, fc)


def heartbeat(tid, interval=60):
    n = datetime.now(timezone.utc)
    p = bytes([n.year - 2000, n.month, n.day, n.hour, n.minute, n.second]) + struct.pack(">H", interval)
    return header(tid, 0, HEADER + len(p), 1, 1) + p


def forward(tid, frame, devcode=0x0994, devaddr=1):
    return header(tid, devcode, HEADER + len(frame), devaddr, 4) + frame


class Link:
    """One dongle connection: Eybond frames out, the matching answer back."""

    def __init__(self, sock):
        self.s, self.buf, self.tid = sock, b"", 0
        self.s.settimeout(None)

    def next_tid(self):
        self.tid = (self.tid + 1) & 0xFFFF
        return self.tid

    def frame(self, timeout):
        end = time.time() + timeout
        while True:
            if len(self.buf) >= HEADER:
                tid, devcode, wl, addr, fc = struct.unpack(">HHHBB", self.buf[:HEADER])
                total = wl + 6
                if len(self.buf) >= total:
                    payload, self.buf = self.buf[HEADER:total], self.buf[total:]
                    return tid, fc, payload
            rem = end - time.time()
            if rem <= 0:
                return None
            r, _, _ = select.select([self.s], [], [], rem)
            if not r:
                return None
            chunk = self.s.recv(4096)
            if not chunk:
                raise ConnectionError("the dongle closed the connection")
            self.buf += chunk

    def hello(self):
        self.s.sendall(heartbeat(self.next_tid()))
        f = self.frame(8)
        return f[2][:20].decode("ascii", "replace").strip("\x00") if f else None

    def ask(self, rtu_frame, timeout=6.0):
        """Send one Modbus request -> (answer payload or None, note)."""
        tid = self.next_tid()
        self.s.sendall(forward(tid, rtu_frame))
        end = time.time() + timeout
        while True:
            f = self.frame(max(0.0, end - time.time()))
            if f is None:
                return None, "timeout"
            rtid, fc, payload = f
            if fc == 4 and rtid == tid:
                if not payload:
                    return None, "empty"
                if not crc_ok(payload):
                    return None, "crc"
                if payload[1] & 0x80:
                    return None, f"exception {payload[2]}"
                return payload, "ok"

    def read(self, addr, count):
        p, note = self.ask(mb_read(addr, count))
        if p is None:
            return None, note
        if p[2] != 2 * count:
            return None, "size"
        return list(struct.unpack(f">{count}H", p[3:3 + 2 * count])), "ok"

    def write(self, addr, value, multi=False):
        """-> note: 'ok' when the inverter echoed the write, else why not."""
        req = mb_write_multi(addr, value) if multi else mb_write(addr, value)
        p, note = self.ask(req)
        if p is None:
            return note
        if multi:
            return "ok" if p[:6] == req[:6] else "bad-echo"
        return "ok" if p[:6] == req[:6] else "bad-echo"

    def close(self):
        try:
            self.s.close()
        except OSError:
            pass
