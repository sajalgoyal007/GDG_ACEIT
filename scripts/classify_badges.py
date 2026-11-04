#!/usr/bin/env python3
"""
Phase 7B — Badge Classification Script
=======================================
Classifies each of the 134 collected badge awards as:
  SKILL_BADGE       — badge linked to /course_templates/<id> in its detail modal
  ARCADE_GAME_BADGE — badge linked to /games/<id> in its detail modal
  UNKNOWN           — no modal linkable or unexpected href pattern

Classification method:
  Each badge card in the HTML has a <ql-button modal='public-profile-award-modal-N'>
  which links to a <ql-dialog id='public-profile-award-modal-N'> containing a
  <ql-button href='/course_templates/...'> or <ql-button href='/games/...'>.
  This is a structural DOM signal, NOT a title keyword match.

Constraints:
  - Does NOT modify any existing verified_badge_count values.
  - Does NOT write to Supabase or the production leaderboard.
  - Does NOT guess or fabricate categories.
  - Unknown badges remain explicitly marked UNKNOWN.
  - No additional profile fetching is performed.

Outputs:
  data/badge-classification.csv
  data/badge-classification-report.json
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
CLASSIFICATION_SKILL = "SKILL_BADGE"
CLASSIFICATION_ARCADE = "ARCADE_GAME_BADGE"
CLASSIFICATION_UNKNOWN = "UNKNOWN"

BADGE_HREF_RE = re.compile(r'href="([^"]+/badges/\d+)"')
TITLE_RE = re.compile(r"class='ql-title-medium[^']*'>\s*(.*?)\s*</span>", re.DOTALL)
MODAL_ATTR_RE = re.compile(r"modal='(public-profile-award-modal-\d+)'")
DIALOG_BUTTON_HREF_RE = re.compile(
    r"href='(/(?:course_templates|games|paths|collections|catalog)/[^']+)'"
)
IMAGE_SRC_RE = re.compile(r'src="(https://cdn\.qwiklabs\.com/[^"]+)"')
EARNED_RE = re.compile(r"class='ql-body-medium[^']*'>\s*(Earned[^<]*?)\s*</span>", re.DOTALL)

# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _build_modal_href_map(html: str) -> dict[str, str | None]:
    """
    Returns a dict mapping each modal id ('public-profile-award-modal-N')
    to the href found in the ql-button inside that modal's ql-dialog.
    """
    result: dict[str, str | None] = {}
    for attrs_str, body in re.findall(r"<ql-dialog([^>]*)>(.*?)</ql-dialog>", html, re.DOTALL):
        id_match = re.search(r"id='([^']+)'", attrs_str)
        if not id_match:
            continue
        modal_id = id_match.group(1)
        href_match = DIALOG_BUTTON_HREF_RE.search(body)
        result[modal_id] = href_match.group(1) if href_match else None
    return result


def _classify_from_href(modal_href: str | None) -> str:
    if modal_href is None:
        return CLASSIFICATION_UNKNOWN
    if modal_href.startswith("/course_templates/"):
        return CLASSIFICATION_SKILL
    if modal_href.startswith("/games/"):
        return CLASSIFICATION_ARCADE
    return CLASSIFICATION_UNKNOWN


def _extract_badge_id(badge_href: str | None) -> str | None:
    if not badge_href:
        return None
    m = re.search(r"/badges/(\d+)", badge_href)
    return m.group(1) if m else None


def classify_profile_html(
    html: str,
    participant_uuid: str,
    participant_name: str,
    profile_url: str,
) -> list[dict]:
    """
    Returns a list of badge records extracted from one profile's HTML.
    Each record contains all classification fields.
    """
    modal_href_map = _build_modal_href_map(html)
    badge_starts = [m.start() for m in re.finditer(r"<div class='profile-badge'>", html)]
    records = []

    for i, start in enumerate(badge_starts):
        end = badge_starts[i + 1] if i + 1 < len(badge_starts) else start + 3000
        block = html[start : min(end, start + 3000)]

        badge_href_match = BADGE_HREF_RE.search(block)
        title_match = TITLE_RE.search(block)
        modal_match = MODAL_ATTR_RE.search(block)
        image_match = IMAGE_SRC_RE.search(block)
        earned_match = EARNED_RE.search(block)

        badge_id = _extract_badge_id(badge_href_match.group(1) if badge_href_match else None)
        modal_id = modal_match.group(1) if modal_match else None
        modal_href = modal_href_map.get(modal_id) if modal_id else None
        classification = _classify_from_href(modal_href)

        records.append({
            "participant_uuid": participant_uuid,
            "participant_name": participant_name,
            "profile_url": profile_url,
            "badge_id": badge_id or "",
            "badge_title": (title_match.group(1).strip() if title_match else "") or "",
            "classification": classification,
            "classification_signal": modal_href or "",
            "classification_method": "modal_href" if modal_href else "unresolved",
            "badge_href": badge_href_match.group(1) if badge_href_match else "",
            "image_url": image_match.group(1) if image_match else "",
            "earned_date_raw": (earned_match.group(1).strip() if earned_match else "") or "",
        })

    return records


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Classify badge awards as SKILL_BADGE, ARCADE_GAME_BADGE, or UNKNOWN."
    )
    parser.add_argument(
        "--parse-results",
        default="data/raw_profiles/parse_results.json",
        help="Path to parse_results.json produced by parse_saved_profiles.ts",
    )
    parser.add_argument(
        "--raw-profiles-dir",
        default="data/raw_profiles",
        help="Directory containing <uuid>.html files",
    )
    parser.add_argument(
        "--output",
        default="data/badge-classification.csv",
        help="Output classification CSV",
    )
    parser.add_argument(
        "--report",
        default="data/badge-classification-report.json",
        help="Output classification JSON report",
    )
    args = parser.parse_args()

    parse_results_path = Path(args.parse_results)
    raw_dir = Path(args.raw_profiles_dir)
    output_path = Path(args.output)
    report_path = Path(args.report)

    if not parse_results_path.exists():
        print(f"ERROR: parse results not found: {parse_results_path}", file=sys.stderr)
        sys.exit(1)
    if not raw_dir.exists():
        print(f"ERROR: raw profiles directory not found: {raw_dir}", file=sys.stderr)
        sys.exit(1)

    parse_data = json.loads(parse_results_path.read_text(encoding="utf-8"))
    parse_results = parse_data["results"]

    all_records: list[dict] = []
    missing_html: list[str] = []
    per_participant: dict[str, dict] = {}

    for uuid, result in parse_results.items():
        name = result["participantName"]
        profile_url = result["profileUrl"]
        badge_count = result["badgeCount"]
        parse_status = result["parseStatus"]

        per_participant[uuid] = {
            "participant_uuid": uuid,
            "participant_name": name,
            "profile_url": profile_url,
            "total_badge_count": badge_count,
            "parse_status": parse_status,
            "skill_badge_count": 0,
            "arcade_game_badge_count": 0,
            "unknown_badge_count": 0,
        }

        if badge_count == 0:
            # Confirmed zero — no badges to classify
            continue

        html_path = raw_dir / f"{uuid}.html"
        if not html_path.exists():
            missing_html.append(uuid)
            continue

        html = html_path.read_text(encoding="utf-8")
        records = classify_profile_html(html, uuid, name, profile_url)
        all_records.extend(records)

        for rec in records:
            if rec["classification"] == CLASSIFICATION_SKILL:
                per_participant[uuid]["skill_badge_count"] += 1
            elif rec["classification"] == CLASSIFICATION_ARCADE:
                per_participant[uuid]["arcade_game_badge_count"] += 1
            else:
                per_participant[uuid]["unknown_badge_count"] += 1

    # -----------------------------------------------------------------------
    # Write badge-classification.csv
    # -----------------------------------------------------------------------
    output_path.parent.mkdir(parents=True, exist_ok=True)
    csv_fields = [
        "participant_uuid",
        "participant_name",
        "profile_url",
        "badge_id",
        "badge_title",
        "classification",
        "classification_signal",
        "classification_method",
        "badge_href",
        "image_url",
        "earned_date_raw",
    ]

    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=csv_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_records)

    print(f"Badge classification CSV written: {output_path.resolve()}")

    # -----------------------------------------------------------------------
    # Build summary statistics
    # -----------------------------------------------------------------------
    total_badges = len(all_records)
    skill_count = sum(1 for r in all_records if r["classification"] == CLASSIFICATION_SKILL)
    arcade_count = sum(1 for r in all_records if r["classification"] == CLASSIFICATION_ARCADE)
    unknown_count = sum(1 for r in all_records if r["classification"] == CLASSIFICATION_UNKNOWN)

    participants_with_badges = sum(
        1 for p in per_participant.values() if p["total_badge_count"] > 0
    )
    participants_zero = sum(
        1 for p in per_participant.values() if p["total_badge_count"] == 0
    )

    # Unique badge IDs per classification
    unique_skill_ids = {r["badge_id"] for r in all_records if r["classification"] == CLASSIFICATION_SKILL}
    unique_arcade_ids = {r["badge_id"] for r in all_records if r["classification"] == CLASSIFICATION_ARCADE}
    unique_unknown_ids = {r["badge_id"] for r in all_records if r["classification"] == CLASSIFICATION_UNKNOWN}

    # Per-participant breakdown
    per_participant_summary = sorted(
        per_participant.values(),
        key=lambda p: (-p["total_badge_count"], p["participant_name"]),
    )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "classification_method": {
            "description": "Structural DOM signal from ql-dialog modal href",
            "SKILL_BADGE": "modal ql-button href starts with /course_templates/",
            "ARCADE_GAME_BADGE": "modal ql-button href starts with /games/",
            "UNKNOWN": "modal not found or href pattern unrecognized",
        },
        "total_participants": len(per_participant),
        "participants_with_badges": participants_with_badges,
        "participants_zero_badges": participants_zero,
        "total_badge_awards": total_badges,
        "classified_skill_badge": skill_count,
        "classified_arcade_game_badge": arcade_count,
        "classified_unknown": unknown_count,
        "classification_rate_pct": round(
            (skill_count + arcade_count) / total_badges * 100, 2
        ) if total_badges > 0 else 0.0,
        "unique_badge_ids": {
            "SKILL_BADGE": sorted(unique_skill_ids),
            "ARCADE_GAME_BADGE": sorted(unique_arcade_ids),
            "UNKNOWN": sorted(unique_unknown_ids),
        },
        "missing_html_files": missing_html,
        "per_participant": per_participant_summary,
    }

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Badge classification report written: {report_path.resolve()}")

    # -----------------------------------------------------------------------
    # Console summary
    # -----------------------------------------------------------------------
    print(f"\n{'='*60}")
    print("PHASE 7B — BADGE CLASSIFICATION SUMMARY")
    print(f"{'='*60}")
    print(f"Total participants:               {len(per_participant)}")
    print(f"Participants with badges:         {participants_with_badges}")
    print(f"Participants with zero badges:    {participants_zero}")
    print(f"")
    print(f"Total badge awards classified:    {total_badges}")
    print(f"  SKILL_BADGE:                    {skill_count}")
    print(f"  ARCADE_GAME_BADGE:              {arcade_count}")
    print(f"  UNKNOWN:                        {unknown_count}")
    if total_badges > 0:
        print(f"  Classification rate:            {(skill_count + arcade_count) / total_badges * 100:.1f}%")
    print(f"")
    print(f"Unique badge IDs — SKILL_BADGE:   {len(unique_skill_ids)}")
    print(f"Unique badge IDs — ARCADE_GAME:   {len(unique_arcade_ids)}")
    print(f"Unique badge IDs — UNKNOWN:       {len(unique_unknown_ids)}")
    if missing_html:
        print(f"\nWARNING: {len(missing_html)} HTML file(s) missing: {missing_html}")
    print(f"\nOutputs:")
    print(f"  {output_path.resolve()}")
    print(f"  {report_path.resolve()}")


if __name__ == "__main__":
    main()

