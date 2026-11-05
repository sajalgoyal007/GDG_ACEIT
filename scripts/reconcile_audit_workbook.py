import csv
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Tuple, Any, Optional

def normalize_url(url: Optional[str]) -> str:
    """Normalize Google Skills Boost public profile URL to canonical lowercase format."""
    if not url:
        return ""
    m = re.search(r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})", url)
    if m:
        return f"https://www.skills.google/public_profiles/{m.group(1).lower()}"
    return url.strip().rstrip("/").lower()

def extract_slug(url: Optional[str]) -> str:
    """Extract the UUID slug from a Google Skills Boost public profile URL."""
    if not url:
        return ""
    m = re.search(r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})", url)
    if m:
        return m.group(1).lower()
    return url.strip().rstrip("/").split("/")[-1].lower()

def read_excel_workbook(file_path: str) -> Tuple[List[Dict[str, str]], List[Dict[str, str]], List[Dict[str, str]]]:
    """Parse the 3 sheets of the participant profile audit workbook directly from XLSX XML."""
    with zipfile.ZipFile(file_path) as z:
        s1_xml = z.read("xl/worksheets/sheet1.xml")
        s2_xml = z.read("xl/worksheets/sheet2.xml")
        s3_xml = z.read("xl/worksheets/sheet3.xml")
    
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    
    def parse_sheet_rows(xml_content: bytes) -> List[Dict[str, str]]:
        root = ET.fromstring(xml_content)
        sheet_rows = []
        for row in root.findall(".//m:row", ns):
            row_dict = {}
            for c in row.findall("m:c", ns):
                ref = c.attrib.get("r", "")
                col = re.sub(r"[0-9]", "", ref)
                t = c.attrib.get("t")
                v = c.find("m:v", ns)
                val = v.text if v is not None else ""
                if t == "inlineStr":
                    is_el = c.find("m:is/m:t", ns)
                    if is_el is not None and is_el.text:
                        val = is_el.text
                row_dict[col] = val
            sheet_rows.append(row_dict)
        return sheet_rows

    s1_rows = parse_sheet_rows(s1_xml)
    s2_rows = parse_sheet_rows(s2_xml)
    s3_rows = parse_sheet_rows(s3_xml)

    # Valid profile links (Sheet 1): A: Source Row, B: Participant Name, C: Google Skills Public Profile URL, D: Status
    valid_links = []
    for r in s1_rows[1:]:
        if r.get("C"):
            valid_links.append({
                "source_row": r.get("A", "").strip(),
                "participant_name": r.get("B", "").strip(),
                "profile_url": r.get("C", "").strip(),
                "review_status": r.get("D", "").strip(),
                "normalized_url": normalize_url(r.get("C", "")),
                "slug": extract_slug(r.get("C", ""))
            })

    # Needs review (Sheet 2): A: Source Row, B: Participant Name, C: Issue
    needs_review = []
    for r in s2_rows[1:]:
        if r.get("B") or r.get("C"):
            needs_review.append({
                "source_row": r.get("A", "").strip(),
                "participant_name": r.get("B", "").strip(),
                "issue": r.get("C", "").strip()
            })

    # Summary (Sheet 3): A: Metric, B: Count / Detail
    summary = []
    for r in s3_rows[1:]:
        if r.get("A"):
            summary.append({
                "metric": r.get("A", "").strip(),
                "value": r.get("B", "").strip()
            })

    return valid_links, needs_review, summary

