# writer/

Changes the inverter's settings through the dongle, one job at a time. It is started by the admin
(`admin/actions.mjs`) after the PIN and the checks; it is never a service and the collector stays read-only.

- `settings_writer.py --job data/settings/jobs/<id>.json`: one job, then it exits.
  1. asks the collector to step aside (`data/dongle/yield.json`) and waits until it has;
  2. announces itself to the dongle on the same port (8899), takes the connection, reads the live block:
     **only on mains (mode 2) and not charging above 40 A**, otherwise nothing is written;
  3. reads all settings (300..325, 327..343) as a snapshot (`data/settings/snapshots/<id>.json`); every change's
     "from" must equal the inverter's value now, otherwise nothing is written;
  4. per register: Modbus function 6 (16 if the firmware answers "illegal function"), wait, read back, compare.
     A refusal, no answer, a different value or a dropped link stops the job and every register it tried is put
     back from the snapshot (read first; written only if it changed; read back), the link taken again if it broke;
  5. reads the settings again (`data/settings/current.json`), journals every write and rollback
     (`data/settings/journal.jsonl`), removes `yield.json`; the collector binds again and reads on.
- `allowed.json`: the only registers it may write, with their raw ranges (the inverter's manual, 12 V model). Anything else
  is refused before the dongle is touched. `admin/check.mjs` checks that the admin's catalog agrees.
- `eybond.py`: Eybond framing and Modbus RTU (read, write single, write multiple).
- `fake_inverter.py`: a fake dongle + inverter for tests (the real words of 2026-10-23, the manual's rules, faults on
  demand: on battery, charging hard, refuse a register, ignore writes, no answer, drop the link, no function 6).
- `check_writer.py`: 16 checks end to end against the fake, with the real collector in a sandbox.

A job file: `{"id", "kind": "write"|"read", "changes": [{"id", "reg", "from", "to"}]}` (raw words); the writer adds
`state` (waiting, connecting, reading, writing, rolling-back, then done | failed | failed-rollback | refused),
`why`, `steps`. `failed` means stopped and everything put back; `failed-rollback` means something could not be
put back: the steps say which register holds what.

Not yet verified on the real inverter (it was off when this was written): that its dongle relays function 6, that
the inverter accepts writes while on mains, and how long it takes to apply one. The first real write is to be one
harmless setting (the screen backlight, register 305), done with the owner.
