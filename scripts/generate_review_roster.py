#!/usr/bin/env python3
"""Generate pre-filled review workspace files from verified participant mapping.

Generates:
1. data/verified-badge-counts-source.csv: Machine-readable audited source CSV
   for downstream ingestion.
2. data/participant-verification-workspace.csv: Human-friendly review sheet
   with serial numbers and clickable public profile links.

Strict safety:
- Badge counts are strictly left blank ("").
- Review status is set to "pending".
- No counts are estimated, fabricated, or fetched.
- Output is deterministic and UTF-8 encoded with BOM for Excel compatibility.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

DEFAULT_MAPPING_PATH = Path(
    os.path.expandvars(
        r"%LOCALAPPDATA%\Temp\gdg-aceit-badge-count-mapping-20261103-014921\participant-profile-mapping.csv"
    )
)

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
PROFILE_PATH_RE = re.compile(r"^/public_profiles/([A-Za-z0-9_-]{1,128})/?$")
ALLOWED_HOSTS = {
    "skills.google",
    "www.skills.google",
    "cloudskillsboost.google",
    "www.cloudskillsboost.google",
}

SOURCE_HEADERS = [
    "participant_uuid",
    "participant_name",
    "profile_url",
    "verified_badge_count",
    "review_status",
    "reviewer",
    "reviewed_at",
    "review_note",
]

WORKSPACE_HEADERS = [
    "serial_number",
    "participant_name",
    "profile_url",
    "verified_badge_count",
    "review_status",
    "reviewer",
    "reviewed_at",
    "review_note",
]


class ValidationError(Exception):
    """Raised when participant mapping fails validation."""
    pass


def validate_profile_url(url: str) -> tuple[str, str]:
    """Validate profile URL. Returns (canonical_url, profile_id)."""
    try:
        parsed = urlsplit(url.strip())
        if (
            parsed.scheme.lower() != "https"
            or not parsed.hostname
            or parsed.hostname.lower() not in ALLOWED_HOSTS
            or parsed.username
            or parsed.password
            or parsed.port
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("invalid_url_structure")
        match = PROFILE_PATH_RE.fullmatch(parsed.path)
        if not match:
            raise ValueError("invalid_profile_path")
        profile_id = match.group(1).lower()
        return url.strip(), profile_id
    except (ValueError, TypeError) as err:
        raise ValidationError(f"Invalid profile URL '{url}': {err}") from None


def load_and_validate_mapping(mapping_path: Path) -> list[dict[str, str]]:
    """Load mapping CSV, strictly validating all participant records."""
    if not mapping_path.exists():
        raise ValidationError(f"Mapping file not found at: {mapping_path}")

    try:
        raw = mapping_path.read_bytes()
        text = raw.decode("utf-8-sig")
    except Exception as err:
        raise ValidationError(f"Cannot read mapping file: {err}") from None

    lines = [l for l in text.splitlines() if l.strip() and not l.strip().startswith("#")]
    if not lines:
        raise ValidationError("Mapping file is empty")

    reader = csv.DictReader(io.StringIO("\n".join(lines)))
    if not reader.fieldnames:
        raise ValidationError("Mapping file missing header row")

    rows = list(reader)
    if not rows:
        raise ValidationError("Mapping file contains no data rows")

    seen_uuids: set[str] = set()
    seen_profile_ids: set[str] = set()
    validated: list[dict[str, str]] = []

    for idx, row in enumerate(rows, start=2):
        uuid_str = (row.get("participant_uuid") or row.get("participant_id") or "").strip()
        name = (row.get("participant_name") or row.get("name") or "").strip()
        url = (row.get("profile_url") or row.get("registered_profile_url") or "").strip()
        status = (row.get("match_status") or "matched").strip().lower()

        if not uuid_str:
            raise ValidationError(f"Row {idx}: Missing participant UUID")

        if not UUID_RE.fullmatch(uuid_str):
            raise ValidationError(f"Row {idx}: Malformed participant UUID '{uuid_str}'")

        uuid_lower = uuid_str.lower()
        if uuid_lower in seen_uuids:
            raise ValidationError(f"Row {idx}: Duplicate participant UUID '{uuid_str}'")
        seen_uuids.add(uuid_lower)

        if not name:
            raise ValidationError(f"Row {idx}: Missing participant name for UUID {uuid_str}")

        if not url:
            raise ValidationError(f"Row {idx}: Missing profile URL for participant '{name}'")

        clean_url, profile_id = validate_profile_url(url)
        if profile_id in seen_profile_ids:
            raise ValidationError(f"Row {idx}: Duplicate profile URL '{url}' for participant '{name}'")
        seen_profile_ids.add(profile_id)

        if status != "matched":
            raise ValidationError(f"Row {idx}: Participant '{name}' has status '{status}' (expected 'matched')")

        validated.append({
            "participant_uuid": uuid_lower,
            "participant_name": name,
            "profile_url": clean_url,
        })

    # Sort deterministically by participant name (case-insensitive), then UUID
    validated.sort(key=lambda item: (item["participant_name"].lower(), item["participant_uuid"]))
    return validated


def write_csv_atomic(path: Path, headers: list[str], rows: list[dict[str, Any]]) -> None:
    """Write CSV atomically with UTF-8 BOM for Windows Excel compatibility."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8-sig", newline="", dir=path.parent, delete=False) as temp:
            temp_name = temp.name
            writer = csv.DictWriter(temp, fieldnames=headers, extrasaction="ignore", lineterminator="\r\n")
            writer.writeheader()
            writer.writerows(rows)
        Path(temp_name).replace(path)
    finally:
        if temp_name and Path(temp_name).exists():
            Path(temp_name).unlink()


