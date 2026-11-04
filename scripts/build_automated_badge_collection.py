#!/usr/bin/env python3
"""Build automated badge collection CSV from parse_results.json.

Generates:
data/automated-badge-counts.csv

Integrates with the existing verification pipeline:
- Retains exact participant_uuid, participant_name, and profile_url mapping.
- Sets review_status = 'verified' only for genuine non-zero or confirmed zero badges.
- Leaves verified_badge_count strictly blank for inaccessible, failed, or invalid profiles.
- Generates informative review_note for audit logging.
- Optionally exports the exact 3-column preparation source:
  profile_url,verified_badge_count,review_note
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

CSV_HEADERS = [
    "participant_uuid",
    "participant_name",
    "profile_url",
    "verified_badge_count",
    "review_status",
    "reviewer",
    "reviewed_at",
    "review_note",
]
EXPORT_3COL_HEADERS = ["profile_url", "verified_badge_count", "review_note"]


def read_canonical_roster(source_csv: Path) -> list[dict[str, str]]:
    """Read canonical roster preserving order and identifiers."""
    with source_csv.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return list(reader)


def write_csv_atomic(path: Path, headers: list[str], rows: list[dict[str, str]]) -> None:
    """Write CSV atomically with UTF-8 BOM."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8-sig", newline="", dir=path.parent, delete=False) as temp:
            temp_path = temp.name
            writer = csv.DictWriter(temp, fieldnames=headers, lineterminator="\r\n")
            writer.writeheader()
            writer.writerows(rows)
        Path(temp_path).replace(path)
    finally:
        if temp_path and Path(temp_path).exists():
            Path(temp_path).unlink()


def build_collection(
    parse_results_path: Path,
    source_roster_path: Path,
    output_csv_path: Path,
    export_3col_path: Path | None = None,
) -> dict[str, Any]:
    """Merge parse results into canonical roster format and export CSVs."""
    if not parse_results_path.is_file():
        raise FileNotFoundError(f"Parse results not found: {parse_results_path}")

    parse_data = json.loads(parse_results_path.read_text(encoding="utf-8"))
    results = parse_data.get("results", {})

    canonical_rows = read_canonical_roster(source_roster_path)
    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    output_rows: list[dict[str, str]] = []
    export_3col_rows: list[dict[str, str]] = []

    verified_nonzero = 0
    verified_zero = 0
    flagged = 0
    unreachable = 0
    pending = 0
    all_verified_counts: list[int] = []

    for row in canonical_rows:
        uuid = row["participant_uuid"]
        name = row["participant_name"]
        url = row["profile_url"]

        record = results.get(uuid)
        if not record:
            # Profile not yet parsed / in manifest
            pending += 1
            output_rows.append({
                "participant_uuid": uuid,
                "participant_name": name,
                "profile_url": url,
                "verified_badge_count": "",
                "review_status": "pending",
                "reviewer": "",
                "reviewed_at": "",
                "review_note": "",
            })
            continue

        parse_status = record.get("parseStatus")
        badge_count = record.get("badgeCount", 0)

        if parse_status == "verified_nonzero":
            verified_nonzero += 1
            all_verified_counts.append(badge_count)
            count_str = str(badge_count)
            status = "verified"
            note = f"Automated collection: {badge_count} unique badges observed from public profile"
            export_3col_rows.append({
                "profile_url": url,
                "verified_badge_count": count_str,
                "review_note": note,
            })
        elif parse_status == "verified_zero":
            verified_zero += 1
            all_verified_counts.append(0)
            count_str = "0"
            status = "verified"
            note = "Automated collection: confirmed 0 public badges (empty profile)"
            export_3col_rows.append({
                "profile_url": url,
                "verified_badge_count": count_str,
                "review_note": note,
            })
        elif parse_status in ("inaccessible", "identity_mismatch", "invalid_html"):
            flagged += 1
            count_str = ""
            status = "flagged"
            reasons = "; ".join(record.get("details", {}).get("reasons", [])) or parse_status
            note = f"Automated collection flagged: {parse_status} ({reasons})"
        else:
            unreachable += 1
            count_str = ""
            status = "unreachable"
            fetch_err = record.get("fetchError") or "Fetch failed"
            note = f"Automated collection unreachable: {fetch_err}"

        output_rows.append({
            "participant_uuid": uuid,
            "participant_name": name,
            "profile_url": url,
            "verified_badge_count": count_str,
            "review_status": status,
            "reviewer": "automated_profile_collector",
            "reviewed_at": timestamp,
            "review_note": note,
        })

    # Write output CSV
    write_csv_atomic(output_csv_path, CSV_HEADERS, output_rows)

    if export_3col_path:
        write_csv_atomic(export_3col_path, EXPORT_3COL_HEADERS, export_3col_rows)

    summary: dict[str, Any] = {
        "total_participants": len(output_rows),
        "successfully_verified": verified_nonzero + verified_zero,
        "verified_nonzero": verified_nonzero,
        "verified_zero": verified_zero,
        "unavailable_or_private": flagged,
        "unreachable": unreachable,
        "pending": pending,
        "min_verified_badge_count": min(all_verified_counts) if all_verified_counts else None,
        "max_verified_badge_count": max(all_verified_counts) if all_verified_counts else None,
        "avg_verified_badge_count": round(sum(all_verified_counts) / len(all_verified_counts), 2) if all_verified_counts else None,
        "output_csv": str(output_csv_path.resolve()),
        "export_3col_csv": str(export_3col_path.resolve()) if export_3col_path else None,
    }
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build automated badge counts CSV from parse results."
    )
    parser.add_argument(
        "--parse-results",
        type=Path,
        default=Path("data/raw_profiles/parse_results.json"),
        help="Path to parse_results.json (default: data/raw_profiles/parse_results.json)",
    )
    parser.add_argument(
        "--source-roster",
        type=Path,
        default=Path("data/verified-badge-counts-source.csv"),
        help="Path to canonical source roster (default: data/verified-badge-counts-source.csv)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/automated-badge-counts.csv"),
        help="Output CSV path (default: data/automated-badge-counts.csv)",
    )
    parser.add_argument(
        "--export-3col",
        type=Path,
        help="Optional 3-column export for prepare_verified_badge_csv.py",
    )
    args = parser.parse_args(argv)

    try:
        summary = build_collection(
            parse_results_path=args.parse_results,
            source_roster_path=args.source_roster,
            output_csv_path=args.output,
            export_3col_path=args.export_3col,
        )
    except Exception as err:
        print(f"BUILD_COLLECTION_ERROR: {err}", file=sys.stderr)
        return 1

    print("Automated badge collection build complete.")
    print(f"Total Participants: {summary['total_participants']}")
    print(f"Successfully Verified: {summary['successfully_verified']}")
    print(f"  - Verified Non-Zero: {summary['verified_nonzero']}")
    print(f"  - Verified Zero: {summary['verified_zero']}")
    print(f"Unavailable / Private (Flagged): {summary['unavailable_or_private']}")
    print(f"Unreachable: {summary['unreachable']}")
    print(f"Pending: {summary['pending']}")
    stats = f"{summary['min_verified_badge_count']} / {summary['max_verified_badge_count']} / {summary['avg_verified_badge_count']}"
    print(f"Badge Count Stats (Min / Max / Avg): {stats}")
    print(f"Output saved to: {summary['output_csv']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

