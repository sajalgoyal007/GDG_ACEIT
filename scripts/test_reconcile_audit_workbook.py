import unittest
import os
import json
import csv
from scripts.reconcile_audit_workbook import (
    normalize_url,
    extract_slug,
    read_excel_workbook,
    reconcile_dataset,
    generate_final_csv
)

class TestReconcileAuditWorkbook(unittest.TestCase):
    def setUp(self):
        self.excel_path = "data/GDG_ACEIT_participant_profile_audit.xlsx"
        self.roster_path = "data/current-production-roster.csv"
        self.class_report_path = "data/badge-classification-report.json"

    def test_normalize_url(self):
        url1 = "https://www.skills.google/public_profiles/a65f959b-6c39-4f2b-b5b9-29f230189cf4"
        url2 = "https://www.skills.google/public_profiles/A65F959B-6C39-4F2B-B5B9-29F230189CF4/"
        url3 = "http://skills.google/public_profiles/a65f959b-6c39-4f2b-b5b9-29f230189cf4"
        expected = "https://www.skills.google/public_profiles/a65f959b-6c39-4f2b-b5b9-29f230189cf4"
        self.assertEqual(normalize_url(url1), expected)
        self.assertEqual(normalize_url(url2), expected)
        self.assertEqual(normalize_url(url3), expected)

    def test_extract_slug(self):
        url = "https://www.skills.google/public_profiles/c8f32095-a494-4115-95a8-c55606a0a8c0"
        self.assertEqual(extract_slug(url), "c8f32095-a494-4115-95a8-c55606a0a8c0")

    def test_excel_workbook_sheets(self):
        valid, needs_review, summary = read_excel_workbook(self.excel_path)
        self.assertEqual(len(valid), 114, "Sheet 1 must have exactly 114 valid profile links")
        self.assertEqual(len(needs_review), 13, "Sheet 2 must have exactly 13 needs-review submissions")
        self.assertTrue(len(summary) >= 4, "Sheet 3 must have summary metrics")

    def test_reconcile_invariants(self):
        report = reconcile_dataset(self.excel_path, self.roster_path, self.class_report_path)
        self.assertEqual(report["reconciliation_status"], "passed")
        
        # Exact counts
        self.assertEqual(report["excel_summary"]["valid_profile_links"], 114)
        self.assertEqual(report["excel_summary"]["needs_review_submissions"], 13)
        self.assertEqual(len(report["excel_summary"]["duplicate_profile_urls"]), 0)
        
        # Production matches
        self.assertEqual(report["comparison_results"]["existing_participants_matched_in_production"], 112)
        self.assertEqual(report["comparison_results"]["participants_missing_from_production_roster"], 2)
        self.assertEqual(report["comparison_results"]["newly_registered_participants"], 0)
        self.assertEqual(report["comparison_results"]["participants_with_changed_profile_urls"], 0)
        
        # Badge metrics
        metrics = report["badge_metrics_for_production"]
        self.assertEqual(metrics["total_production_participants"], 112)
        self.assertEqual(metrics["nonzero_badge_participants"], 24)
        self.assertEqual(metrics["zero_badge_participants"], 88)
        self.assertEqual(metrics["total_skill_badges"], 123)
        self.assertEqual(metrics["total_arcade_game_badges"], 11)
        self.assertEqual(metrics["total_badges"], 134)
        self.assertEqual(metrics["total_skill_badges"] + metrics["total_arcade_game_badges"], metrics["total_badges"])

    def test_missing_participants_have_zero_badges(self):
        report = reconcile_dataset(self.excel_path, self.roster_path, self.class_report_path)
        missing = report["participants_missing_from_production"]
        self.assertEqual(len(missing), 2)
        missing_names = {p["participant_name"] for p in missing}
        self.assertEqual(missing_names, {"ABHINANDAN JAIN", "Nishant"})
        for p in missing:
            self.assertEqual(p["skill_badge_count"], 0)
            self.assertEqual(p["arcade_game_badge_count"], 0)
            self.assertEqual(p["total_badge_count"], 0)

    def test_generated_csv_validation(self):
        report = reconcile_dataset(self.excel_path, self.roster_path, self.class_report_path)
        test_csv_path = "data/test-reconciled-classified-import.csv"
        try:
            generate_final_csv(report, test_csv_path)
            with open(test_csv_path, "r", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))

            self.assertEqual(len(rows), 112)
            self.assertEqual(list(rows[0].keys()), [
                "participant_id",
                "skill_badge_count",
                "arcade_game_badge_count",
                "total_badge_count",
                "review_note"
            ])

            # Invariants across every row
            ids = set()
            for r in rows:
                p_id = r["participant_id"]
                self.assertNotIn(p_id, ids, f"Duplicate participant ID {p_id}")
                ids.add(p_id)
                s = int(r["skill_badge_count"])
                a = int(r["arcade_game_badge_count"])
                t = int(r["total_badge_count"])
                self.assertEqual(s + a, t, f"Sum mismatch for row {p_id}")

            self.assertEqual(sum(int(r["skill_badge_count"]) for r in rows), 123)
            self.assertEqual(sum(int(r["arcade_game_badge_count"]) for r in rows), 11)
            self.assertEqual(sum(int(r["total_badge_count"]) for r in rows), 134)

        finally:
            if os.path.exists(test_csv_path):
                os.remove(test_csv_path)

if __name__ == "__main__":
    unittest.main()

