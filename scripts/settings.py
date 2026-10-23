#!/usr/bin/env python3
"""Read the inverter's current configuration.

The cloud will only return one control value per call and times out often, so
this retries each one rather than failing the whole read.

Usage:
    python3 settings.py            # the settings that matter for the battery
    python3 settings.py --all      # every exposed control
"""

import sys
import time

import dess_api
from dess_api import localconfig

# the device in the DessMonitor account, from config.json (cloud.device)
DEVICE = {"i18n": "en_US", **{k: localconfig.get(f"cloud.device.{k}") for k in ("pn", "devcode", "devaddr", "sn")}}

# The controls that decide whether this bank is charged correctly and protected.
BATTERY_CONTROLS = (
    "bat_eybond_ctrl_66",   # Battery Type
    "bat_eybond_ctrl_68",   # Bulk / absorption (C.V.) voltage
    "bat_eybond_ctrl_69",   # Float voltage
    "bat_eybond_ctrl_74",   # Time from C.V. to float
    "bat_eybond_ctrl_70",   # Recovery voltage back to mains
    "bat_eybond_ctrl_71",   # Low DC protection, mains mode
    "bat_eybond_ctrl_73",   # Low DC protection, off-grid mode
    "bat_eybond_ctrl_76",   # Max charging current
    "bat_eybond_ctrl_77",   # Max AC charging current
    "bat_eybond_ctrl_75",   # Charger source priority
    "bse_eybond_ctrl_49",   # Output priority
    "sys_eybond_ctrl_60",   # Battery EQ mode
)


def read_control(control_id, creds, attempts=3):
    for attempt in range(attempts):
        try:
            data = dess_api.call(
                "queryDeviceCtrlValue", {**DEVICE, "id": control_id}, creds
            )["dat"]
            return data.get("name"), data.get("val")
        except Exception:
            if attempt < attempts - 1:
                time.sleep(2)
    return None, None


def main():
    creds = dess_api.load_token_autorenew()
    ids = BATTERY_CONTROLS
    if "--all" in sys.argv:
        fields = dess_api.call("queryDeviceCtrlField", {**DEVICE, "source": "1"}, creds)
        ids = [f["id"] for f in fields["dat"]["field"]]

    for control_id in ids:
        name, value = read_control(control_id, creds)
        if name is None:
            print(f"{control_id:<26} (unreadable — cloud timed out)")
        else:
            print(f"{name:<52} {value}")


if __name__ == "__main__":
    main()
