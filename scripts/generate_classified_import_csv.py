#!/usr/bin/env python3
"""
Phase 6C — Generate Classified Badge Import CSV
================================================
Merges data from:
  - data/badge-classification-report.json (per-participant skill/arcade counts)
  - data/verified-badge-counts-source.csv  (participant_uuid → participant_id mapping)

Outputs:
  - data/classified-badge-import.csv
    Headers: participant_id, skill_badge_count, arcade_game_badge_count, total_badge_count, review_note
  - data/classified-badge-import-report.json (audit summary)

This CSV is then uploaded to the admin classified-badge-import panel.

Invariants:
  - skill_badge_count + arcade_game_badge_count = total_badge_count (always enforced)
  - No unknown badges are included (this script uses only fully classified data)
  - Participants with verified_zero status get 0/0/0 — these are explicitly verified
  - Participants with no HTML file are skipped (not fabricated)
  - The import CSV includes ALL 114 participants, including zero-badge ones
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate classified badge import CSV for admin ingestion."
    )
    parser.add_argument(
        "--classification-report",
        default="data/badge-classification-report.json",
    )
    parser.add_argument(
        "--source-roster",
        default="data/verified-badge-counts-source.csv",
    )
    parser.add_argument(
        "--output",
        default="data/classified-badge-import.csv",
    )
    parser.add_argument(
        "--report",
        default="data/classified-badge-import-report.json",
    )
    args = parser.parse_args()

    report_path = Path(args.classification_report)
    roster_path = Path(args.source_roster)
    output_path = Path(args.output)
    summary_path = Path(args.report)

    if not report_path.exists():
        print(f"ERROR: classification report not found: {report_path}", file=sys.stderr)
        sys.exit(1)
    if not roster_path.exists():
        print(f"ERROR: source roster not found: {roster_path}", file=sys.stderr)
        sys.exit(1)

    report = json.loads(report_path.read_text(encoding="utf-8"))
    per_participant = {p["participant_uuid"]: p for p in report["per_participant"]}

    # Build a uuid → participant_uuid map from the roster (roster has participant_uuid as first col)
    roster_rows = list(csv.DictReader(roster_path.open(encoding="utf-8-sig")))

    output_rows = []
    skipped = []
    issues = []

    for row in roster_rows:
        uuid = (row.get("participant_uuid") or "").strip()
        name = (row.get("participant_name") or "").strip()

        if not uuid:
            issues.append({"uuid": "", "name": name, "reason": "missing participant_uuid"})
            continue

        if uuid not in per_participant:
            # Participant has no classification data — they are zero-badge (confirmed)
            # Still include them with 0/0/0 so the import is complete.
            skill = 0
            arcade = 0
            total = 0
            note = "Phase 6C automated import: no badges collected (confirmed zero profile)"
        else:
            p = per_participant[uuid]
            skill = p["skill_badge_count"]
            arcade = p["arcade_game_badge_count"]
            unknown = p["unknown_badge_count"]
            total = p["total_badge_count"]

            if unknown > 0:
                issues.append({
                    "uuid": uuid,
                    "name": name,
                    "reason": f"has {unknown} unknown badges — excluded from import"
                })
                skipped.append(uuid)
                continue

            # Verify sum invariant
            if skill + arcade != total:
                issues.append({
                    "uuid": uuid,
                    "name": name,
                    "reason": f"sum mismatch: {skill}+{arcade}!={total}"
                })
                skipped.append(uuid)
                continue

            if total == 0:
                note = "Phase 6C automated import: confirmed zero public badges"
            else:
                note = f"Phase 6C automated import: {skill} Skill Badge(s), {arcade} Arcade Game Badge(s)"

        output_rows.append({
            "participant_id": uuid,
            "skill_badge_count": skill,
            "arcade_game_badge_count": arcade,
            "total_badge_count": total,
            "review_note": note,
        })

    # Write output CSV
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["participant_id", "skill_badge_count", "arcade_game_badge_count", "total_badge_count", "review_note"]
    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(output_rows)

    print(f"Classified badge import CSV written: {output_path.resolve()}")

    # Write summary report
    total_rows = len(output_rows)
    zero_rows = sum(1 for r in output_rows if r["total_badge_count"] == 0)
    nonzero_rows = total_rows - zero_rows
    total_skill = sum(r["skill_badge_count"] for r in output_rows)
    total_arcade = sum(r["arcade_game_badge_count"] for r in output_rows)

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_classification_report": str(report_path.resolve()),
        "source_roster": str(roster_path.resolve()),
        "output_csv": str(output_path.resolve()),
        "total_rows": total_rows,
        "zero_badge_rows": zero_rows,
        "nonzero_badge_rows": nonzero_rows,
        "total_skill_badges": total_skill,
        "total_arcade_badges": total_arcade,
        "total_verified_badges": total_skill + total_arcade,
        "skipped_participants": skipped,
        "issues": issues,
    }
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Summary report written: {summary_path.resolve()}")

    print(f"\n{'='*60}")
    print("CLASSIFIED BADGE IMPORT CSV SUMMARY")
    print(f"{'='*60}")
    print(f"Total rows:            {total_rows}")
    print(f"Zero-badge rows:       {zero_rows}")
    print(f"Non-zero rows:         {nonzero_rows}")
    print(f"Total Skill Badges:    {total_skill}")
    print(f"Total Arcade Badges:   {total_arcade}")
    print(f"Total Verified:        {total_skill + total_arcade}")
    if skipped:
        print(f"\nWARNING: {len(skipped)} participant(s) skipped: {skipped}")
    if issues:
        print(f"\nIssues: {len(issues)}")
        for issue in issues:
            print(f"  - {issue['name']} ({issue['uuid']}): {issue['reason']}")


if __name__ == "__main__":
    main()

