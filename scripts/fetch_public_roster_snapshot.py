#!/usr/bin/env python3
"""Read-only snapshot of the public production leaderboard projection.

Uses the same anonymous Supabase URL and publishable key the public site uses.
Only public columns exposed by the leaderboard are read. No credentials are
written to the output and no write operation is performed.
"""

from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path

PARTICIPANT_COLUMNS = (
    "id,display_name,profile_url,verified_badge_count,skill_badge_count,"
    "arcade_game_badge_count,last_verified_at,verification_source"
)


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def request_json(url: str, key: str, path: str, body: dict | None = None) -> object:
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url + path, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(".env.local"))
    parser.add_argument("--output-dir", type=Path, default=Path("data/badge-verification-latest"))
    args = parser.parse_args()

    env = read_env(args.env_file)
    url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]

    query = urllib.parse.urlencode(
        {"select": PARTICIPANT_COLUMNS, "order": "id.asc", "limit": "1000"}
    )
    participants = request_json(url, key, f"/rest/v1/participants?{query}")
    summary = request_json(url, key, "/rest/v1/rpc/get_public_summary", body={})

    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "production-roster-snapshot.json").write_text(
        json.dumps(participants, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (args.output_dir / "production-summary-snapshot.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Saved {len(participants)} production participant rows.")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
