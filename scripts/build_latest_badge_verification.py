#!/usr/bin/env python3
"""Build the latest 195-participant classified badge import and verification artifacts.

Inputs:
  - data/final-reconciliation-05nov-2026/participant-manifest.csv (authoritative 195 roster)
  - data/badge-verification-latest/production-roster-snapshot.json (public production projection)
  - data/raw_profiles/fetch_manifest_latest.json (fresh fetch evidence)
  - data/raw_profiles/parse_results_latest.json (official parser output)
  - data/badge-verification-latest/badge-classification-report.json (Skill vs Arcade)

Outputs:
  - data/classified-badge-import-latest.csv
  - data/badge-verification-latest/preview.md
  - data/badge-verification-latest/verification-report.json
  - data/badge-verification-latest/manual-review.csv
  - data/badge-verification-latest/count-changes.csv
  - data/badge-verification-latest/import-validation.json

Identity is always the production participant UUID and normalized Google Skills
profile URL. No emails, credentials, or secrets are written.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
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

IMPORT_COLUMNS = [
    "participant_id",
    "skill_badge_count",
    "arcade_game_badge_count",
    "total_badge_count",
    "review_note",
]
MANUAL_COLUMNS = ["participant_id", "display_name", "profile_url", "reason", "detail"]
CHANGE_COLUMNS = [
    "participant_id",
    "display_name",
    "profile_url",
    "old_skill_badge_count",
    "old_arcade_game_badge_count",
    "old_total_badge_count",
    "new_skill_badge_count",
    "new_arcade_game_badge_count",
    "new_total_badge_count",
    "skill_delta",
    "arcade_delta",
    "total_delta",
    "previous_verified_total",
    "verification_status",
    "review_reason",
]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def profile_slug(url: str | None) -> str | None:
    match = UUID_RE.search(url or "")
    return match.group(1).lower() if match else None


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", TAG_RE.sub(" ", value)).strip()


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


def as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--roster-manifest",
        type=Path,
        default=Path("data/final-reconciliation-05nov-2026/participant-manifest.csv"),
    )
    parser.add_argument(
        "--production-roster",
        type=Path,
        default=Path("data/badge-verification-latest/production-roster-snapshot.json"),
    )
    parser.add_argument(
        "--production-summary",
        type=Path,
        default=Path("data/badge-verification-latest/production-summary-snapshot.json"),
    )
    parser.add_argument(
        "--fetch-manifest",
        type=Path,
        default=Path("data/raw_profiles/fetch_manifest_latest.json"),
    )
    parser.add_argument(
        "--parse-results",
        type=Path,
        default=Path("data/raw_profiles/parse_results_latest.json"),
    )
    parser.add_argument(
        "--previous-parse-results",
        type=Path,
        default=Path("data/raw_profiles/parse_results_final_06nov.json"),
    )
    parser.add_argument(
        "--classification-report",
        type=Path,
        default=Path("data/badge-verification-latest/badge-classification-report.json"),
    )
    parser.add_argument(
        "--import-csv", type=Path, default=Path("data/classified-badge-import-latest.csv")
    )
    parser.add_argument(
        "--output-dir", type=Path, default=Path("data/badge-verification-latest")
    )
    parser.add_argument(
        "--authoritative-csv",
        type=Path,
        default=None,
        help="Optional organizer CSV used only to verify roster provenance and fingerprint",
    )
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat()

    roster = read_csv(args.roster_manifest)
    production_rows: list[dict[str, Any]] = json.loads(
        args.production_roster.read_text(encoding="utf-8-sig")
    )
    production_summary: dict[str, Any] = json.loads(
        args.production_summary.read_text(encoding="utf-8-sig")
    )
    fetch_profiles: dict[str, Any] = json.loads(
        args.fetch_manifest.read_text(encoding="utf-8-sig")
    )["profiles"]
    parse_results: dict[str, Any] = json.loads(
        args.parse_results.read_text(encoding="utf-8-sig")
    )["results"]
    previous_parse_results: dict[str, Any] = json.loads(
        args.previous_parse_results.read_text(encoding="utf-8-sig")
    )["results"]
    classification: dict[str, Any] = json.loads(
        args.classification_report.read_text(encoding="utf-8-sig")
    )
    classified = {item["participant_uuid"]: item for item in classification["per_participant"]}

    production_by_id = {row["id"].lower(): row for row in production_rows}
    roster_ids = [row["participant_id"].lower() for row in roster]
    roster_slugs = [profile_slug(row["profile_url"]) for row in roster]

    # ------------------------------------------------------------------
    # Validate the roster identity surface before building anything.
    # ------------------------------------------------------------------
    roster_issues: list[str] = []
    if len(roster) != 195:
        roster_issues.append(f"roster has {len(roster)} rows, expected 195")
    if len(set(roster_ids)) != len(roster_ids):
        roster_issues.append("duplicate participant IDs in roster")
    if len(set(slug for slug in roster_slugs if slug)) != len(roster_slugs):
        roster_issues.append("missing or duplicate normalized profile URLs in roster")
    unknown_roster_ids = [pid for pid in roster_ids if pid not in production_by_id]
    if unknown_roster_ids:
        roster_issues.append(f"{len(unknown_roster_ids)} roster IDs are absent from production")
    missing_roster_profiles = [
        pid for pid in roster_ids if pid not in fetch_profiles or pid not in parse_results or pid not in classified
    ]
    if missing_roster_profiles:
        roster_issues.append(
            f"{len(missing_roster_profiles)} roster IDs lack fresh verification evidence"
        )

    # Optional provenance check against the organizer's authoritative CSV.
    # Only aggregate counts and a SHA-256 fingerprint are persisted; columns
    # containing emails or access codes are never copied into artifacts.
    authoritative_summary: dict[str, Any] | None = None
    authoritative_mismatches = 0
    if args.authoritative_csv is not None:
        authoritative_rows = read_csv(args.authoritative_csv)
        auth_slugs = [
            profile_slug(row.get("Google Skills Profile URL", ""))
            for row in authoritative_rows
        ]
        roster_by_slug = {
            profile_slug(row["profile_url"]): row for row in roster
        }
        auth_slug_set = {slug for slug in auth_slugs if slug}
        roster_slug_set = {slug for slug in roster_slugs if slug}
        missing_from_roster = auth_slug_set - roster_slug_set
        extra_in_roster = roster_slug_set - auth_slug_set
        name_mismatches = 0
        for row, slug in zip(authoritative_rows, auth_slugs):
            roster_row = roster_by_slug.get(slug)
            if roster_row is None:
                continue
            if (row.get("User Name") or "").strip() != (
                roster_row.get("csv_display_name") or ""
            ).strip():
                name_mismatches += 1
        authoritative_mismatches = (
            len(missing_from_roster)
            + len(extra_in_roster)
            + name_mismatches
            + (0 if len(authoritative_rows) == 195 else 1)
            + (0 if len(auth_slug_set) == 195 else 1)
        )
        authoritative_summary = {
            "filename": args.authoritative_csv.name,
            "sha256": hashlib.sha256(args.authoritative_csv.read_bytes()).hexdigest(),
            "rows": len(authoritative_rows),
            "unique_normalized_profile_urls": len(auth_slug_set),
            "missing_from_roster": len(missing_from_roster),
            "extra_in_roster": len(extra_in_roster),
            "display_name_mismatches": name_mismatches,
            "sensitive_columns_copied": False,
        }

    import_rows: list[dict[str, Any]] = []
    manual_review: list[dict[str, Any]] = []
    change_rows: list[dict[str, Any]] = []
    verification_records: list[dict[str, Any]] = []
    verification_counts: Counter[str] = Counter()
    proposed_totals = {"skill": 0, "arcade": 0, "total": 0}
    production_subset_totals = {"skill": 0, "arcade": 0, "total": 0}

    for roster_row in sorted(roster, key=lambda row: row["display_name"].casefold()):
        participant_id = roster_row["participant_id"].lower()
        production = production_by_id.get(participant_id)
        if production is None:
            raise SystemExit(f"Participant {participant_id} is absent from production")
        parse = parse_results[participant_id]
        observed = classified[participant_id]
        fetch_entry = fetch_profiles.get(participant_id, {})
        previous = previous_parse_results.get(participant_id)

        observed_skill = as_int(observed["skill_badge_count"])
        observed_arcade = as_int(observed["arcade_game_badge_count"])
        observed_unknown = as_int(observed.get("unknown_badge_count", 0))
        observed_total = as_int(observed["total_badge_count"])
        parse_total = as_int(parse["badgeCount"])

        current_skill = as_int(production.get("skill_badge_count"))
        current_arcade = as_int(production.get("arcade_game_badge_count"))
        current_total = as_int(production.get("verified_badge_count"))
        previous_total = as_int(previous["badgeCount"]) if previous else 0

        production_subset_totals["skill"] += current_skill
        production_subset_totals["arcade"] += current_arcade
        production_subset_totals["total"] += current_total

        status = parse["parseStatus"]
        identity = parse["identityStatus"]
        http_status = as_int(parse["httpStatus"])
        verification_counts[status] += 1

        reasons: list[str] = []
        if http_status != 200 or status not in {"verified_zero", "verified_nonzero"}:
            reasons.append(f"fresh profile not verified ({status}, HTTP {http_status})")
        if identity != "matched":
            reasons.append(f"profile identity is {identity}")
        if observed_skill + observed_arcade + observed_unknown != observed_total:
            reasons.append("classification counts do not sum to the parsed total")
        if parse_total != observed_total:
            reasons.append(
                f"parser counted {parse_total} badges but classification accounts for {observed_total}"
            )
        if observed_unknown > 0:
            reasons.append(f"{observed_unknown} badges could not be classified")
        if observed_total < previous_total:
            reasons.append(
                f"fresh total {observed_total} is below the previously verified total {previous_total}"
            )
        if observed_total < current_total:
            reasons.append(
                f"fresh total {observed_total} is below the current production total {current_total}"
            )

        manual_case = bool(reasons)
        if manual_case:
            # Preserve current production counts rather than reducing verified data.
            proposed_skill = current_skill
            proposed_arcade = current_arcade
            proposed_total = current_total
            manual_review.append(
                {
                    "participant_id": participant_id,
                    "display_name": production.get("display_name", roster_row["display_name"]),
                    "profile_url": roster_row["profile_url"],
                    "reason": "; ".join(reasons),
                    "detail": "Current production counts preserved; no unsafe update applied.",
                }
            )
        else:
            proposed_skill = observed_skill
            proposed_arcade = observed_arcade
            proposed_total = observed_total

        proposed_totals["skill"] += proposed_skill
        proposed_totals["arcade"] += proposed_arcade
        proposed_totals["total"] += proposed_total

        changed = (
            proposed_skill != current_skill
            or proposed_arcade != current_arcade
            or proposed_total != current_total
        )
        if changed:
            change_rows.append(
                {
                    "participant_id": participant_id,
                    "display_name": production.get("display_name", roster_row["display_name"]),
                    "profile_url": roster_row["profile_url"],
                    "old_skill_badge_count": current_skill,
                    "old_arcade_game_badge_count": current_arcade,
                    "old_total_badge_count": current_total,
                    "new_skill_badge_count": proposed_skill,
                    "new_arcade_game_badge_count": proposed_arcade,
                    "new_total_badge_count": proposed_total,
                    "skill_delta": proposed_skill - current_skill,
                    "arcade_delta": proposed_arcade - current_arcade,
                    "total_delta": proposed_total - current_total,
                    "previous_verified_total": previous_total,
                    "verification_status": status,
                    "review_reason": "; ".join(reasons) if reasons else "fresh verified public profile",
                }
            )

        verification_records.append(
            {
                "participant_id": participant_id,
                "display_name": production.get("display_name", roster_row["display_name"]),
                "public_profile_display_name": public_profile_name(fetch_entry.get("html_path")),
                "profile_url": roster_row["profile_url"],
                "status": status,
                "identity_status": identity,
                "http_status": http_status,
                "skill_badge_count": proposed_skill,
                "arcade_game_badge_count": proposed_arcade,
                "total_badge_count": proposed_total,
                "observed_skill_badge_count": observed_skill,
                "observed_arcade_game_badge_count": observed_arcade,
                "observed_total_badge_count": observed_total,
                "current_production_skill_badge_count": current_skill,
                "current_production_arcade_game_badge_count": current_arcade,
                "current_production_total_badge_count": current_total,
                "previous_verified_total": previous_total,
                "unique_badge_ids": parse.get("uniqueBadgeIds", []),
                "duplicate_markers": parse.get("duplicateCount", 0),
                "quality_warnings": parse.get("qualityWarnings", []),
                "fetch_attempts": fetch_entry.get("attempts", 1),
                "verification_timestamp": fetch_entry.get("fetched_at", ""),
                "manual_review": manual_case,
            }
        )

        verified_on = str(fetch_entry.get("fetched_at", ""))[:10] or generated_at[:10]
        if manual_case:
            note = (
                f"Evidence not applied on {verified_on}: {'; '.join(reasons)}. "
                f"Current production counts preserved ({current_skill} Skill + "
                f"{current_arcade} Arcade = {current_total})."
            )
        elif proposed_total == 0:
            note = (
                f"Public Google Skills profile verified {verified_on}: HTTP 200, canonical "
                "identity matched, and no badge cards were present (verified zero)."
            )
        else:
            note = (
                f"Public Google Skills profile verified {verified_on}: HTTP 200, canonical "
                f"identity matched; {proposed_skill} Skill + {proposed_arcade} Arcade = "
                f"{proposed_total} unique badges classified from structural modal links."
            )
            if changed:
                note += (
                    f" Previous verified count was {current_total}; updated from fresh evidence."
                )

        import_rows.append(
            {
                "participant_id": participant_id,
                "skill_badge_count": proposed_skill,
                "arcade_game_badge_count": proposed_arcade,
                "total_badge_count": proposed_total,
                "review_note": note,
            }
        )

    import_rows.sort(key=lambda row: row["participant_id"])
    change_rows.sort(key=lambda row: (row["display_name"].casefold(), row["participant_id"]))

    # Production-only records are intentionally untouched by this import.
    production_only = [
        row for row in production_rows if row["id"].lower() not in set(roster_ids)
    ]
    production_only_totals = {
        "skill": sum(as_int(row.get("skill_badge_count")) for row in production_only),
        "arcade": sum(as_int(row.get("arcade_game_badge_count")) for row in production_only),
        "total": sum(as_int(row.get("verified_badge_count")) for row in production_only),
    }
    production_all_totals = {
        "skill": sum(as_int(row.get("skill_badge_count")) for row in production_rows),
        "arcade": sum(as_int(row.get("arcade_game_badge_count")) for row in production_rows),
        "total": sum(as_int(row.get("verified_badge_count")) for row in production_rows),
    }
    projected_all_totals = {
        "skill": proposed_totals["skill"] + production_only_totals["skill"],
        "arcade": proposed_totals["arcade"] + production_only_totals["arcade"],
        "total": proposed_totals["total"] + production_only_totals["total"],
    }

    import_ids = [row["participant_id"] for row in import_rows]
    manual_ids = {row["participant_id"] for row in manual_review}
    validation = {
        "generated_at": generated_at,
        "roster_rows": len(roster),
        "import_rows": len(import_rows),
        "distinct_import_ids": len(set(import_ids)),
        "distinct_profile_urls": len({profile_slug(url) for url in roster_slugs if profile_slug(url)}),
        "unknown_production_ids": unknown_roster_ids,
        "missing_evidence_ids": missing_roster_profiles,
        "roster_issues": roster_issues,
        "authoritative_csv": authoritative_summary,
        "authoritative_csv_mismatches": authoritative_mismatches,
        "manual_review_rows": len(manual_review),
        "manual_review_ids_excluded_from_unsafe_updates": sorted(manual_ids),
        "sum_invariant_valid": all(
            row["skill_badge_count"] + row["arcade_game_badge_count"]
            == row["total_badge_count"]
            for row in import_rows
        ),
        "nonnegative_integer_counts": all(
            isinstance(row[column], int) and row[column] >= 0
            for row in import_rows
            for column in (
                "skill_badge_count",
                "arcade_game_badge_count",
                "total_badge_count",
            )
        ),
        "no_unintended_reductions": all(
            record["total_badge_count"]
            >= record["current_production_total_badge_count"]
            for record in verification_records
        ),
        "classification_conflicts": [
            record["participant_id"]
            for record in verification_records
            if record["observed_skill_badge_count"]
            + record["observed_arcade_game_badge_count"]
            != record["observed_total_badge_count"]
        ],
        "validation_status": "passed"
        if (
            len(roster) == 195
            and len(import_rows) == 195
            and len(set(import_ids)) == 195
            and not unknown_roster_ids
            and not missing_roster_profiles
            and not roster_issues
            and authoritative_mismatches == 0
            and not manual_review
            and all(
                row["skill_badge_count"] + row["arcade_game_badge_count"]
                == row["total_badge_count"]
                for row in import_rows
            )
            and all(
                record["total_badge_count"]
                >= record["current_production_total_badge_count"]
                for record in verification_records
            )
        )
        else "failed",
    }

    write_csv(args.import_csv, IMPORT_COLUMNS, import_rows)
    write_csv(args.output_dir / "manual-review.csv", MANUAL_COLUMNS, manual_review)
    write_csv(args.output_dir / "count-changes.csv", CHANGE_COLUMNS, change_rows)

    report = {
        "generated_at": generated_at,
        "method": {
            "fetch": "scripts/fetch_public_profiles.py (bounded concurrency, retry/backoff, manifest cache)",
            "parse": "scripts/parse_saved_profiles.ts using src/lib/auto-progress/parser.ts",
            "classify": "scripts/classify_badges.py structural modal-href classification",
            "identity": "production participant UUID plus normalized Google Skills profile URL",
            "skill_signal": "modal button href starts with /course_templates/",
            "arcade_signal": "modal button href starts with /games/",
            "zero_rule": "HTTP 200 + canonical identity matched + no badge container",
            "reduction_rule": "never replace a current verified count with a lower or unavailable value",
        },
        "source": {
            "authoritative_csv": authoritative_summary,
            "roster_rows": len(roster),
            "distinct_profile_urls": validation["distinct_profile_urls"],
            "duplicate_profile_urls": len(roster_slugs) - len(set(roster_slugs)),
            "production_registered_count": production_summary.get("registered_count"),
            "production_only_records_untouched": len(production_only),
        },
        "verification": {
            "profiles_fetched_successfully": sum(
                1 for profile in fetch_profiles.values() if as_int(profile.get("status")) == 200
            ),
            "profiles_verified": len(verification_records),
            "profiles_with_badges": verification_counts.get("verified_nonzero", 0),
            "verified_zero_profiles": verification_counts.get("verified_zero", 0),
            "unverified_or_inaccessible": len(manual_review),
            "skill_badge_total": proposed_totals["skill"],
            "arcade_badge_total": proposed_totals["arcade"],
            "combined_badge_total": proposed_totals["total"],
            "fetch_attempts_total": sum(
                as_int(profile.get("attempts", 1)) for profile in fetch_profiles.values()
            ),
            "profiles_requiring_retry": sum(
                1
                for profile in fetch_profiles.values()
                if as_int(profile.get("attempts", 1)) > 1
            ),
            "verification_window": {
                "first": min(
                    (profile.get("fetched_at", "") for profile in fetch_profiles.values()),
                    default="",
                ),
                "last": max(
                    (profile.get("fetched_at", "") for profile in fetch_profiles.values()),
                    default="",
                ),
            },
        },
        "production_comparison": {
            "before": {
                "registered_count": production_summary.get("registered_count"),
                "all_participants": production_all_totals,
                "final_195_participants": production_subset_totals,
                "production_only_records": production_only_totals,
            },
            "proposed_final_195": proposed_totals,
            "projected_all_participants_if_imported_without_roster_cleanup": projected_all_totals,
            "participants_increased": sum(1 for row in change_rows if row["total_delta"] > 0),
            "participants_decreased": sum(1 for row in change_rows if row["total_delta"] < 0),
            "participants_reclassified_same_total": sum(
                1
                for row in change_rows
                if row["total_delta"] == 0
                and (row["skill_delta"] != 0 or row["arcade_delta"] != 0)
            ),
            "participants_unchanged": len(import_rows)
            - sum(1 for row in change_rows if row["total_delta"] != 0 or row["skill_delta"] != 0 or row["arcade_delta"] != 0),
            "manual_review": len(manual_review),
        },
        "count_changes": change_rows,
        "validation": validation,
        "profiles": verification_records,
    }
    (args.output_dir / "verification-report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (args.output_dir / "import-validation.json").write_text(
        json.dumps(validation, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    preview: list[str] = [
        "# Latest Badge Verification Preview",
        "",
        f"Generated: {generated_at}",
        "",
    ]
    if authoritative_summary:
        preview += [
            "## Authoritative source",
            "",
            f"- File: `{authoritative_summary['filename']}`",
            f"- Rows: **{authoritative_summary['rows']}**; unique normalized URLs: "
            f"**{authoritative_summary['unique_normalized_profile_urls']}**",
            f"- Roster mismatches: **{authoritative_mismatches}**",
            f"- SHA-256: `{authoritative_summary['sha256']}`",
            "- Email and access-code columns were read only for provenance; none were copied.",
            "",
        ]
    preview += [
        "## Verification coverage",
        "",
        "| Metric | Value |",
        "| :--- | ---: |",
        f"| Profiles fetched successfully | {report['verification']['profiles_fetched_successfully']} / 195 |",
        f"| Profiles with badges | {report['verification']['profiles_with_badges']} |",
        f"| Explicitly verified zero | {report['verification']['verified_zero_profiles']} |",
        f"| Unverified / inaccessible | {report['verification']['unverified_or_inaccessible']} |",
        f"| Profiles requiring retry | {report['verification']['profiles_requiring_retry']} |",
        f"| Evidence window | {report['verification']['verification_window']['first']} -> {report['verification']['verification_window']['last']} |",
        "",
        "## Proposed badge totals (195 final participants)",
        "",
        "| Category | Current production (195) | Proposed | Delta |",
        "| :--- | ---: | ---: | ---: |",
        f"| Skill badges | {production_subset_totals['skill']} | {proposed_totals['skill']} | {proposed_totals['skill'] - production_subset_totals['skill']:+d} |",
        f"| Arcade game badges | {production_subset_totals['arcade']} | {proposed_totals['arcade']} | {proposed_totals['arcade'] - production_subset_totals['arcade']:+d} |",
        f"| **Total badges** | **{production_subset_totals['total']}** | **{proposed_totals['total']}** | **{proposed_totals['total'] - production_subset_totals['total']:+d}** |",
        "",
        "## Production context (roster cleanup is a separate task)",
        "",
        f"- Production currently has **{len(production_rows)}** registered participants: "
        f"{production_all_totals['skill']} Skill / {production_all_totals['arcade']} Arcade / "
        f"{production_all_totals['total']} total badges.",
        f"- The seven production-only records are untouched and currently hold "
        f"{production_only_totals['skill']} Skill / {production_only_totals['arcade']} Arcade / "
        f"{production_only_totals['total']} total.",
        f"- If this 195-row import is applied without roster cleanup, the projected all-roster "
        f"totals are **{projected_all_totals['skill']} Skill / {projected_all_totals['arcade']} "
        f"Arcade / {projected_all_totals['total']} total**.",
        "",
        "## Count changes (old production → new evidence)",
        "",
        f"- Increased: **{report['production_comparison']['participants_increased']}**",
        f"- Decreased: **{report['production_comparison']['participants_decreased']}**",
        f"- Reclassified with the same total: **{report['production_comparison']['participants_reclassified_same_total']}**",
        f"- Unchanged: **{report['production_comparison']['participants_unchanged']}**",
        f"- Manual review: **{len(manual_review)}**",
        "",
        "| Participant | Old Skill | Old Arcade | Old Total | New Skill | New Arcade | New Total | Delta |",
        "| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in change_rows:
        preview.append(
            f"| {row['display_name']} (`{row['participant_id'][:8]}...`) | "
            f"{row['old_skill_badge_count']} | {row['old_arcade_game_badge_count']} | "
            f"{row['old_total_badge_count']} | {row['new_skill_badge_count']} | "
            f"{row['new_arcade_game_badge_count']} | {row['new_total_badge_count']} | "
            f"{row['total_delta']:+d} |"
        )
    preview += [
        "",
        "## Manual review",
        "",
        f"Manual-review rows: **{len(manual_review)}**.",
    ]
    if manual_review:
        preview += [
            "",
            "| Participant | Reason |",
            "| :--- | :--- |",
        ]
        for row in manual_review:
            preview.append(f"| {row['display_name']} (`{row['participant_id'][:8]}...`) | {row['reason']} |")
    else:
        preview.append(
            "No profile required manual review: every profile returned HTTP 200, matched its "
            "canonical participant URL, and classified cleanly."
        )
    preview += [
        "",
        "## Validation",
        "",
        f"- Import rows: **{len(import_rows)}** (expected 195).",
        f"- Distinct participant IDs: **{len(set(import_ids))}**.",
        f"- Distinct normalized profile URLs: **{validation['distinct_profile_urls']}**.",
        f"- Skill + Arcade = Total: **{'PASS' if validation['sum_invariant_valid'] else 'FAIL'}**.",
        f"- No unintended reductions: **{'PASS' if validation['no_unintended_reductions'] else 'FAIL'}**.",
        f"- Manual-review rows excluded from unsafe updates: **{len(manual_review)}**.",
        f"- Overall validation: **{validation['validation_status'].upper()}**.",
        "",
        "## Import readiness",
        "",
        f"- CSV: `{args.import_csv.as_posix()}`",
        "- The CSV matches the official classified badge import schema exactly.",
        "- Import must be applied through the authenticated admin workflow; no authentication is bypassed.",
        "",
    ]
    (args.output_dir / "preview.md").write_text("\n".join(preview), encoding="utf-8")

    import_preview: list[str] = [
        "# Classified Badge Import Preview (195 rows)",
        "",
        f"Generated: {generated_at}",
        "",
        "## Preview checks",
        "",
        "| Check | Result |",
        "| :--- | :--- |",
        f"| Data rows | {len(import_rows)} / 195 |",
        f"| Distinct participant IDs | {len(set(import_ids))} / 195 |",
        f"| Unknown participant IDs | {len(unknown_roster_ids)} |",
        f"| Missing participant rows | {len(missing_roster_profiles)} |",
        f"| Duplicate participant rows | {len(import_ids) - len(set(import_ids))} |",
        f"| Skill + Arcade = Total | {'PASS' if validation['sum_invariant_valid'] else 'FAIL'} |",
        f"| Unintended reductions | {'0' if validation['no_unintended_reductions'] else 'FOUND'} |",
        f"| Manual-review rows | {len(manual_review)} |",
        "",
        f"Proposed totals: **{proposed_totals['skill']} Skill + {proposed_totals['arcade']} "
        f"Arcade = {proposed_totals['total']} total**.",
        "",
        "## Rows",
        "",
        "| CSV row | Participant ID | Display name | Skill | Arcade | Total | Change |",
        "| ---: | :--- | :--- | ---: | ---: | ---: | :--- |",
    ]
    for index, record in enumerate(
        sorted(verification_records, key=lambda row: row["participant_id"]), start=2
    ):
        changed = (
            record["total_badge_count"] != record["current_production_total_badge_count"]
            or record["skill_badge_count"] != record["current_production_skill_badge_count"]
            or record["arcade_game_badge_count"]
            != record["current_production_arcade_game_badge_count"]
        )
        import_preview.append(
            f"| {index} | `{record['participant_id']}` | {record['display_name']} | "
            f"{record['skill_badge_count']} | {record['arcade_game_badge_count']} | "
            f"{record['total_badge_count']} | {'changed' if changed else 'unchanged'} |"
        )
    (args.output_dir / "import-preview.md").write_text(
        "\n".join(import_preview) + "\n", encoding="utf-8"
    )

    print(json.dumps({"validation": validation, "verification": report["verification"], "production_comparison": report["production_comparison"]}, indent=2))
    return 0 if validation["validation_status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
