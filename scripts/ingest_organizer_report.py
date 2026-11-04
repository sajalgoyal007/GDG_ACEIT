#!/usr/bin/env python3
"""Ingest and normalize Google Skills Boost organizer progress report CSVs.

Flexible column detection extracts public profile URLs, participant names, and
verified badge counts (either single total or separate skill/game counts).
Strictly validates URLs, rejects malformed counts, deduplicates profiles, and
emits an audited source CSV compatible with prepare_verified_badge_csv.py.

If the input report lacks badge count columns or data, the script fails safely
and explicitly without fabricating or estimating counts.
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

MAX_BYTES = 10_000_000
MAX_ROWS = 5000
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
PROFILE_PATH_RE = re.compile(r"^/public_profiles/([A-Za-z0-9_-]{1,128})/?$")
ALLOWED_HOSTS = {
    "skills.google",
    "www.skills.google",
    "cloudskillsboost.google",
    "www.cloudskillsboost.google",
}
OUTPUT_HEADERS = ["profile_url", "verified_badge_count", "review_note"]

# Flexible column detection matchers (normalized lowercase without punctuation)
URL_PATTERNS = [
    r"^public[_\s-]*profile[_\s-]*url$",
    r"^profile[_\s-]*url$",
    r"^google[_\s-]*skills[_\s-]*profile[_\s-]*url$",
    r"^skills[_\s-]*boost[_\s-]*profile[_\s-]*url$",
    r"^skills[_\s-]*profile[_\s-]*url$",
    r"^public[_\s-]*profile$",
    r"^profile[_\s-]*link$",
    r"^link[_\s-]*profile$",
    r"^link[_\s-]*profil$",
    r"^profil[_\s-]*link$",
    r"^profile$",
    r"^profil$",
    r"^url$",
    r"^link$",
]

NAME_PATTERNS = [
    r"^student[_\s-]*name$",
    r"^learner[_\s-]*name$",
    r"^participant[_\s-]*name$",
    r"^user[_\s-]*name$",
    r"^full[_\s-]*name$",
    r"^display[_\s-]*name$",
    r"^nama$",
    r"^name$",
    r"^learner$",
    r"^student$",
]

TOTAL_BADGE_PATTERNS = [
    r"^verified[_\s-]*badge[_\s-]*count$",
    r"^total[_\s-]*badges[_\s-]*completed$",
    r"^total[_\s-]*badge[_\s-]*count$",
    r"^total[_\s-]*badges$",
    r"^badges[_\s-]*completed$",
    r"^badges[_\s-]*earned$",
    r"^badge[_\s-]*count$",
    r"^total$",
    r"^badges$",
]

SKILL_BADGE_PATTERNS = [
    r"^skill[_\s-]*badges?[_\s-]*completed[_\s-]*count$",
    r"^skill[_\s-]*badges?[_\s-]*completed$",
    r"^skill[_\s-]*badge[_\s-]*count$",
    r"^skill[_\s-]*badges?$",
    r"^skills?[_\s-]*completed$",
    r"^keahlian$",
    r"^lencana$",
]

ARCADE_GAME_PATTERNS = [
    r"^arcade[_\s-]*games?[_\s-]*completed[_\s-]*count$",
    r"^arcade[_\s-]*games?[_\s-]*completed$",
    r"^arcade[_\s-]*game[_\s-]*count$",
    r"^arcade[_\s-]*games?$",
    r"^games?[_\s-]*completed$",
    r"^games?$",
    r"^arcade$",
]


class IngestionError(Exception):
    """Raised when ingestion fails due to structural or validation errors."""
    pass


def normalize_header(header: str) -> str:
    """Strip punctuation and whitespace for pattern matching."""
    return header.strip().lower()


def find_column(headers: list[str], patterns: list[str]) -> str | None:
    """Find the first matching header for a given list of regex patterns."""
    for pattern in patterns:
        regex = re.compile(pattern, re.I)
        for h in headers:
            clean = h.strip().lower()
            if regex.match(clean):
                return h
    return None


def normalized_profile_id(value: str) -> tuple[str, str]:
    """Validate and normalize profile URL. Returns (canonical_url, profile_id)."""
    try:
        parsed = urlsplit(value.strip())
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
            raise ValueError
        match = PROFILE_PATH_RE.fullmatch(parsed.path)
        if not match:
            raise ValueError
        raw_id = match.group(1)
        profile_id = raw_id.lower() if UUID_RE.fullmatch(raw_id) else raw_id
        canonical_url = f"https://www.skills.google/public_profiles/{profile_id}"
        return canonical_url, profile_id
    except (ValueError, TypeError):
        raise IngestionError("invalid_profile_url") from None


def read_report_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    """Read CSV, stripping UTF-8 BOM and skipping comment lines."""
    try:
        raw = path.read_bytes()
    except OSError as err:
        raise IngestionError(f"File unreadable: {err}") from None

    if len(raw) > MAX_BYTES:
        raise IngestionError("File size exceeds 10 MB limit")

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise IngestionError("File must be valid UTF-8 encoding") from None

    # Filter out empty lines or comment lines starting with '#'
    lines = [line for line in text.splitlines() if line.strip() and not line.strip().startswith("#")]
    if not lines:
        raise IngestionError("CSV file is empty")

    reader = csv.DictReader(io.StringIO("\n".join(lines), newline=""))
    if not reader.fieldnames:
        raise IngestionError("CSV missing header row")

    headers = [h.strip() for h in reader.fieldnames if h]
    if len(headers) != len(set(headers)):
        raise IngestionError("CSV contains duplicate column headers")

    rows = list(reader)
    if len(rows) > MAX_ROWS:
        raise IngestionError(f"CSV row count ({len(rows)}) exceeds limit of {MAX_ROWS}")

    return headers, rows


def parse_count_value(val: str | None) -> int | None:
    """Parse integer count; returns None if blank or invalid."""
    if val is None:
        return None
    val_clean = val.strip()
    if not val_clean:
        return None
    if not re.fullmatch(r"0|[1-9][0-9]*", val_clean):
        return None
    count = int(val_clean)
    if count < 0 or count > 10000:
        return None
    return count


def ingest(
    report_path: Path,
    mapping_path: Path | None = None,
) -> tuple[list[dict[str, str]], dict[str, Any], list[dict[str, Any]]]:
    """Ingest organizer report and return (clean_rows, summary_dict, issues_list)."""
    headers, rows = read_report_csv(report_path)

    # Detect key columns
    url_col = find_column(headers, URL_PATTERNS)
    name_col = find_column(headers, NAME_PATTERNS)
    total_col = find_column(headers, TOTAL_BADGE_PATTERNS)
    skill_col = find_column(headers, SKILL_BADGE_PATTERNS)
    game_col = find_column(headers, ARCADE_GAME_PATTERNS)

    if not url_col:
        raise IngestionError(
            f"No public profile URL column detected. Available columns: {headers}"
        )

    has_separate_counts = bool(skill_col and game_col)
    has_total_count = bool(total_col)
    has_badge_counts = has_separate_counts or has_total_count

    if not has_badge_counts:
        # User requirement: If report lacks counts, STOP and report limitation explicitly!
        detected_info = {
            "profile_url_column": url_col,
            "learner_name_column": name_col,
            "all_columns": headers,
            "total_rows": len(rows),
        }
        raise IngestionError(
            f"NO_BADGE_COUNTS_IN_REPORT: The report contains participant identifiers but no badge count columns. "
            f"Detected headers: {headers}. As per policy, badge counts cannot be estimated or fabricated."
        )

    # Load mapping if provided
    mapping_by_id: dict[str, dict[str, str]] = {}
    if mapping_path and mapping_path.exists():
        try:
            _, map_rows = read_report_csv(mapping_path)
            for m in map_rows:
                p_url = m.get("profile_url") or m.get("registered_profile_url") or ""
                p_uuid = m.get("participant_uuid") or m.get("participant_id") or ""
                p_name = m.get("participant_name") or m.get("name") or ""
                if p_url:
                    try:
                        _, pid = normalized_profile_id(p_url)
                        mapping_by_id[pid] = {
                            "participant_uuid": p_uuid.strip(),
                            "participant_name": p_name.strip(),
                            "profile_url": p_url.strip(),
                        }
                    except IngestionError:
                        continue
        except Exception:
            pass

    parsed_rows: list[dict[str, Any]] = []
    issues: list[dict[str, Any]] = []

    for row_num, row in enumerate(rows, start=2):
        raw_url = (row.get(url_col) or "").strip()
        learner_name = (row.get(name_col) or "").strip() if name_col else ""

        # Validate URL
        if not raw_url:
            issues.append({"row_number": row_num, "code": "missing_profile_url", "name": learner_name})
            continue

        try:
            canonical_url, profile_id = normalized_profile_id(raw_url)
        except IngestionError:
            issues.append({"row_number": row_num, "code": "invalid_profile_url", "name": learner_name, "raw_url": raw_url})
            continue

        # Extract count
        badge_count: int | None = None
        review_note = ""

        if has_separate_counts and skill_col and game_col:
            raw_skill = row.get(skill_col, "")
            raw_game = row.get(game_col, "")
            skill_cnt = parse_count_value(raw_skill)
            game_cnt = parse_count_value(raw_game)

            if skill_cnt is None and game_cnt is None and not (raw_skill or raw_game).strip():
                issues.append({"row_number": row_num, "code": "missing_badge_count", "profile_id": profile_id})
                continue

            if skill_cnt is None or game_cnt is None:
                issues.append({"row_number": row_num, "code": "invalid_badge_count", "profile_id": profile_id})
                continue

            badge_count = skill_cnt + game_cnt
            name_label = f" for {learner_name}" if learner_name else ""
            review_note = f"Ingested from organizer report{name_label}: {skill_cnt} skill badges, {game_cnt} arcade games"

        elif has_total_count and total_col:
            raw_total = row.get(total_col, "")
            total_cnt = parse_count_value(raw_total)

            if total_cnt is None and not raw_total.strip():
                issues.append({"row_number": row_num, "code": "missing_badge_count", "profile_id": profile_id})
                continue

            if total_cnt is None:
                issues.append({"row_number": row_num, "code": "invalid_badge_count", "profile_id": profile_id})
                continue

            badge_count = total_cnt
            name_label = f" for {learner_name}" if learner_name else ""
            review_note = f"Ingested from organizer report{name_label}: {total_cnt} total badges"

        if badge_count is None:
            issues.append({"row_number": row_num, "code": "missing_badge_count", "profile_id": profile_id})
            continue

        parsed_rows.append({
            "row_number": row_num,
            "profile_id": profile_id,
            "canonical_url": canonical_url,
            "badge_count": badge_count,
            "review_note": review_note,
            "learner_name": learner_name,
        })

    # Group and deduplicate by profile_id
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for p in parsed_rows:
        groups[p["profile_id"]].append(p)

    excluded_rows: set[int] = set()
    for pid, entries in groups.items():
        if len(entries) > 1:
            distinct_counts = {e["badge_count"] for e in entries}
            code = "conflicting_counts" if len(distinct_counts) > 1 else "duplicate_profile"
            for e in entries:
                excluded_rows.add(e["row_number"])
                issues.append({
                    "row_number": e["row_number"],
                    "code": code,
                    "profile_id": pid,
                    "badge_count": e["badge_count"],
                })

    clean_rows: list[dict[str, str]] = []
    matched_in_roster = 0
    unmatched_in_roster = 0

    for p in parsed_rows:
        if p["row_number"] in excluded_rows:
            continue

        pid = p["profile_id"]
        if mapping_by_id:
            if pid in mapping_by_id:
                matched_in_roster += 1
            else:
                unmatched_in_roster += 1
                # Non-fatal issue: profile not in current roster
                issues.append({
                    "row_number": p["row_number"],
                    "code": "unmatched_roster_participant",
                    "profile_id": pid,
                })

        clean_rows.append({
            "profile_url": p["canonical_url"],
            "verified_badge_count": str(p["badge_count"]),
            "review_note": p["review_note"],
        })

    summary: dict[str, Any] = {
        "report_file": str(report_path.name),
        "total_input_rows": len(rows),
        "clean_output_rows": len(clean_rows),
        "excluded_issue_rows": len(issues),
        "columns_detected": {
            "profile_url_column": url_col,
            "learner_name_column": name_col,
            "total_badge_column": total_col,
            "skill_badge_column": skill_col,
            "arcade_game_column": game_col,
        },
        "count_strategy": "separate_skill_and_game_sum" if has_separate_counts else "total_badge_count",
        "roster_matching": {
            "roster_loaded": bool(mapping_by_id),
            "matched_count": matched_in_roster,
            "unmatched_count": unmatched_in_roster,
            "missing_from_report_count": max(0, len(mapping_by_id) - matched_in_roster) if mapping_by_id else 0,
        },
        "issue_breakdown": {
            code: sum(1 for iss in issues if iss["code"] == code)
            for code in sorted({iss["code"] for iss in issues})
        },
    }

    return clean_rows, summary, issues


def write_csv_atomic(path: Path, headers: list[str], rows: list[dict[str, str]]) -> None:
    """Write CSV atomically to prevent partial reads."""
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
    parser.add_argument("--report", required=True, type=Path, help="Organizer progress report CSV")
    parser.add_argument("--output", required=True, type=Path, help="Audited intermediate CSV for prepare_verified_badge_csv.py")
    parser.add_argument("--mapping", type=Path, help="Optional participant-profile mapping CSV")
    parser.add_argument("--summary", type=Path, help="Optional JSON summary report output path")
    args = parser.parse_args()

    try:
        clean_rows, summary, issues = ingest(args.report, args.mapping)
        write_csv_atomic(args.output, OUTPUT_HEADERS, clean_rows)

        if args.summary:
            args.summary.parent.mkdir(parents=True, exist_ok=True)
            args.summary.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

        print("=== ORGANIZER REPORT INGESTION COMPLETE ===")
        print(f"Report File: {summary['report_file']}")
        print(f"Input Rows: {summary['total_input_rows']}")
        print(f"Clean Rows: {summary['clean_output_rows']}")
        print(f"Count Strategy: {summary['count_strategy']}")
        if summary["roster_matching"]["roster_loaded"]:
            print(f"Roster Matched: {summary['roster_matching']['matched_count']}")
            print(f"Roster Unmatched (in report but not roster): {summary['roster_matching']['unmatched_count']}")
            print(f"Roster Missing (in roster but not report): {summary['roster_matching']['missing_from_report_count']}")
        print(f"Output File: {args.output.resolve()}")
        if issues:
            print(f"Issues Encountered: {len(issues)} (breakdown: {summary['issue_breakdown']})")
        return 0

    except IngestionError as err:
        print(f"INGESTION_FAILED: {err}", file=sys.stderr)
        return 2
    except Exception as err:
        print(f"UNEXPECTED_ERROR: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
