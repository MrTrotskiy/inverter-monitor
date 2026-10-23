#!/usr/bin/python3
"""A fake dongle with a fake inverter behind it, for testing the collector and the settings writer without the real
one. It behaves like the Eybond dongle seen on 2026-10-23: a UDP `set>server=<ip>:<port>;` on its UDP port makes it
answer `rsp>server=2;` and dial TCP to that address; FC=1 heartbeats are answered with its PN, FC=4 carries Modbus
RTU to the inverter (slave 1). The inverter answers function 3 from its registers (the real words read on
2026-10-23), function 6 and 16 within the manual's rules (exception 3 otherwise), anything else with exception 1.

Faults to test with: --battery (mode 3), --charging-a A, --ignore-writes REG (echoes, keeps the old value),
--refuse REG (exception 3), --drop-after N (closes the link after N writes), --no-fc6 (exception 1 on function 6),
--silent-writes (no answer to writes). Its registers are dumped to --state after every write.
"""
import argparse
import json
import select
import socket
import struct
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from eybond import HEADER, crc16, header, rtu  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--udp-port", type=int, default=58999)
ap.add_argument("--host", default="127.0.0.1")
ap.add_argument("--state", default=None)
ap.add_argument("--battery", action="store_true")
ap.add_argument("--charging-a", type=float, default=0.0)
ap.add_argument("--ignore-writes", type=int, action="append", default=[])
ap.add_argument("--refuse", type=int, action="append", default=[])
ap.add_argument("--drop-after", type=int, default=0)
ap.add_argument("--no-fc6", action="store_true")
ap.add_argument("--silent-writes", action="store_true")
ap.add_argument("--set", action="append", default=[], help="REG=VALUE at start")
args = ap.parse_args()

R = {}
for start, words in ((300, [0, 0, 1, 3, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 65535, 60927, 0, 0, 0, 0, 2300, 5000, 8, 160, 141, 141]),
                     (327, [127, 0, 117, 0, 2, 500, 500, 146, 60, 120, 30, 1, 1, 0, 20, 30, 10]),
                     (100, [0] * 10)):
    for i, w in enumerate(words):
        R[start + i] = w
live = [2, 2299, 5000, 95, 0, 0, 0, 71, 0, 2300, 4, 5000, 72, 85, 134, int(args.charging_a * 10) & 0xFFFF, 0, 0, 0, 0, 0, 0, 0, 0, 3, 24, 0, 0, 100, 0, 0, 0, 0, 0]
if args.battery:
    live[0] = 3
    live[15] = (-56) & 0xFFFF
for i, w in enumerate(live):
    R[201 + i] = w
for kv in args.set:
    k, v = kv.split("=")
    R[int(k)] = int(v)
writes = 0


def dump():
    if args.state:
        Path(args.state).write_text(json.dumps({str(k): v for k, v in R.items() if 300 <= k < 350}))


def allowed(reg, val):
    """The manual's rules, as the real inverter is expected to enforce them."""
    if reg in args.refuse:
        return False
    rng = {301: (0, 3), 302: (0, 2), 303: (0, 3), 305: (0, 1), 306: (0, 1), 307: (0, 1), 308: (0, 1), 309: (0, 1), 310: (0, 1),
           320: (2200, 2400), 321: (5000, 6000), 324: (120, 155), 325: (120, 155), 327: (100, 140), 329: (100, 135), 331: (0, 3),
           332: (100, 1000), 333: (20, 600)}
    if reg not in rng or not (rng[reg][0] <= val <= rng[reg][1]):
        return False
    if reg == 325 and val > R[324]:
        return False  # float above C.V. (P27 <= P26)
    if reg == 324 and val < R[325]:
        return False
    if reg == 333 and val > R[332]:
        return False
    return True


def answer(req):
    global writes
    if len(req) < 8 or crc16(req[:-2]) != struct.unpack("<H", req[-2:])[0]:
        return None
    slave, fn = req[0], req[1]
    exc = lambda code: rtu(bytes([slave, fn | 0x80, code]))
    if fn == 3:
        addr, n = struct.unpack(">HH", req[2:6])
        if any(a not in R for a in range(addr, addr + n)):
            return exc(2)
        return rtu(bytes([slave, 3, 2 * n]) + b"".join(struct.pack(">H", R[a]) for a in range(addr, addr + n)))
    if fn in (6, 16):
        if fn == 6 and args.no_fc6:
            return exc(1)
        if args.silent_writes:
            return b""
        if fn == 6:
            addr, val = struct.unpack(">HH", req[2:6])
            echo = req[:6]
        else:
            addr, n, nb = struct.unpack(">HHB", req[2:7])
            val = struct.unpack(">H", req[7:9])[0]
            echo = req[:6]
        if not allowed(addr, val):
            return exc(3)
        writes += 1
        if addr not in args.ignore_writes:
            R[addr] = val
        dump()
        return rtu(echo)
    return exc(1)


def main():
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    udp.bind((args.host, args.udp_port))
    conn, target, buf = None, None, b""
    dump()
    print(f"fake inverter on udp {args.host}:{args.udp_port}", flush=True)
    while True:
        socks = [udp] + ([conn] if conn else [])
        r, _, _ = select.select(socks, [], [], 1.0)
        if udp in r:
            data, peer = udp.recvfrom(2048)
            msg = data.decode("ascii", "replace")
            if msg.startswith("set>server="):
                ip, port = msg[len("set>server="):].rstrip(";\r\n").split(":")
                udp.sendto(b"rsp>server=2;\r\n", peer)
                if conn is None or target != (ip, int(port)):
                    if conn:
                        conn.close()
                    try:
                        conn = socket.create_connection((ip, int(port)), timeout=3)
                        target, buf = (ip, int(port)), b""
                    except OSError:
                        conn, target = None, None
        if conn and conn in r:
            try:
                chunk = conn.recv(4096)
            except OSError:
                chunk = b""
            if not chunk:
                conn.close()
                conn, target = None, None
                continue
            buf += chunk
            while len(buf) >= HEADER:
                tid, devcode, wl, addr, fc = struct.unpack(">HHHBB", buf[:HEADER])
                total = wl + 6
                if len(buf) < total:
                    break
                payload, buf = buf[HEADER:total], buf[total:]
                if fc == 1:
                    pn = b"FAKE0000000000000000"
                    conn.sendall(header(tid, 0x0102, HEADER + len(pn), 0xFF, 1) + pn)
                elif fc == 4:
                    out = answer(payload)
                    if out is None:
                        continue
                    if out:
                        conn.sendall(header(tid, devcode, HEADER + len(out), addr, 4) + out)
                    if args.drop_after and writes >= args.drop_after and payload[1] in (6, 16):
                        args.drop_after = 0  # once
                        time.sleep(0.2)
                        conn.close()
                        conn, target = None, None
                        break


if __name__ == "__main__":
    main()
