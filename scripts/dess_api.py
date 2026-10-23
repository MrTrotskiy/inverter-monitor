"""Minimal client for the public DessMonitor / SmartESS API.

Signing scheme, verified against the vendor's own Java example and the
ha-dessmonitor integration:

    login:          sign = sha1(salt + sha1(password) + action_string)
    authenticated:  sign = sha1(salt + secret + token + action_string)

where salt is the current time in milliseconds and action_string is
"&action=<name>" followed by "&key=value" pairs with values percent-encoded
exactly as they are transmitted. Signing a raw value while sending an encoded
one makes the server compute a different signature and reject the call.
"""

import hashlib
import json
import os
import stat
import time
import urllib.request
from pathlib import Path
from urllib.parse import quote_plus

BASE_URL = "https://api.dessmonitor.com/public/"
import sys as _sys  # noqa: E402
_sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "common"))
import localconfig  # noqa: E402

# the DessMonitor web app's company key, from config.json (cloud.companyKey); it is not kept in the code
COMPANY_KEY = localconfig.get("cloud.companyKey", "")
SOURCE = "1"
APP_CLIENT = "web"
APP_ID = "inverter-monitor"
APP_VERSION = "1.0.0"

TOKEN_PATH = Path.home() / ".config" / "dessmonitor" / "token.json"
TIMEOUT_S = 30


def _sha1(text):
    return hashlib.sha1(text.encode()).hexdigest().lower()


def _action_string(action, params):
    parts = [f"&action={action}"]
    for key, value in (params or {}).items():
        # "@" must stay literal or the server computes a different signature,
        # which matters because SmartESS logins are usually email addresses.
        parts.append(f"&{key}={quote_plus(str(value), safe='@')}")
    return "".join(parts)


def _get_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": APP_ID})
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
        payload = json.loads(response.read().decode())
    if payload.get("err", 0) != 0:
        raise RuntimeError(f"API error {payload.get('err')}: {payload.get('desc')}")
    return payload


def login(username, password):
    """Exchange credentials for a token. Returns the saved credential dict."""
    params = {
        "usr": username,
        "company-key": COMPANY_KEY,
        "source": SOURCE,
        "_app_client_": APP_CLIENT,
        "_app_id_": APP_ID,
        "_app_version_": APP_VERSION,
    }
    action_string = _action_string("authSource", params)
    salt = str(int(time.time() * 1000))
    sign = _sha1(salt + _sha1(password) + action_string)
    data = _get_json(f"{BASE_URL}?sign={sign}&salt={salt}{action_string}")["dat"]

    creds = {
        "token": data["token"],
        "secret": data["secret"],
        "expires_at": int(time.time()) + int(data["expire"]),
    }
    save_token(creds)
    return creds


def save_token(creds):
    """Write credentials readable only by the owner."""
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = TOKEN_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(creds))
    os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
    tmp.replace(TOKEN_PATH)


def load_token():
    if not TOKEN_PATH.exists():
        raise SystemExit(
            f"No saved token at {TOKEN_PATH}.\n"
            "Run:  python3 scripts/dess_login.py"
        )
    creds = json.loads(TOKEN_PATH.read_text())
    if creds.get("expires_at", 0) <= time.time():
        raise SystemExit(
            "Saved token has expired.\n"
            "Run again:  python3 scripts/dess_login.py"
        )
    return creds


def call(action, params, creds=None):
    """Make an authenticated API call."""
    creds = creds or load_token()
    action_string = _action_string(action, params)
    salt = str(int(time.time() * 1000))
    sign = _sha1(salt + creds["secret"] + creds["token"] + action_string)
    url = f"{BASE_URL}?sign={sign}&salt={salt}&token={creds['token']}{action_string}"
    return _get_json(url)


def refresh(creds=None):
    """Renew the token without re-entering the password.

    Returns the refreshed credentials, or None if the server refused (in which
    case a full login is needed).
    """
    creds = creds or json.loads(TOKEN_PATH.read_text())
    try:
        data = call("updateToken", {"source": SOURCE}, creds)["dat"]
    except Exception:
        return None
    renewed = {
        "token": data.get("token", creds["token"]),
        "secret": data.get("secret", creds["secret"]),
        "expires_at": int(time.time()) + int(data.get("expire", 604800)),
    }
    save_token(renewed)
    return renewed


def load_token_autorenew(renew_within_days=2):
    """Load credentials, renewing them when they are close to expiring."""
    creds = load_token()
    if creds["expires_at"] - time.time() < renew_within_days * 86400:
        renewed = refresh(creds)
        if renewed:
            return renewed
    return creds
