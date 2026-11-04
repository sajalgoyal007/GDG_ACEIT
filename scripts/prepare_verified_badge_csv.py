#!/usr/bin/env python3
"""Prepare an admin-reviewed verified badge-count CSV offline; never fetches data."""

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
from urllib.parse import urlsplit

MAX_BYTES = 1_000_000
MAX_ROWS = 500
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
PROFILE_RE = re.compile(r"^/public_profiles/([A-Za-z0-9_-]{1,128})/?$")
ALLOWED_HOSTS = {"skills.google", "www.skills.google", "cloudskillsboost.google", "www.cloudskillsboost.google"}
IMPORT_HEADERS = ["participant_id", "verified_badge_count", "review_note"]


class InputError(ValueError):
    pass


def normalized_profile_id(value: str) -> str:
    try:
        parsed = urlsplit(value.strip())
        if (parsed.scheme.lower() != "https" or parsed.hostname is None
                or parsed.hostname.lower() not in ALLOWED_HOSTS
                or parsed.username is not None or parsed.password is not None
                or parsed.port is not None or parsed.query or parsed.fragment):
            raise ValueError
        match = PROFILE_RE.fullmatch(parsed.path)
        if not match:
            raise ValueError
        profile_id = match.group(1)
        return profile_id.lower() if UUID_RE.fullmatch(profile_id) else profile_id
    except (ValueError, TypeError):
        raise InputError("invalid_profile_url") from None


def read_csv(path: Path) -> list[dict[str, str]]:
    try:
        raw = path.read_bytes()
    except OSError:
        raise InputError("input_unreadable") from None
    if len(raw) > MAX_BYTES:
        raise InputError("file_too_large")
    try:
        text = raw.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text, newline=""))
        if reader.fieldnames is None:
            raise InputError("missing_header")
        headers = [header.strip().lower() for header in reader.fieldnames]
        if len(headers) != len(set(headers)):
            raise InputError("duplicate_header")
        reader.fieldnames = headers
        return list(reader)
    except (UnicodeDecodeError, csv.Error):
        raise InputError("invalid_csv") from None


def _required_headers(path: Path, expected: set[str]) -> list[dict[str, str]]:
    rows = read_csv(path)
    # read_csv uses DictReader keys; the header must match the documented format exactly.
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        headers = next(csv.reader(source), [])
    normalized = {value.strip().lower() for value in headers}
    if normalized != expected or len(headers) != len(expected):
        raise InputError("unexpected_headers")
    return rows