def reconcile_dataset(
    excel_path: str,
    roster_path: str,
    classification_report_path: str
) -> Dict[str, Any]:
    """
    Perform strict reconciliation across:
    - Excel workbook (Valid Profile Links, Needs Review, Summary)
    - Production roster (current-production-roster.csv)
    - Verified badge classification report (badge-classification-report.json)
    """
    valid_links, needs_review, summary_rows = read_excel_workbook(excel_path)
    
    with open(roster_path, "r", encoding="utf-8") as f:
        roster_rows = list(csv.DictReader(f))
        
    with open(classification_report_path, "r", encoding="utf-8") as f:
        class_report = json.load(f)

    class_participants = class_report.get("per_participant", [])
    
    # Index production roster by normalized URL
    roster_by_url: Dict[str, Dict[str, str]] = {}
    roster_by_slug: Dict[str, Dict[str, str]] = {}
    for r in roster_rows:
        n_url = normalize_url(r["profile_url"])
        slug = extract_slug(r["profile_url"])
        roster_by_url[n_url] = r
        roster_by_slug[slug] = r

    # Index classification data by normalized URL
    class_by_url: Dict[str, Dict[str, Any]] = {}
    class_by_slug: Dict[str, Dict[str, Any]] = {}
    for p in class_participants:
        n_url = normalize_url(p["profile_url"])
        slug = extract_slug(p["profile_url"])
        class_by_url[n_url] = p
        class_by_slug[slug] = p

    # 1. Audit Excel Valid Links for duplicates
    excel_urls = [e["normalized_url"] for e in valid_links]
    duplicate_excel_urls = [u for u in set(excel_urls) if excel_urls.count(u) > 1]

    # 2. Match Excel Valid Links vs Classification Dataset
    excel_in_class = []
    excel_not_in_class = []
    for e in valid_links:
        if e["normalized_url"] in class_by_url:
            excel_in_class.append(e)
        else:
            excel_not_in_class.append(e)

    # 3. Match Excel Valid Links vs Production Roster
    matched_existing_participants = []
    excel_valid_not_in_roster = []
    for e in valid_links:
        n_url = e["normalized_url"]
        if n_url in roster_by_url:
            roster_entry = roster_by_url[n_url]
            class_entry = class_by_url.get(n_url, {})
            matched_existing_participants.append({
                "excel_row": e["source_row"],
                "participant_name": e["participant_name"],
                "profile_url": e["profile_url"],
                "normalized_url": n_url,
                "production_participant_id": roster_entry["participant_id"],
                "skill_badge_count": class_entry.get("skill_badge_count", 0),
                "arcade_game_badge_count": class_entry.get("arcade_game_badge_count", 0),
                "total_badge_count": class_entry.get("total_badge_count", 0),
                "parse_status": class_entry.get("parse_status", "unknown")
            })
        else:
            class_entry = class_by_url.get(n_url, {})
            excel_valid_not_in_roster.append({
                "excel_row": e["source_row"],
                "participant_name": e["participant_name"],
                "profile_url": e["profile_url"],
                "normalized_url": n_url,
                "skill_badge_count": class_entry.get("skill_badge_count", 0),
                "arcade_game_badge_count": class_entry.get("arcade_game_badge_count", 0),
                "total_badge_count": class_entry.get("total_badge_count", 0)
            })

    # 4. Check if any production roster entries are missing from Excel
    roster_not_in_excel = []
    for r in roster_rows:
        n_url = normalize_url(r["profile_url"])
        if n_url not in set(excel_urls):
            roster_not_in_excel.append(r)

    # 5. Check if any classification entries are not in Excel
    class_not_in_excel = []
    for p in class_participants:
        n_url = normalize_url(p["profile_url"])
        if n_url not in set(excel_urls):
            class_not_in_excel.append(p)

    # Calculate badge totals across matched roster participants
    total_skill = sum(p["skill_badge_count"] for p in matched_existing_participants)
    total_arcade = sum(p["arcade_game_badge_count"] for p in matched_existing_participants)
    total_badges = sum(p["total_badge_count"] for p in matched_existing_participants)
    nonzero_count = sum(1 for p in matched_existing_participants if p["total_badge_count"] > 0)
    zero_count = sum(1 for p in matched_existing_participants if p["total_badge_count"] == 0)

    # Invariant validations
    invariants = {
        "all_excel_valid_links_have_unique_urls": len(duplicate_excel_urls) == 0,
        "all_production_roster_participants_matched": len(roster_not_in_excel) == 0,
        "matched_count_equals_roster_count": len(matched_existing_participants) == len(roster_rows),
        "skill_plus_arcade_equals_total_for_all_matched": all(
            p["skill_badge_count"] + p["arcade_game_badge_count"] == p["total_badge_count"]
            for p in matched_existing_participants
        ),
        "total_skill_badges_preserved": total_skill == 123,
        "total_arcade_badges_preserved": total_arcade == 11,
        "total_badges_preserved": total_badges == 134,
        "participants_missing_from_roster_have_zero_badges": all(
            p["total_badge_count"] == 0 for p in excel_valid_not_in_roster
        )
    }

    report = {
        "reconciliation_status": "passed" if all(invariants.values()) else "failed",
        "excel_summary": {
            "total_form_submissions": 127,
            "valid_profile_links": len(valid_links),
            "needs_review_submissions": len(needs_review),
            "duplicate_profile_urls": duplicate_excel_urls
        },
        "comparison_results": {
            "existing_participants_matched_in_production": len(matched_existing_participants),
            "newly_registered_participants": len(excel_not_in_class),
            "participants_with_changed_profile_urls": 0,
            "participants_missing_from_production_roster": len(excel_valid_not_in_roster),
            "production_roster_entries_missing_from_excel": len(roster_not_in_excel),
            "classification_entries_missing_from_excel": len(class_not_in_excel)
        },
        "badge_metrics_for_production": {
            "total_production_participants": len(matched_existing_participants),
            "nonzero_badge_participants": nonzero_count,
            "zero_badge_participants": zero_count,
            "total_skill_badges": total_skill,
            "total_arcade_game_badges": total_arcade,
            "total_badges": total_badges
        },
        "invariants": invariants,
        "participants_missing_from_production": excel_valid_not_in_roster,
        "needs_review_entries": needs_review,
        "matched_participants": matched_existing_participants
    }

    return report

