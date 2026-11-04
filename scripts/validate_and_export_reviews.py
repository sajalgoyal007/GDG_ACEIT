#!/usr/bin/env python3
"""Validate completed reviewer verification CSVs and export to preparation format.

Checks reviewer workspaces against participant identity mappings and validation rules:
- Profile URL validity and allowed Google hosts
- Integer count in range [0, 10000]
- Valid review status ('verified', 'pending', 'flagged', 'unreachable')
- Non-empty reviewer name and valid review timestamp
- Non-empty review note (with explicit explanation required for verified zero)
- Rejection of blank counts and silent pending rows
- Deduplication and conflict detection across all reviewer batches

Exports only verified, compliant rows to the 3-column CSV format expected by
scripts/prepare_verified_badge_csv.py:
  profile_url,verified_badge_count,review_note
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

ALLOWED_HOSTS = {
    "skills.google",
    "www.skills.google",
    "cloudskillsboost.google",
    "www.cloudskillsboost.google",
}
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.I,
)
PROFILE_PATH_RE = re.compile(r"^/public_profiles/([A-Za-z0-9_-]{1,128})/?$")
EXPORT_HEADERS = ["profile_url", "verified_badge_count", "review_note"]
ALLOWED_STATUSES = {"verified", "pending", "flagged", "unreachable"}


class ValidationError(Exception):
    """Raised when validation process fails critically."""
    pass


def normalize_profile_url(raw_url: str) -> tuple[str, str]:
    """Validate and normalize Google Skills Boost profile URL.
    
    Returns (canonical_url, profile_id).
    """
    clean_url = (raw_url or "").strip()
    if not clean_url:
        raise ValueError("empty_profile_url")

    try:
        parsed = urlsplit(clean_url)
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
            raise ValueError("invalid_host_or_format")

        match = PROFILE_PATH_RE.fullmatch(parsed.path)
        if not match:
            raise ValueError("invalid_profile_path")

        raw_id = match.group(1)
        profile_id = raw_id.lower() if UUID_RE.fullmatch(raw_id) else raw_id
        canonical = f"https://www.skills.google/public_profiles/{profile_id}"
        return canonical, profile_id
    except Exception as err:
        raise ValueError("invalid_profile_url") from err


def is_valid_timestamp(ts: str) -> bool:
    """Validate ISO timestamp or date (e.g. 2026-11-04 or 2026-11-04T12:00:00Z)."""
    clean = ts.strip()
    if not clean:
        return False
    # ISO-8601 date or date-time pattern
    iso_pattern = re.compile(
        r"^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$"
    )
    return bool(iso_pattern.fullmatch(clean))


def read_csv_safely(path: Path) -> list[dict[str, str]]:
    """Read CSV with UTF-8 BOM support and normalized lowercase keys."""
    raw = path.read_bytes()
    if len(raw) == 0:
        return []
    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if not reader.fieldnames:
        return []
    clean_fieldnames = [h.strip().lower() for h in reader.fieldnames if h]
    reader.fieldnames = clean_fieldnames
    return list(reader)


def load_source_roster_mapping(roster_path: Path) -> dict[str, dict[str, str]]:
    """Load canonical source roster mapping by normalized profile_id."""
    if not roster_path.is_file():
        raise ValidationError(f"Source roster not found: {roster_path}")

    rows = read_csv_safely(roster_path)
    mapping: dict[str, dict[str, str]] = {}

    for row in rows:
        url = row.get("profile_url") or ""
        uuid = row.get("participant_uuid") or row.get("participant_id") or ""
        name = row.get("participant_name") or ""
        if url:
            try:
                canonical, pid = normalize_profile_url(url)
                mapping[pid] = {
                    "participant_uuid": uuid.strip(),
                    "participant_name": name.strip(),
                    "canonical_url": canonical,
                }
            except ValueError:
                continue

    return mapping


def validate_review_record(
    row: dict[str, str],
    file_name: str,
    row_num: int,
    canonical_roster: dict[str, dict[str, str]] | None,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """Validate an individual reviewer row.
    
    Returns (validated_entry_or_None, issues_list).
    """
    issues: list[dict[str, Any]] = []

    raw_url = (row.get("profile_url") or "").strip()
    status = (row.get("review_status") or "").strip().lower()
    count_str = (row.get("verified_badge_count") or "").strip()
    reviewer = (row.get("reviewer") or "").strip()
    timestamp = (row.get("reviewed_at") or "").strip()
    note = (row.get("review_note") or "").strip()
    participant_name = (row.get("participant_name") or "").strip()

    # 1. URL validation
    try:
        canonical_url, profile_id = normalize_profile_url(raw_url)
    except ValueError:
        issues.append({
            "file": file_name,
            "row_number": row_num,
            "code": "invalid_profile_url",
            "message": f"Malformed or unsupported profile URL: {raw_url}",
        })
        return None, issues

    # 2. Roster identity validation (if canonical roster provided)
    if canonical_roster is not None:
        if profile_id not in canonical_roster:
            issues.append({
                "file": file_name,
                "row_number": row_num,
                "code": "unknown_participant",
                "message": f"Profile URL not found in registered participant roster: {canonical_url}",
            })
            return None, issues

    # 3. Status validation
    if not status or status not in ALLOWED_STATUSES:
        issues.append({
            "file": file_name,
            "row_number": row_num,
            "code": "invalid_review_status",
            "message": f"Status '{status}' is invalid. Must be one of {ALLOWED_STATUSES}",
        })
        return None, issues

    # 4. Pending / Flagged Handling
    if status == "pending":
        issues.append({
            "file": file_name,
            "row_number": row_num,
            "code": "pending_review",
            "message": "Row remains pending review; not eligible for export.",
        })
        return None, issues

    if status in ("flagged", "unreachable"):
        issues.append({
            "file": file_name,
            "row_number": row_num,
            "code": f"status_{status}",
            "message": f"Participant review status is '{status}': {note or 'No explanation'}",
        })
        return None, issues

    # 5. Verified Status Checks
    if status == "verified":
        # Badge Count
        if not count_str:
            issues.append({
                "file": file_name,
                "row_number": row_num,
                "code": "blank_count",
                "message": "Verified status cannot have a blank badge count. Enter '0' if zero.",
            })
            return None, issues

        if not re.fullmatch(r"0|[1-9][0-9]*", count_str):
            issues.append({
                "file": file_name,
                "row_number": row_num,
                "code": "invalid_badge_count",
                "message": f"Verified badge count must be a non-negative integer: '{count_str}'",
            })
            return None, issues

        count = int(count_str)
        if count < 0 or count > 10000:
            issues.append({
                "file": file_name,
                "row_number": row_num,
                "code": "count_out_of_range",
                "message": f"Badge count {count} is outside allowed range [0, 10000]",
            })
            return None, issues

        # Reviewer Identity
        if len(reviewer) < 2 or any(ord(c) < 32 for c in reviewer):
            issues.append({
                "file": file_name,
                "row_number": row_num,
                "code": "missing_reviewer",
                "message": "Reviewer identity must be a valid non-empty name.",
            })
            return None, issues

        # Verification Timestamp
        if not is_valid_timestamp(timestamp):
            issues.append({
                "file": file_name,
                "row_number": row_num,
                "code": "missing_timestamp",
                "message": f"Missing or invalid review timestamp: '{timestamp}'",
            })
            return None, issues

        # Review Note
        if len(note) < 1 or len(note) > 1000 or any(ord(c) < 32 and c not in "\t\n\r" for c in note):
            issues.append({
                "file": file_name,
                "row_number": row_num,
                "code": "invalid_review_note",
                "message": "Review note must contain 1 to 1000 printable characters.",
            })
            return None, issues

        # Explicit verified zero rule
        if count == 0 and len(note) < 5:
            issues.append({
                "file": file_name,
                "row_number": row_num,
                "code": "verified_zero_requires_explanation",
                "message": "Verified zero count must include an explicit review note (min 5 chars).",
            })
            return None, issues

        return {
            "file": file_name,
            "row_number": row_num,
            "profile_id": profile_id,
            "canonical_url": canonical_url,
            "verified_badge_count": count,
            "review_status": status,
            "reviewer": reviewer,
            "reviewed_at": timestamp,
            "review_note": note,
            "participant_name": participant_name,
        }, issues

    return None, issues


def process_review_files(
    file_paths: list[Path],
    canonical_roster_path: Path | None = None,
) -> tuple[list[dict[str, str]], dict[str, Any], list[dict[str, Any]]]:
    """Validate multiple review CSV files, detect conflicts, and produce export rows."""
    canonical_roster = load_source_roster_mapping(canonical_roster_path) if canonical_roster_path else None

    all_verified: list[dict[str, Any]] = []
    all_issues: list[dict[str, Any]] = []
    total_inspected = 0
    status_counts: dict[str, int] = defaultdict(int)

    for path in file_paths:
        if not path.is_file():
            all_issues.append({"file": path.name, "row_number": 0, "code": "file_not_found", "message": f"File does not exist: {path}"})
            continue

        rows = read_csv_safely(path)
        for offset, row in enumerate(rows, start=2):
            total_inspected += 1
            st = (row.get("review_status") or "pending").strip().lower()
            status_counts[st] += 1

            record, issues = validate_review_record(row, path.name, offset, canonical_roster)
            if issues:
                all_issues.extend(issues)
            if record:
                all_verified.append(record)

    # Cross-file deduplication and conflict detection
    profile_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for rec in all_verified:
        profile_groups[rec["profile_id"]].append(rec)

    excluded_records: set[tuple[str, int]] = set()
    for pid, group in profile_groups.items():
        if len(group) > 1:
            counts = {g["verified_badge_count"] for g in group}
            code = "conflicting_counts" if len(counts) > 1 else "duplicate_assignment"
            for g in group:
                excluded_records.add((g["file"], g["row_number"]))
                all_issues.append({
                    "file": g["file"],
                    "row_number": g["row_number"],
                    "code": code,
                    "message": f"Profile appears multiple times across reviewer batches ({code}). All occurrences excluded.",
                })

    # Prepare export rows
    export_rows: list[dict[str, str]] = []
    for rec in all_verified:
        key = (rec["file"], rec["row_number"])
        if key in excluded_records:
            continue
        export_rows.append({
            "profile_url": rec["canonical_url"],
            "verified_badge_count": str(rec["verified_badge_count"]),
            "review_note": rec["review_note"],
        })

    verified_counts = [int(r["verified_badge_count"]) for r in export_rows]
    verified_zero = sum(1 for c in verified_counts if c == 0)
    verified_nonzero = sum(1 for c in verified_counts if c > 0)
    flagged_count = status_counts.get("flagged", 0)
    unreachable_count = status_counts.get("unreachable", 0)
    pending_count = status_counts.get("pending", 0)

    distribution_summary: dict[str, Any] = {
        "total_participants": total_inspected,
        "successfully_verified": len(export_rows),
        "verified_zero": verified_zero,
        "verified_nonzero": verified_nonzero,
        "unavailable_or_private": flagged_count,
        "unreachable": unreachable_count,
        "pending": pending_count,
        "min_verified_badge_count": min(verified_counts) if verified_counts else None,
        "max_verified_badge_count": max(verified_counts) if verified_counts else None,
        "avg_verified_badge_count": round(sum(verified_counts) / len(verified_counts), 2) if verified_counts else None,
    }

    summary: dict[str, Any] = {
        "files_inspected": [p.name for p in file_paths],
        "total_rows_inspected": total_inspected,
        "status_distribution": dict(status_counts),
        "verified_eligible_rows": len(export_rows),
        "distribution_summary": distribution_summary,
        "total_issues": len(all_issues),
        "issues_by_code": dict(
            defaultdict(int, {
                code: sum(1 for iss in all_issues if iss.get("code") == code)
                for code in {iss.get("code") for iss in all_issues if iss.get("code")}
            })
        ),
    }

    return export_rows, summary, all_issues


def write_export_atomic(path: Path, rows: list[dict[str, str]]) -> None:
    """Write exact 3-column export CSV atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_file: str | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8-sig", newline="", dir=path.parent, delete=False) as temp:
            temp_file = temp.name
            writer = csv.DictWriter(temp, fieldnames=EXPORT_HEADERS, lineterminator="\r\n")
            writer.writeheader()
            writer.writerows(rows)
        Path(temp_file).replace(path)
    finally:
        if temp_file and Path(temp_file).exists():
            Path(temp_file).unlink()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate completed reviewer CSVs and export 3-column format for preparation script."
    )
    parser.add_argument(
        "--inputs",
        nargs="+",
        type=Path,
        required=True,
        help="One or more completed reviewer CSV files",
    )
    parser.add_argument(
        "--source-roster",
        type=Path,
        default=Path("data/verified-badge-counts-source.csv"),
        help="Path to canonical source roster CSV (default: data/verified-badge-counts-source.csv)",
    )
    parser.add_argument(
        "--export",
        type=Path,
        help="Output path for the 3-column preparation source CSV (profile_url,verified_badge_count,review_note)",
    )
    parser.add_argument(
        "--summary",
        type=Path,
        help="Output path for validation summary JSON report",
    )
    parser.add_argument(
        "--require-all-verified",
        action="store_true",
        help="Exit with error if any rows remain pending or flagged",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    try:
        export_rows, summary, issues = process_review_files(
            file_paths=args.inputs,
            canonical_roster_path=args.source_roster if args.source_roster.exists() else None,
        )
    except Exception as err:
        print(f"VALIDATION_PROCESS_ERROR: {err}", file=sys.stderr)
        return 2

    if args.export:
        write_export_atomic(args.export, export_rows)
        print(f"Exported {len(export_rows)} verified rows to: {args.export}")

    if args.summary:
        args.summary.parent.mkdir(parents=True, exist_ok=True)
        summary_temp = args.summary.with_name(args.summary.name + ".tmp")
        summary_temp.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        summary_temp.replace(args.summary)
        print(f"Validation summary saved to: {args.summary}")

    print("\n--- Review Validation Results ---")
    print(f"Total Rows Inspected: {summary['total_rows_inspected']}")
    print(f"Status Counts: {summary['status_distribution']}")
    print(f"Eligible Verified Rows for Export: {summary['verified_eligible_rows']}")
    if summary["issues_by_code"]:
        print(f"Issues Encountered: {summary['issues_by_code']}")

    print("\n--- Participant Verification Distribution Summary ---")
    dist = summary.get("distribution_summary", {})
    print(f"Total Participants: {dist.get('total_participants')}")
    print(f"Successfully Verified: {dist.get('successfully_verified')}")
    print(f"  - Verified Zero: {dist.get('verified_zero')}")
    print(f"  - Verified Non-Zero: {dist.get('verified_nonzero')}")
    print(f"Unavailable / Private (Flagged): {dist.get('unavailable_or_private')}")
    print(f"Unreachable: {dist.get('unreachable')}")
    print(f"Pending: {dist.get('pending')}")
    stats_str = (
        f"{dist.get('min_verified_badge_count')} / {dist.get('max_verified_badge_count')} / {dist.get('avg_verified_badge_count')}"
        if dist.get("min_verified_badge_count") is not None
        else "N/A (No verified records yet)"
    )
    print(f"Badge Count Stats (Min / Max / Avg): {stats_str}")

    has_pending = summary["status_distribution"].get("pending", 0) > 0
    if args.require_all_verified and (has_pending or summary["verified_eligible_rows"] < summary["total_rows_inspected"]):
        print("\nVALIDATION FAILED: Not all participants have verified status.", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())