def prepare(roster_path: Path, source_path: Path) -> tuple[list[dict[str, str]], dict[str, object], list[dict[str, str]]]:
    roster_rows = _required_headers(roster_path, {"participant_id", "profile_url"})
    source_rows = _required_headers(source_path, {"profile_url", "verified_badge_count", "review_note"})
    if len(source_rows) > MAX_ROWS:
        raise InputError("row_limit_exceeded")

    roster: dict[str, list[str]] = defaultdict(list)
    roster_invalid = 0
    participant_id_rows: dict[str, list[str]] = defaultdict(list)
    for row in roster_rows:
        participant_id = (row.get("participant_id") or "").strip().lower()
        profile_url = (row.get("profile_url") or "").strip()
        if not UUID_RE.fullmatch(participant_id) or not profile_url:
            roster_invalid += 1
            continue
        try:
            profile_id = normalized_profile_id(profile_url)
        except InputError:
            roster_invalid += 1
            continue
        participant_id_rows[participant_id].append(profile_id)
    duplicate_roster_ids = {participant_id for participant_id, entries in participant_id_rows.items() if len(entries) > 1}
    roster_invalid += sum(len(participant_id_rows[participant_id]) for participant_id in duplicate_roster_ids)
    for participant_id, entries in participant_id_rows.items():
        if participant_id not in duplicate_roster_ids:
            roster[entries[0]].append(participant_id)

    parsed: list[dict[str, object]] = []
    issues: list[dict[str, object]] = []
    for row_number, row in enumerate(source_rows, start=2):
        url = (row.get("profile_url") or "").strip()
        count_text = (row.get("verified_badge_count") or "").strip()
        note = (row.get("review_note") or "").strip()
        try:
            profile_id = normalized_profile_id(url)
        except InputError:
            issues.append({"row_number": row_number, "code": "invalid_profile_url"})
            continue
        if not re.fullmatch(r"0|[1-9][0-9]*", count_text) or int(count_text) > 10000:
            issues.append({"row_number": row_number, "code": "invalid_badge_count"})
            continue
        if not 1 <= len(note) <= 1000 or any(ord(char) < 32 and char not in "\t\n\r" for char in note) or "\x7f" in note:
            issues.append({"row_number": row_number, "code": "invalid_review_note"})
            continue
        parsed.append({"row_number": row_number, "profile_id": profile_id, "badge_count": int(count_text), "review_note": note})

    input_groups: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in parsed:
        input_groups[str(row["profile_id"])].append(row)
    excluded: set[int] = set()
    for profile_id, duplicates in input_groups.items():
        if len(duplicates) > 1:
            code = "conflicting_counts" if len({item["badge_count"] for item in duplicates}) > 1 else "duplicate_profile"
            excluded.update(int(item["row_number"]) for item in duplicates)
            issues.extend({"row_number": int(item["row_number"]), "code": code} for item in duplicates)

    clean: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    for row in parsed:
        row_number = int(row["row_number"])
        if row_number in excluded:
            continue
        profile_id = str(row["profile_id"])
        matches = roster.get(profile_id, [])
        if len(matches) == 0:
            issues.append({"row_number": row_number, "code": "unknown_profile"})
            continue
        if len(matches) != 1:
            issues.append({"row_number": row_number, "code": "ambiguous_roster_profile"})
            continue
        clean.append({"participant_id": matches[0], "verified_badge_count": str(row["badge_count"]), "review_note": str(row["review_note"])})

    issue_by_row: dict[int, str] = {}
    for issue in issues:
        issue_by_row[int(issue["row_number"])] = str(issue["code"])
    for row_number, code in sorted(issue_by_row.items()):
        skipped.append({"row_number": str(row_number), "reason_code": code})

    summary: dict[str, object] = {
        "input_rows": len(source_rows),
        "clean_rows": len(clean),
        "skipped_rows": len(skipped),
        "roster_rows_invalid": roster_invalid,
        "issues_by_code": {code: sum(1 for issue in skipped if issue["reason_code"] == code)
                            for code in sorted({item["reason_code"] for item in skipped})},
        "issues": skipped,
        "output_columns": IMPORT_HEADERS,
        "verified_data_warning": "Output contains only admin-reviewed inputs. It remains subject to the website's authenticated preview and explicit audited verification confirmation.",
    }
    return clean, summary, skipped


def write_csv_atomic(path: Path, headers: list[str], rows: list[dict[str, str]]) -> None:
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--roster", required=True, type=Path, help="Admin roster CSV with participant_id,profile_url")
    parser.add_argument("--source", required=True, type=Path, help="Reviewed CSV with profile_url,verified_badge_count,review_note")
    parser.add_argument("--output", required=True, type=Path, help="Clean CSV for the admin bulk verification preview")
    parser.add_argument("--report", required=True, type=Path, help="Sanitized JSON report path")
    parser.add_argument("--skipped", type=Path, help="Optional sanitized skipped-row CSV path")
    args = parser.parse_args()
    try:
        clean, report, skipped = prepare(args.roster, args.source)
        write_csv_atomic(args.output, IMPORT_HEADERS, clean)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        report_temp = args.report.with_name(args.report.name + ".tmp")
        report_temp.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        report_temp.replace(args.report)
        if args.skipped:
            write_csv_atomic(args.skipped, ["row_number", "reason_code"], skipped)
    except InputError as error:
        print(f"PREPARATION_FAILED: {error}", file=sys.stderr)
        return 2
    except OSError:
        print("PREPARATION_FAILED: output could not be written", file=sys.stderr)
        return 2
    print(f"Prepared {report['clean_rows']} clean rows; {report['skipped_rows']} rows excluded. See sanitized report.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