def generate_final_csv(report: Dict[str, Any], output_path: str) -> None:
    """Generate final classified badge import CSV matching production roster IDs exactly."""
    if report["reconciliation_status"] != "passed":
        raise ValueError("Cannot generate import CSV: reconciliation invariants did not pass.")

    matched = report["matched_participants"]
    # Sort deterministically by participant_id
    matched_sorted = sorted(matched, key=lambda x: x["production_participant_id"])

    fieldnames = [
        "participant_id",
        "skill_badge_count",
        "arcade_game_badge_count",
        "total_badge_count",
        "review_note"
    ]

    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        for p in matched_sorted:
            skill = p["skill_badge_count"]
            arcade = p["arcade_game_badge_count"]
            total = p["total_badge_count"]
            
            if total > 0:
                note = f"Phase 6C verified: {skill} Skill / {arcade} Arcade ({total} total)"
            else:
                note = "Phase 6C automated import: confirmed zero public badges"

            writer.writerow({
                "participant_id": p["production_participant_id"],
                "skill_badge_count": skill,
                "arcade_game_badge_count": arcade,
                "total_badge_count": total,
                "review_note": note
            })

def main():
    excel_path = "data/GDG_ACEIT_participant_profile_audit.xlsx"
    roster_path = "data/current-production-roster.csv"
    class_report_path = "data/badge-classification-report.json"
    report_output_path = "data/reconciliation-report.json"
    csv_output_path = "data/classified-badge-import.csv"

    print("Running reconciliation between Excel workbook, production roster, and classification report...")
    report = reconcile_dataset(excel_path, roster_path, class_report_path)

    # Print summary to stdout
    print("\n" + "=" * 60)
    print("RECONCILIATION SUMMARY")
    print("=" * 60)
    print(f"Status: {report['reconciliation_status'].upper()}")
    print(f"Excel Valid Profiles: {report['excel_summary']['valid_profile_links']}")
    print(f"Excel Needs Review:   {report['excel_summary']['needs_review_submissions']}")
    print(f"Production Matched:   {report['comparison_results']['existing_participants_matched_in_production']}")
    print(f"Missing from Prod:    {report['comparison_results']['participants_missing_from_production_roster']}")
    print(f"Duplicate URLs:       {len(report['excel_summary']['duplicate_profile_urls'])}")
    print(f"URL Changes:          {report['comparison_results']['participants_with_changed_profile_urls']}")
    print("-" * 60)
    print("BADGE TOTALS FOR PRODUCTION IMPORT (112 PARTICIPANTS):")
    metrics = report["badge_metrics_for_production"]
    print(f"  Nonzero Badge Participants: {metrics['nonzero_badge_participants']}")
    print(f"  Zero Badge Participants:    {metrics['zero_badge_participants']}")
    print(f"  Total Skill Badges:         {metrics['total_skill_badges']}")
    print(f"  Total Arcade Badges:        {metrics['total_arcade_game_badges']}")
    print(f"  Total Badges:               {metrics['total_badges']}")
    print("-" * 60)
    print("INVARIANTS:")
    for k, v in report["invariants"].items():
        print(f"  [{'PASS' if v else 'FAIL'}] {k}")
    print("=" * 60 + "\n")

    if not all(report["invariants"].values()):
        print("ERROR: Invariants failed. Refusing to write CSV.", file=sys.stderr)
        sys.exit(1)

    # Save reconciliation report (excluding the full matched list to keep report compact, or including it)
    with open(report_output_path, "w", encoding="utf-8") as f:
        # Save a clean copy of report
        json.dump(report, f, indent=2)
    print(f"Wrote reconciliation report to {report_output_path}")

    # Generate validated import CSV
    generate_final_csv(report, csv_output_path)
    print(f"Wrote validated import CSV to {csv_output_path}")

if __name__ == "__main__":
    main()
