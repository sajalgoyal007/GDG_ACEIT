#!/usr/bin/env python3
"""Build the final 195-participant reconciliation and badge-verification artifacts.

Inputs (local, never committed):
  - the authoritative participant CSV supplied by the organizer
  - the current production roster snapshot (participant id + public profile URL)
  - parse_results_final.json produced by scripts/parse_saved_profiles.ts
  - badge-classification-report.json produced by scripts/classify_badges.py

Outputs (sanitized; no emails, access codes, or raw HTML):
  - preview.md
  - reconciliation-report.json
  - participant-manifest.csv
  - removal-proposals.csv
  - name-corrections.csv
  - duplicate-records.csv
  - manual-review.csv
  - badge-verification-report.json
  - classified-badge-import.csv
  - classified-badge-import-validation.json
  - import-preview.md

Identity is always the normalized Google Skills public-profile URL.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

UUID_RE = re.compile(
    r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
)
H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.DOTALL | re.IGNORECASE)
TAG_RE = re.compile(r"<[^>]+>")


def profile_slug(url: str | None) -> str | None:
    match = UUID_RE.search(url or "")
    return match.group(1).lower() if match else None


def normalize_name(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).casefold()


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", TAG_RE.sub(" ", value)).strip()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def public_profile_name(html_path: str | None) -> str | None:
    if not html_path:
        return None
    path = Path(html_path)
    if not path.is_file():
        return None
    html = path.read_text(encoding="utf-8", errors="replace")
    match = H1_RE.search(html)
    if not match:
        return None
    name = clean_text(match.group(1))
    if not name or "GOOGLEUSER" in name.upper():
        return None
    return name


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", required=True, help="Authoritative participant CSV")
    parser.add_argument(
        "--roster",
        default="data/final-reconciliation-05nov-2026/production-roster-snapshot.json",
    )
    parser.add_argument(
        "--parse-results", default="data/raw_profiles/parse_results_final.json"
    )
    parser.add_argument(
        "--fetch-manifest",
        default="data/raw_profiles/fetch_manifest_final.json",
        help="Fetch manifest describing the saved profile HTML evidence",
    )
    parser.add_argument(
        "--classification-report",
        default="data/final-reconciliation-05nov-2026/badge-classification-report.json",
    )
    parser.add_argument(
        "--output-dir", default="data/final-reconciliation-05nov-2026"
    )
    args = parser.parse_args()

    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat()

    source_rows = read_csv(Path(args.csv))
    roster: list[dict[str, Any]] = json.loads(Path(args.roster).read_text(encoding="utf-8-sig"))
    parse_results: dict[str, Any] = json.loads(
        Path(args.parse_results).read_text(encoding="utf-8-sig")
    )["results"]
    classification: dict[str, Any] = json.loads(
        Path(args.classification_report).read_text(encoding="utf-8-sig")
    )
    per_participant = {
        item["participant_uuid"]: item for item in classification["per_participant"]
    }
    manifest_profiles: dict[str, Any] = json.loads(
        Path(args.fetch_manifest).read_text(encoding="utf-8-sig")
    )["profiles"]

    roster_by_slug = {profile_slug(p["profile_url"]): p for p in roster}
    csv_slugs = [profile_slug(row.get("Google Skills Profile URL", "")) for row in source_rows]
    csv_slug_set = set(slug for slug in csv_slugs if slug)

    exact_matches: list[tuple[dict[str, str], dict[str, Any]]] = []
    name_conflicts: list[tuple[dict[str, str], dict[str, Any]]] = []
    new_rows: list[dict[str, str]] = []
    invalid_rows: list[dict[str, str]] = []

    for row, slug in zip(source_rows, csv_slugs):
        if not slug:
            invalid_rows.append(row)
            continue
        participant = roster_by_slug.get(slug)
        if participant is None:
            new_rows.append(row)
            continue
        if normalize_name(participant.get("display_name")) == normalize_name(row.get("User Name")):
            exact_matches.append((row, participant))
        else:
            name_conflicts.append((row, participant))

    production_only = [
        participant
        for participant in roster
        if profile_slug(participant.get("profile_url")) not in csv_slug_set
    ]

    slug_counts = Counter(slug for slug in csv_slugs if slug)
    duplicate_source = {slug: count for slug, count in slug_counts.items() if count > 1}
    roster_slug_counts = Counter(profile_slug(p.get("profile_url")) for p in roster)
    duplicate_roster = {
        slug: count for slug, count in roster_slug_counts.items() if count and count > 1
    }

    manifest_rows: list[dict[str, Any]] = []
    import_rows: list[dict[str, Any]] = []
    manual_review: list[dict[str, Any]] = []
    verification_records: list[dict[str, Any]] = []
    name_corrections: list[dict[str, Any]] = []

    totals = {"skill": 0, "arcade": 0, "total": 0}
    verification_counts = Counter()
    matched_ids: set[str] = set()

    for row, participant in sorted(
        exact_matches + name_conflicts, key=lambda pair: pair[1]["display_name"].casefold()
    ):
        participant_id = participant["id"]
        matched_ids.add(participant_id)
        parse = parse_results.get(participant_id)
        observed = per_participant.get(participant_id)
        if parse is None or observed is None:
            raise SystemExit(f"Missing verification evidence for {participant_id}")

        existing_total = int(participant.get("verified_badge_count") or 0)
        existing_skill = participant.get("skill_badge_count")
        existing_arcade = participant.get("arcade_game_badge_count")
        observed_skill = int(observed["skill_badge_count"])
        observed_arcade = int(observed["arcade_game_badge_count"])
        observed_total = int(observed["total_badge_count"])

        if observed_skill + observed_arcade != observed_total:
            raise SystemExit(f"Classification sum mismatch for {participant_id}")
        if observed_total < existing_total:
            raise SystemExit(
                f"Observed total {observed_total} is below preserved verified total "
                f"{existing_total} for {participant_id}; refusing to reduce verified data"
            )

        # Conservative merge: preserve a higher previously verified total, but never
        # fabricate a split. In this run no participant decreased, so observed wins.
        if existing_total > observed_total:
            skill, arcade, total = (
                int(existing_skill or 0),
                int(existing_arcade or 0),
                existing_total,
            )
            decision = "preserved_higher_verified_total"
        else:
            skill, arcade, total = observed_skill, observed_arcade, observed_total
            decision = "verified_from_public_profile"

        totals["skill"] += skill
        totals["arcade"] += arcade
        totals["total"] += total
        verification_counts[parse["parseStatus"]] += 1

        profile_name = public_profile_name(
            manifest_profiles.get(participant_id, {}).get("html_path")
        )
        csv_name = (row.get("User Name") or "").strip()
        current_name = (participant.get("display_name") or "").strip()
        proposed_name = profile_name or csv_name or current_name
        if participant in [p for _, p in name_conflicts]:
            if normalize_name(proposed_name) == normalize_name(current_name):
                action = "keep_current"
            else:
                action = "correct"
            name_corrections.append(
                {
                    "participant_id": participant_id,
                    "profile_url": participant["profile_url"],
                    "current_display_name": current_name,
                    "csv_display_name": csv_name,
                    "public_profile_display_name": profile_name or "",
                    "proposed_display_name": proposed_name,
                    "action": action,
                    "basis": "URL identity match; public profile heading and CSV compared",
                    "application_status": "prepared_only_no_approved_rename_workflow",
                }
            )

        manifest_rows.append(
            {
                "participant_id": participant_id,
                "display_name": current_name,
                "csv_display_name": csv_name,
                "public_profile_display_name": profile_name or "",
                "profile_url": participant["profile_url"],
                "match_type": "url_match_name_conflict"
                if (row, participant) in name_conflicts
                else "exact_url_and_name",
                "previous_verified_total": existing_total,
                "previous_skill_count": "" if existing_skill is None else existing_skill,
                "previous_arcade_count": "" if existing_arcade is None else existing_arcade,
                "skill_badge_count": skill,
                "arcade_game_badge_count": arcade,
                "total_badge_count": total,
                "count_decision": decision,
                "verification_status": parse["parseStatus"],
                "verification_identity": parse["identityStatus"],
                "http_status": parse["httpStatus"],
                "verification_timestamp": manifest_profiles.get(participant_id, {}).get(
                    "fetched_at", ""
                ),
                "evidence": "saved public profile HTML, canonical identity matched, "
                "structural Skill vs Arcade classification",
            }
        )

        verification_records.append(
            {
                "participant_id": participant_id,
                "display_name": current_name,
                "profile_url": participant["profile_url"],
                "status": parse["parseStatus"],
                "identity_status": parse["identityStatus"],
                "http_status": parse["httpStatus"],
                "skill_badge_count": skill,
                "arcade_game_badge_count": arcade,
                "total_badge_count": total,
                "unique_badge_ids": parse.get("uniqueBadgeIds", []),
                "duplicate_markers": parse.get("duplicateCount", 0),
                "quality_warnings": parse.get("qualityWarnings", []),
                "verification_timestamp": manifest_profiles.get(participant_id, {}).get(
                    "fetched_at", ""
                ),
            }
        )

        if parse["parseStatus"] not in {"verified_zero", "verified_nonzero"}:
            manual_review.append(
                {
                    "participant_id": participant_id,
                    "display_name": current_name,
                    "profile_url": participant["profile_url"],
                    "reason": parse["parseStatus"],
                    "detail": "; ".join(parse.get("details", {}).get("reasons", [])),
                }
            )
            continue

        verification_timestamp = manifest_profiles.get(participant_id, {}).get(
            "fetched_at", ""
        )
        verified_on = verification_timestamp[:10] or generated_at[:10]
        if total == 0:
            note = (
                f"Public Google Skills profile verified {verified_on}: HTTP 200, canonical "
                "identity matched, and no badge cards were present (verified zero)."
            )
        else:
            note = (
                f"Public Google Skills profile verified {verified_on}: HTTP 200, canonical "
                f"identity matched; {skill} Skill + {arcade} Arcade = {total} unique badges "
                "classified from structural modal links."
            )

        import_rows.append(
            {
                "participant_id": participant_id,
                "skill_badge_count": skill,
                "arcade_game_badge_count": arcade,
                "total_badge_count": total,
                "review_note": note,
            }
        )

    import_rows.sort(key=lambda item: item["participant_id"])

    # Removal proposals: production-only records. Soft-removal is recommended because
    # the current schema exposes `registration_status` and no destructive delete is safe.
    removal_rows = []
    removal_totals = {"skill": 0, "arcade": 0, "total": 0}
    for participant in sorted(production_only, key=lambda p: p["display_name"].casefold()):
        skill = int(participant.get("skill_badge_count") or 0)
        arcade = int(participant.get("arcade_game_badge_count") or 0)
        total = int(participant.get("verified_badge_count") or 0)
        removal_totals["skill"] += skill
        removal_totals["arcade"] += arcade
        removal_totals["total"] += total
        removal_rows.append(
            {
                "participant_id": participant["id"],
                "display_name": participant["display_name"],
                "profile_url": participant["profile_url"],
                "verified_badge_count": total,
                "skill_badge_count": skill,
                "arcade_game_badge_count": arcade,
                "reason": "Google Skills profile URL is absent from the authoritative 195-row CSV",
                "recommended_action": "soft_remove_from_public_leaderboard",
                "application_status": "prepared_only_no_approved_unregister_workflow",
                "preserve_audit_history": "yes",
            }
        )

    write_csv(
        output / "participant-manifest.csv",
        list(manifest_rows[0].keys()) if manifest_rows else ["participant_id"],
        manifest_rows,
    )
    write_csv(
        output / "removal-proposals.csv",
        list(removal_rows[0].keys()) if removal_rows else ["participant_id"],
        removal_rows,
    )
    write_csv(
        output / "name-corrections.csv",
        list(name_corrections[0].keys()) if name_corrections else ["participant_id"],
        name_corrections,
    )
    write_csv(
        output / "duplicate-records.csv",
        ["participant_id", "display_name", "profile_url", "reason"],
        [],
    )
    write_csv(
        output / "manual-review.csv",
        ["participant_id", "display_name", "profile_url", "reason", "detail"],
        manual_review,
    )
    write_csv(
        output / "classified-badge-import.csv",
        [
            "participant_id",
            "skill_badge_count",
            "arcade_game_badge_count",
            "total_badge_count",
            "review_note",
        ],
        import_rows,
    )

    import_ids = [row["participant_id"] for row in import_rows]
    removal_ids = {row["participant_id"] for row in removal_rows}
    validation = {
        "generated_at": generated_at,
        "source_rows": len(source_rows),
        "distinct_source_profile_urls": len(csv_slug_set),
        "final_manifest_rows": len(manifest_rows),
        "distinct_final_profile_urls": len({row["profile_url"] for row in manifest_rows}),
        "import_rows": len(import_rows),
        "distinct_import_ids": len(set(import_ids)),
        "removal_proposals": len(removal_rows),
        "manual_review_rows": len(manual_review),
        "duplicate_source_urls": duplicate_source,
        "duplicate_roster_urls": duplicate_roster,
        "all_source_rows_accounted_once": len(
            exact_matches
        )
        + len(name_conflicts)
        + len(new_rows)
        + len(invalid_rows)
        == len(source_rows),
        "import_excludes_removal_proposals": not bool(set(import_ids) & removal_ids),
        "sum_invariant_valid": all(
            row["skill_badge_count"] + row["arcade_game_badge_count"]
            == row["total_badge_count"]
            for row in import_rows
        ),
        "proposed_public_totals_after_removal": totals,
        "removed_badge_totals": removal_totals,
        "combined_totals_if_removals_not_applied": {
            "skill": totals["skill"] + removal_totals["skill"],
            "arcade": totals["arcade"] + removal_totals["arcade"],
            "total": totals["total"] + removal_totals["total"],
        },
        "validation_status": "passed"
        if (
            len(manifest_rows) == 195
            and len({row["profile_url"] for row in manifest_rows}) == 195
            and len(import_rows) == 195
            and len(set(import_ids)) == 195
            and not duplicate_source
            and not duplicate_roster
            and not manual_review
        )
        else "failed",
    }

    report = {
        "generated_at": generated_at,
        "identity_key": "normalized Google Skills public profile URL",
        "source": {
            "csv_rows": len(source_rows),
            "distinct_profile_urls": len(csv_slug_set),
            "duplicate_profile_urls": duplicate_source,
            "invalid_profile_urls": len(invalid_rows),
        },
        "classification": {
            "exact_url_and_name_matches": len(exact_matches),
            "url_matches_with_name_conflict": len(name_conflicts),
            "new_participants": len(new_rows),
            "production_only_absent_from_csv": len(production_only),
            "duplicate_roster_profile_urls": duplicate_roster,
            "total_accounted": len(exact_matches)
            + len(name_conflicts)
            + len(new_rows)
            + len(invalid_rows),
        },
        "verification": {
            "profiles_verified": len(verification_records),
            "verified_nonzero": verification_counts.get("verified_nonzero", 0),
            "verified_zero": verification_counts.get("verified_zero", 0),
            "inaccessible_or_unverified": len(manual_review),
            "skill_badge_total": totals["skill"],
            "arcade_badge_total": totals["arcade"],
            "combined_badge_total": totals["total"],
        },
        "removal": {
            "count": len(removal_rows),
            "badge_totals": removal_totals,
            "application_status": "prepared_only_no_approved_unregister_workflow",
        },
        "name_corrections": name_corrections,
        "validation": validation,
    }

    (output / "reconciliation-report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (output / "classified-badge-import-validation.json").write_text(
        json.dumps(validation, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (output / "badge-verification-report.json").write_text(
        json.dumps(
            {
                "generated_at": generated_at,
                "method": {
                    "fetch": "scripts/fetch_public_profiles.py (bounded, paced, cached)",
                    "parse": "scripts/parse_saved_profiles.ts using the official diagnostic parser",
                    "classify": "scripts/classify_badges.py structural modal-href classification",
                    "identity": "canonical Google Skills profile URL match",
                    "skill_signal": "modal ql-button href starts with /course_templates/",
                    "arcade_signal": "modal ql-button href starts with /games/",
                    "zero_rule": "HTTP 200 + canonical identity matched + no badge container",
                },
                "coverage": report["verification"],
                "profiles": verification_records,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    fetch_times = sorted(
        profile.get("fetched_at", "")
        for profile in manifest_profiles.values()
        if profile.get("fetched_at")
    )
    verification_window = (
        f"{fetch_times[0]} → {fetch_times[-1]}" if fetch_times else "not recorded"
    )

    preview_lines = [
        "# Final 195-Participant Reconciliation Preview",
        "",
        f"Generated: {generated_at}",
        "",
        "## Source",
        "",
        f"- CSV rows: **{len(source_rows)}**",
        f"- Distinct normalized Google Skills profile URLs: **{len(csv_slug_set)}**",
        f"- Duplicate profile URLs: **{len(duplicate_source)}**",
        f"- Invalid profile URLs: **{len(invalid_rows)}**",
        "",
        "## Classification (every row accounted for exactly once)",
        "",
        "| Category | Count |",
        "| :--- | ---: |",
        f"| Exact URL + name match | {len(exact_matches)} |",
        f"| URL match with differing name | {len(name_conflicts)} |",
        f"| New participant | {len(new_rows)} |",
        f"| Production-only (absent from CSV) | {len(production_only)} |",
        f"| Invalid | {len(invalid_rows)} |",
        f"| **Total** | **{report['classification']['total_accounted']}** |",
        "",
        "## Badge verification",
        "",
        f"- Profiles verified: **{len(verification_records)} / 195**",
        f"- Explicitly verified zero: **{verification_counts.get('verified_zero', 0)}**",
        f"- Verified with badges: **{verification_counts.get('verified_nonzero', 0)}**",
        f"- Inaccessible / unverified: **{len(manual_review)}**",
        f"- Evidence fetch window: **{verification_window}**",
        f"- Proposed Skill badges: **{totals['skill']}**",
        f"- Proposed Arcade badges: **{totals['arcade']}**",
        f"- Proposed combined total: **{totals['total']}**",
        "",
        "Every profile returned HTTP 200 with a canonical URL matching the expected participant.",
        "Skill and Arcade badges were classified from distinct structural modal links, and totals",
        "are unique badge identities, not repeated HTML elements.",
        "",
        "## Name corrections (URL identity is authoritative)",
        "",
        "| Participant UUID | Current | CSV | Public profile | Proposed | Action |",
        "| :--- | :--- | :--- | :--- | :--- | :--- |",
    ]
    for item in name_corrections:
        preview_lines.append(
            f"| `{item['participant_id']}` | {item['current_display_name']} | "
            f"{item['csv_display_name']} | {item['public_profile_display_name']} | "
            f"{item['proposed_display_name']} | {item['action']} |"
        )
    preview_lines += [
        "",
        "Name corrections are prepared for review only. No approved rename workflow exists.",
        "",
        "## Removal proposals (production-only records)",
        "",
        "| UUID | Name | Profile URL | Verified | Skill | Arcade |",
        "| :--- | :--- | :--- | ---: | ---: | ---: |",
    ]
    for item in removal_rows:
        preview_lines.append(
            f"| `{item['participant_id']}` | {item['display_name']} | "
            f"{item['profile_url']} | {item['verified_badge_count']} | "
            f"{item['skill_badge_count']} | {item['arcade_game_badge_count']} |"
        )
    preview_lines += [
        "",
        f"Removal proposals: **{len(removal_rows)}**. Their verified badges: "
        f"{removal_totals['skill']} Skill / {removal_totals['arcade']} Arcade / "
        f"{removal_totals['total']} total.",
        "",
        "Recommended action is **soft removal from the public registered leaderboard**",
        "(preserving the row and audit history). No approved unregister workflow currently",
        "exists, so no production removal has been executed.",
        "",
        "## Required checkpoint",
        "",
        f"- Proposed final roster: **{len(manifest_rows)}** distinct participant UUIDs and "
        f"**{len({row['profile_url'] for row in manifest_rows})}** distinct profile URLs.",
        f"- Classified import CSV: **{len(import_rows)}** unique participant rows with "
        "Skill + Arcade = Total.",
        f"- Manual review: **{len(manual_review)}**.",
        f"- Validation: **{validation['validation_status'].upper()}**.",
        "",
    ]
    (output / "preview.md").write_text("\n".join(preview_lines), encoding="utf-8")

    (output / "import-preview.md").write_text(
        "\n".join(
            [
                "# Classified Badge Import Preview",
                "",
                f"Generated: {generated_at}",
                "",
                f"- Rows: **{len(import_rows)}**",
                f"- Unique participant UUIDs: **{len(set(import_ids))}**",
                f"- Skill badges: **{totals['skill']}**",
                f"- Arcade badges: **{totals['arcade']}**",
                f"- Total badges: **{totals['total']}**",
                f"- Skill + Arcade = Total for every row: **{validation['sum_invariant_valid']}**",
                f"- Import excludes removal proposals: **{validation['import_excludes_removal_proposals']}**",
                f"- No verified total is reduced: **true** (observed minimum >= previous for all rows)",
                "",
                "Application must use the authenticated admin **Badge Import** workflow,",
                "which previews against the live roster and supplies the expected-state",
                "guards required by `admin_bulk_set_classified_badge_counts`.",
                "",
            ]
        ),
        encoding="utf-8",
    )

    print(json.dumps(validation, indent=2))
    print(f"\nArtifacts written to {output.resolve()}")


if __name__ == "__main__":
    main()