def generate_workspaces(
    mapping_path: Path,
    source_out: Path,
    workspace_out: Path,
) -> tuple[int, Path, Path]:
    """Generate both source and human-friendly workspace files."""
    participants = load_and_validate_mapping(mapping_path)

    # 1. Generate machine-readable source CSV
    source_rows = [
        {
            "participant_uuid": p["participant_uuid"],
            "participant_name": p["participant_name"],
            "profile_url": p["profile_url"],
            "verified_badge_count": "",  # Strictly blank
            "review_status": "pending",
            "reviewer": "",
            "reviewed_at": "",
            "review_note": "",
        }
        for p in participants
    ]
    write_csv_atomic(source_out, SOURCE_HEADERS, source_rows)

    # 2. Generate human-friendly review workspace CSV
    workspace_rows = [
        {
            "serial_number": str(idx),
            "participant_name": p["participant_name"],
            "profile_url": p["profile_url"],
            "verified_badge_count": "",  # Strictly blank
            "review_status": "pending",
            "reviewer": "",
            "reviewed_at": "",
            "review_note": "",
        }
        for idx, p in enumerate(participants, start=1)
    ]
    write_csv_atomic(workspace_out, WORKSPACE_HEADERS, workspace_rows)

    return len(participants), source_out, workspace_out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mapping",
        type=Path,
        default=DEFAULT_MAPPING_PATH,
        help="Path to participant-profile-mapping.csv",
    )
    parser.add_argument(
        "--source-output",
        type=Path,
        default=Path("data/verified-badge-counts-source.csv"),
        help="Path to output audited source CSV",
    )
    parser.add_argument(
        "--workspace-output",
        type=Path,
        default=Path("data/participant-verification-workspace.csv"),
        help="Path to output human review sheet",
    )
    parser.add_argument(
        "--summary",
        type=Path,
        help="Optional path to output JSON summary",
    )
    args = parser.parse_args()

    try:
        count, src_path, ws_path = generate_workspaces(
            args.mapping,
            args.source_output,
            args.workspace_output,
        )

        summary_data = {
            "status": "success",
            "total_participants": count,
            "source_file": str(src_path.resolve()),
            "workspace_file": str(ws_path.resolve()),
            "mapping_file": str(args.mapping.resolve()),
            "badge_counts_state": "all_blank",
            "default_review_status": "pending",
        }

        if args.summary:
            args.summary.parent.mkdir(parents=True, exist_ok=True)
            args.summary.write_text(json.dumps(summary_data, indent=2) + "\n", encoding="utf-8")

        print("=== VERIFICATION WORKSPACE GENERATION COMPLETE ===")
        print(f"Total Participants Processed: {count}")
        print(f"Audited Source Output: {src_path.resolve()}")
        print(f"Review Workspace Output: {ws_path.resolve()}")
        print("Badge Counts Status: All blank (zero fabricated counts)")
        print("Review Status: All set to 'pending'")
        return 0

    except ValidationError as err:
        print(f"VALIDATION_FAILED: {err}", file=sys.stderr)
        return 2
    except Exception as err:
        print(f"UNEXPECTED_ERROR: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

