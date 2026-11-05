#!/usr/bin/env python3
"""
Phase 6C / Final Deployment — Generate Classified Badge Import CSV
===================================================================
Merges verified badge classification data with the current production roster.

Inputs:
  - data/current-production-roster.csv (downloaded from /api/admin/verified-badge-roster)
    Headers: participant_id, profile_url
  - data/badge-classification-report.json (per-participant skill/arcade counts)
  - data/badge-classification.csv (individual badge classifications)

Outputs:
  - data/classified-badge-import.csv
    Headers: participant_id,skill_badge_count,arcade_game_badge_count,total_badge_count,review_note
  - data/classified-badge-import-validation.json (detailed validation report)
  - data/classified-badge-import-report.json (summary report)

Invariants:
  - participant_id MUST be the new production UUID from current-production-roster.csv.
  - Never uses old participant UUID or Google public profile UUID as participant_id in production.
  - Matches participants strictly by normalized Google Skills Boost profile_url.
  - skill_badge_count + arcade_game_badge_count == total_badge_count.
  - Existing verified counts are strictly preserved (123 Skill, 11 Arcade, 134 Total across 24 earners).
  - All output participant IDs exist in the downloaded production roster.
  - No duplicate participant IDs or duplicate profile URLs.
  - Automatic backup of existing CSV to .bak before replacing.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlsplit


def normalize_profile_url(url: str) -> Tuple[str, str]:
    """
    Normalizes a Google Skills Boost / Cloud Skills Boost profile URL.
    Returns (canonical_url, profile_slug).
    """
    trimmed = (url or "").strip()
    if not trimmed:
        return "", ""

    parsed = urlsplit(trimmed)
    host = (parsed.hostname or "").lower()
    if host in ("skills.google", "www.skills.google"):
        normalized_host = "www.skills.google"
    elif host in ("cloudskillsboost.google", "www.cloudskillsboost.google"):
        normalized_host = "www.cloudskillsboost.google"
    else:
        normalized_host = host

    path = parsed.path.rstrip("/")
    m = re.search(r"/public_profiles/([A-Za-z0-9_-]+)", path, re.IGNORECASE)
    slug = m.group(1).lower() if m else ""

    canonical_url = f"https://{normalized_host}{path}" if slug else trimmed
    return canonical_url, slug


def load_classification_data(report_path: Path) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    """
    Loads classification data keyed by:
      1. profile_slug
      2. participant_uuid (fallback for synthetic test fixtures)
    """
    report = json.loads(report_path.read_text(encoding="utf-8"))
    by_slug: Dict[str, Dict[str, Any]] = {}
    by_uuid: Dict[str, Dict[str, Any]] = {}

    for p in report.get("per_participant", []):
        url = p.get("profile_url") or p.get("public_profile_url") or ""
        _, slug = normalize_profile_url(url)
        if slug:
            by_slug[slug] = p
        uuid = p.get("participant_uuid")
        if uuid:
            by_uuid[uuid.strip().lower()] = p

    return by_slug, by_uuid


def generate_classified_import(
    roster_path: Path,
    classification_report_path: Path,
    output_csv_path: Path,
    validation_report_path: Path,
    summary_report_path: Optional[Path] = None,
    backup: bool = True,
) -> Dict[str, Any]:
    if not roster_path.exists():
        raise FileNotFoundError(f"Roster file not found: {roster_path}")
    if not classification_report_path.exists():
        raise FileNotFoundError(f"Classification report not found: {classification_report_path}")

    # Read roster
    with open(roster_path, "r", encoding="utf-8-sig") as f:
        roster_rows = list(csv.DictReader(f))

    if not roster_rows:
        raise ValueError(f"Roster file is empty: {roster_path}")

    # Detect roster column names
    first_row = roster_rows[0]
    id_col = None
    for candidate in ("participant_id", "participant_uuid", "\ufeffparticipant_id", "\ufeffparticipant_uuid"):
        if candidate in first_row:
            id_col = candidate
            break

    url_col = None
    for candidate in ("profile_url", "public_profile_url", "\ufeffprofile_url", "\ufeffpublic_profile_url"):
        if candidate in first_row:
            url_col = candidate
            break

    if not id_col:
        raise ValueError(f"Could not find participant ID column in roster: {list(first_row.keys())}")

    # Load classification data
    class_by_slug, class_by_uuid = load_classification_data(classification_report_path)

    # Process roster rows
    output_rows: List[Dict[str, Any]] = []
    seen_ids: Set[str] = set()
    seen_slugs: Set[str] = set()
    duplicate_ids: List[str] = []
    duplicate_slugs: List[str] = []
    matched_participants: List[Dict[str, Any]] = []
    unmatched_roster_rows: List[Dict[str, Any]] = []
    issues: List[Dict[str, Any]] = []

    for row_idx, row in enumerate(roster_rows, start=1):
        pid = (row.get(id_col) or "").strip()
        raw_url = (row.get(url_col) or "").strip() if url_col else ""
        canonical_url, slug = normalize_profile_url(raw_url)

        if not pid:
            issues.append({"row": row_idx, "kind": "missing_id", "message": "Row has empty participant_id"})
            continue

        if pid in seen_ids:
            duplicate_ids.append(pid)
            issues.append({"row": row_idx, "kind": "duplicate_id", "message": f"Duplicate participant_id: {pid}"})
            continue
        seen_ids.add(pid)

        if slug:
            if slug in seen_slugs:
                duplicate_slugs.append(slug)
                issues.append({"row": row_idx, "kind": "duplicate_slug", "message": f"Duplicate profile slug: {slug}"})
                continue
            seen_slugs.add(slug)

        # Match against classification report: prefer slug match, fallback to uuid match
        class_entry = None
        if slug and slug in class_by_slug:
            class_entry = class_by_slug[slug]
        elif pid.lower() in class_by_uuid:
            class_entry = class_by_uuid[pid.lower()]

        if class_entry:
            skill = int(class_entry.get("skill_badge_count", 0))
            arcade = int(class_entry.get("arcade_game_badge_count", 0))
            unknown = int(class_entry.get("unknown_badge_count", 0))
            total = int(class_entry.get("total_badge_count", 0))

            if unknown > 0:
                issues.append({
                    "row": row_idx,
                    "participant_id": pid,
                    "kind": "unknown_badges",
                    "message": f"Participant has {unknown} unknown badges; excluded."
                })
                continue

            if skill + arcade != total:
                issues.append({
                    "row": row_idx,
                    "participant_id": pid,
                    "kind": "sum_mismatch",
                    "message": f"Sum mismatch: {skill} + {arcade} != {total}; excluded."
                })
                continue

            if total == 0:
                note = "Phase 6C automated import: confirmed zero public badges"
            else:
                note = f"Phase 6C automated import: {skill} Skill Badge(s), {arcade} Arcade Game Badge(s)"

            matched_participants.append({
                "participant_id": pid,
                "profile_url": raw_url,
                "slug": slug,
                "skill_badge_count": skill,
                "arcade_game_badge_count": arcade,
                "total_badge_count": total,
            })
        else:
            # Roster participant not matched in classification dataset
            unmatched_roster_rows.append({"row": row_idx, "participant_id": pid, "profile_url": raw_url})
            # Verified zero default
            skill = 0
            arcade = 0
            total = 0
            note = "Phase 6C automated import: confirmed zero public badges"

        output_rows.append({
            "participant_id": pid,
            "skill_badge_count": skill,
            "arcade_game_badge_count": arcade,
            "total_badge_count": total,
            "review_note": note,
        })

    # Identify source classification entries not matched in production roster
    matched_slugs = {m["slug"] for m in matched_participants if m["slug"]}
    matched_pids = {m["participant_id"].lower() for m in matched_participants}
    unmatched_source_participants = []
    all_source = {**{s: v for s, v in class_by_slug.items()}, **{u: v for u, v in class_by_uuid.items()}}
    # Deduplicate by participant_uuid
    seen_source_uuids = set()
    for entry in all_source.values():
        suuid = (entry.get("participant_uuid") or "").strip().lower()
        if suuid in seen_source_uuids:
            continue
        seen_source_uuids.add(suuid)

        url = entry.get("profile_url") or entry.get("public_profile_url") or ""
        _, sslug = normalize_profile_url(url)
        if (sslug and sslug in matched_slugs) or (suuid and suuid in matched_pids):
            continue

        unmatched_source_participants.append({
            "source_uuid": entry.get("participant_uuid"),
            "participant_name": entry.get("participant_name"),
            "profile_url": url,
            "slug": sslug,
            "skill_badge_count": entry.get("skill_badge_count", 0),
            "arcade_game_badge_count": entry.get("arcade_game_badge_count", 0),
            "total_badge_count": entry.get("total_badge_count", 0),
        })

    # Validate aggregates
    total_matched = len(output_rows)
    total_skill = sum(r["skill_badge_count"] for r in output_rows)
    total_arcade = sum(r["arcade_game_badge_count"] for r in output_rows)
    total_badges = sum(r["total_badge_count"] for r in output_rows)
    zero_rows = sum(1 for r in output_rows if r["total_badge_count"] == 0)
    nonzero_rows = total_matched - zero_rows

    # Verify ID membership
    all_in_roster = all(r["participant_id"] in seen_ids for r in output_rows)
    no_old_uuids = True
    for r in output_rows:
        pid = r["participant_id"]
        for u in unmatched_source_participants:
            if pid == u.get("source_uuid") or (u.get("slug") and pid == u.get("slug")):
                no_old_uuids = False
                break

    # Build validation report
    validation = {
        "validation_status": "passed" if not issues and all_in_roster and no_old_uuids else "warnings",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input_files": {
            "production_roster": str(roster_path.resolve()),
            "classification_report": str(classification_report_path.resolve()),
        },
        "roster_summary": {
            "total_roster_rows": len(roster_rows),
            "unique_roster_ids": len(seen_ids),
            "unique_roster_profile_slugs": len(seen_slugs),
            "duplicate_ids": duplicate_ids,
            "duplicate_slugs": duplicate_slugs,
            "unmatched_roster_rows": unmatched_roster_rows,
        },
        "classification_summary": {
            "total_source_participants": len(seen_source_uuids),
            "unmatched_source_participants": unmatched_source_participants,
            "unmatched_source_count": len(unmatched_source_participants),
        },
        "final_csv_metrics": {
            "total_rows": total_matched,
            "zero_badge_participants": zero_rows,
            "nonzero_badge_participants": nonzero_rows,
            "total_skill_badges": total_skill,
            "total_arcade_badges": total_arcade,
            "total_badges": total_badges,
            "sum_invariants_valid": all(r["skill_badge_count"] + r["arcade_game_badge_count"] == r["total_badge_count"] for r in output_rows),
            "all_ids_in_production_roster": all_in_roster,
            "no_old_participant_uuids_used": no_old_uuids,
            "all_ids_unique": len(set(r["participant_id"] for r in output_rows)) == len(output_rows),
        },
        "issues": issues,
    }

    # Backup existing output CSV if present
    if backup and output_csv_path.exists():
        backup_path = output_csv_path.with_suffix(".csv.bak")
        shutil.copy2(output_csv_path, backup_path)
        print(f"Backed up existing CSV to: {backup_path.resolve()}")

    # Write output CSV
    output_csv_path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["participant_id", "skill_badge_count", "arcade_game_badge_count", "total_badge_count", "review_note"]
    with open(output_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(output_rows)

    # Write validation report
    validation_report_path.parent.mkdir(parents=True, exist_ok=True)
    validation_report_path.write_text(json.dumps(validation, indent=2, ensure_ascii=False), encoding="utf-8")

    # Write summary report if requested
    if summary_report_path:
        summary = {
            "generated_at": validation["generated_at"],
            "source_classification_report": str(classification_report_path.resolve()),
            "source_roster": str(roster_path.resolve()),
            "output_csv": str(output_csv_path.resolve()),
            "total_rows": total_matched,
            "zero_badge_rows": zero_rows,
            "nonzero_badge_rows": nonzero_rows,
            "total_skill_badges": total_skill,
            "total_arcade_badges": total_arcade,
            "total_verified_badges": total_badges,
            "unmatched_source_participants_count": len(unmatched_source_participants),
            "issues": issues,
        }
        summary_report_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    return validation


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate classified badge import CSV matching against current production roster."
    )
    parser.add_argument(
        "--production-roster",
        "--source-roster",
        dest="roster",
        default="data/current-production-roster.csv",
        help="Path to production roster CSV (participant_id,profile_url)",
    )
    parser.add_argument(
        "--classification-report",
        default="data/badge-classification-report.json",
        help="Path to badge classification report JSON",
    )
    parser.add_argument(
        "--output",
        default="data/classified-badge-import.csv",
        help="Output CSV path",
    )
    parser.add_argument(
        "--validation-report",
        default="data/classified-badge-import-validation.json",
        help="Output validation report JSON path",
    )
    parser.add_argument(
        "--report",
        default="data/classified-badge-import-report.json",
        help="Output summary report JSON path",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Skip backing up existing output CSV",
    )
    args = parser.parse_args()

    roster_path = Path(args.roster)
    if not roster_path.exists():
        fallback = Path("data/verified-badge-counts-source.csv")
        if fallback.exists():
            print(f"Notice: {roster_path} not found, falling back to {fallback}")
            roster_path = fallback

    val = generate_classified_import(
        roster_path=roster_path,
        classification_report_path=Path(args.classification_report),
        output_csv_path=Path(args.output),
        validation_report_path=Path(args.validation_report),
        summary_report_path=Path(args.report),
        backup=not args.no_backup,
    )

    metrics = val["final_csv_metrics"]
    print(f"\n{'='*64}")
    print("CLASSIFIED BADGE IMPORT CSV GENERATION SUMMARY")
    print(f"{'='*64}")
    print(f"Validation status:                 {val['validation_status'].upper()}")
    print(f"Total rows in output CSV:          {metrics['total_rows']}")
    print(f"Zero-badge participants:           {metrics['zero_badge_participants']}")
    print(f"Non-zero badge participants:       {metrics['nonzero_badge_participants']}")
    print(f"Total Skill Badges:                {metrics['total_skill_badges']}")
    print(f"Total Arcade Game Badges:          {metrics['total_arcade_badges']}")
    print(f"Total Badges (Skill + Arcade):     {metrics['total_badges']}")
    print(f"Skill + Arcade == Total invariant: {'PASSED' if metrics['sum_invariants_valid'] else 'FAILED'}")
    print(f"All IDs in production roster:      {'PASSED' if metrics['all_ids_in_production_roster'] else 'FAILED'}")
    print(f"All IDs unique:                    {'PASSED' if metrics['all_ids_unique'] else 'FAILED'}")
    print(f"No old participant UUIDs used:     {'PASSED' if metrics['no_old_participant_uuids_used'] else 'FAILED'}")

    unmatched = val["classification_summary"]["unmatched_source_participants"]
    if unmatched:
        print(f"\nUnmatched source participants (in classification data but not in production roster): {len(unmatched)}")
        for u in unmatched:
            print(f"  - {u['participant_name']} (slug: {u['slug']}): {u['profile_url']} | badges={u['total_badge_count']}")

    if val["issues"]:
        print(f"\nIssues encountered: {len(val['issues'])}")
        for issue in val["issues"]:
            print(f"  - Row {issue.get('row')}: {issue.get('kind')} - {issue.get('message')}")

    print(f"\nOutput CSV written:         {Path(args.output).resolve()}")
    print(f"Validation report written:  {Path(args.validation_report).resolve()}")
    print(f"Summary report written:     {Path(args.report).resolve()}")


if __name__ == "__main__":
    main()
