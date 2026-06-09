#!/usr/bin/env python3
"""
Standalone Google Ads customers:listAccessibleCustomers check (no app code paths).

Usage (token from env):
  set GOOGLE_ADS_DEVELOPER_TOKEN=...
  set GOOGLE_ADS_ACCESS_TOKEN=...
  python scripts/debug_google_ads_list_customers.py

Usage (fetch access token from Mongo via Node helper):
  python scripts/debug_google_ads_list_customers.py <businessId>
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Install requests: pip install requests", file=sys.stderr)
    sys.exit(1)

BACKEND_DIR = Path(__file__).resolve().parent.parent


def load_dotenv_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


load_dotenv_file(BACKEND_DIR / ".env")

ORIGIN = os.environ.get("GOOGLE_ADS_API_ORIGIN", "https://googleads.googleapis.com").strip()
API_VERSION = os.environ.get("GOOGLE_ADS_API_VERSION", "v24").strip()
DEVELOPER_TOKEN = os.environ.get("GOOGLE_ADS_DEVELOPER_TOKEN", "").strip()


def redact(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "****"
    return f"{value[:4]}…{value[-4:]}"


def fetch_access_token_from_mongo(business_id: str) -> str:
    result = subprocess.run(
        ["node", "scripts/printGoogleAdsAccessToken.js", business_id],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Failed to load access token from Mongo")
    token = result.stdout.strip()
    if not token:
        raise RuntimeError("Empty access token from Mongo")
    return token


def resolve_access_token() -> tuple[str, str]:
    business_id = sys.argv[1].strip() if len(sys.argv) > 1 else ""
    from_env = os.environ.get("GOOGLE_ADS_ACCESS_TOKEN", "").strip()
    if from_env:
        return from_env, "GOOGLE_ADS_ACCESS_TOKEN"
    if business_id:
        return fetch_access_token_from_mongo(business_id), f"Mongo ({business_id})"
    print("Usage:", file=sys.stderr)
    print("  GOOGLE_ADS_ACCESS_TOKEN=... python scripts/debug_google_ads_list_customers.py", file=sys.stderr)
    print("  python scripts/debug_google_ads_list_customers.py <businessId>", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    if not DEVELOPER_TOKEN:
        print("GOOGLE_ADS_DEVELOPER_TOKEN is required", file=sys.stderr)
        return 1

    access_token, source = resolve_access_token()
    url = f"{ORIGIN}/{API_VERSION}/customers:listAccessibleCustomers"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "developer-token": DEVELOPER_TOKEN,
        "Content-Type": "application/json",
    }

    print("Google Ads listAccessibleCustomers (Python standalone)")
    print("Access token source:", source)
    print("URL:", url)
    print(
        "Headers:",
        json.dumps(
            {
                "Authorization": f"Bearer {redact(access_token)}",
                "developer-token": redact(DEVELOPER_TOKEN),
                "login-customer-id": "(omitted)",
            },
            indent=2,
        ),
    )

    response = requests.get(url, headers=headers, timeout=30)
    print("HTTP status:", response.status_code)

    try:
        body = response.json()
        print("Response JSON:", json.dumps(body, indent=2))
    except ValueError:
        print("Response body:", response.text[:500])
        body = None

    if response.status_code != 200:
        return 1

    resource_names = body.get("resourceNames", []) if isinstance(body, dict) else []
    customer_ids = [
        name.split("/", 1)[1]
        for name in resource_names
        if isinstance(name, str) and name.startswith("customers/")
    ]
    print("customerIds:", customer_ids)
    print("count:", len(customer_ids))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
