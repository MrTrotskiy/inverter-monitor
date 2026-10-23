#!/usr/bin/env python3
"""Log in to DessMonitor once and cache the token.

The password is read straight from this terminal, is never echoed, never
written to disk, and never leaves this process. Only the returned token and
secret are stored, in ~/.config/dessmonitor/token.json with owner-only
permissions.

Usage:
    python3 dess_login.py
"""

import getpass
import os
import sys
import time

import dess_api


def main():
    if not sys.stdin.isatty():
        sys.exit(
            "This script needs a real terminal to read the password safely.\n"
            "It cannot run through a non-interactive shell.\n\n"
            "Open a terminal on this machine (or ssh into it) and run:\n"
            f"    cd {os.path.dirname(os.path.abspath(__file__))} && python3 dess_login.py"
        )

    print("DessMonitor / SmartESS login (same account as the mobile app)\n")
    username = input("Login (email or phone): ").strip()
    if not username:
        sys.exit("No login given.")
    password = getpass.getpass("Password (not shown): ")
    if not password:
        sys.exit("No password given.")

    try:
        creds = dess_api.login(username, password)
    except Exception as err:
        sys.exit(f"Login failed: {err}")

    days = (creds["expires_at"] - time.time()) / 86400
    print(f"\nOK. Token saved to {dess_api.TOKEN_PATH}")
    print(f"Valid for about {days:.1f} days.")
    print("Now run:  python3 scripts/dess_poll.py")


if __name__ == "__main__":
    main()
