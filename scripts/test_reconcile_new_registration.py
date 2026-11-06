import unittest
import os
import json
import csv
from scripts.reconcile_new_registration import (
    parse_new_registration_workbook,
    normalize_url,
    extract_slug,
    run_reconciliation
)

class TestReconcileNewRegistration(unittest.TestCase):
    def setUp(self):
        self.excel_path = "data/latest-registration-responses.xlsx"

    def test_parse_new_registration_workbook(self):
        valid, invalid = parse_new_registration_workbook(self.excel_path)
        self.assertEqual(len(valid), 115, "Expected exactly 115 valid profile submissions")
        self.assertEqual(len(invalid), 13, "Expected exactly 13 invalid profile submissions")
        self.assertEqual(len(valid) + len(invalid), 128, "Total submissions must be 128")

    def test_all_13_invalid_submissions_accounted_for(self):
        _, invalid = parse_new_registration_workbook(self.excel_path)
        self.assertEqual(len(invalid), 13)
        rows = [inv["excel_row"] for inv in invalid]
        expected_rows = [2, 6, 17, 29, 30, 44, 57, 59, 64, 90, 91, 123, 128]
        self.assertEqual(rows, expected_rows)

        # Verify no email exposure in invalid report
        for inv in invalid:
            self.assertNotIn("@", inv["submitted_profile_link"], "Emails must be redacted to protect PII")

    def test_navya_shah_identified(self):
        valid, _ = parse_new_registration_workbook(self.excel_path)
        navya = [v for v in valid if v["slug"] == "8cca2507-a840-4eba-936d-5146c0eeba17"]
        self.assertEqual(len(navya), 1)
        self.assertEqual(navya[0]["excel_row"], 129)
        self.assertEqual(navya[0]["participant_name"].lower(), "navya shah")

    def test_reconciliation_invariants(self):
        res = run_reconciliation()
        self.assertEqual(len(res["matched_in_roster"]), 112)
        self.assertEqual(len(res["absent_from_roster"]), 3)
        self.assertEqual(len(res["new_participants"]), 1)
        self.assertEqual(len(res["duplicates"]), 0)
        self.assertEqual(len(res["url_changes"]), 0)
        self.assertEqual(res["total_skill"], 123)
        self.assertEqual(res["total_arcade"], 11)
        self.assertEqual(res["total_badges"], 134)
        self.assertEqual(res["total_skill"] + res["total_arcade"], res["total_badges"])

    def test_final_csv_and_validation_json_exist(self):
        with open("data/classified-badge-import.csv", "r", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        # Final 195-participant roster verified on 2026-11-06.
        self.assertEqual(len(rows), 195)
        self.assertEqual(list(rows[0].keys()), [
            "participant_id",
            "skill_badge_count",
            "arcade_game_badge_count",
            "total_badge_count",
            "review_note"
        ])

        with open("data/classified-badge-import-validation.json", "r", encoding="utf-8") as f:
            val = json.load(f)
        self.assertEqual(val["validation_status"], "passed")
        self.assertEqual(val["import_rows"], 195)
        self.assertEqual(val["distinct_import_ids"], 195)
        self.assertTrue(val["sum_invariant_valid"])
        self.assertEqual(val["proposed_public_totals_after_removal"], {
            "skill": 200,
            "arcade": 16,
            "total": 216,
        })

        with open("data/invalid-profile-submissions-report.json", "r", encoding="utf-8") as f:
            inv_rep = json.load(f)
        self.assertEqual(inv_rep["total_invalid_submissions"], 13)

    def test_final_import_covers_manifest_and_excludes_removals(self):
        # The finalized roster manifest and removal proposals are the source of
        # truth; the import must cover every final participant exactly once and
        # must never contain a participant proposed for removal.
        with open("data/final-reconciliation-05nov-2026/participant-manifest.csv", "r", encoding="utf-8") as f:
            manifest_rows = list(csv.DictReader(f))
        manifest_ids = {r["participant_id"] for r in manifest_rows}
        self.assertEqual(len(manifest_rows), 195)
        self.assertEqual(len(manifest_ids), 195)

        with open("data/final-reconciliation-05nov-2026/removal-proposals.csv", "r", encoding="utf-8") as f:
            removal_ids = {r["participant_id"] for r in csv.DictReader(f)}
        self.assertEqual(len(removal_ids), 7)

        with open("data/classified-badge-import.csv", "r", encoding="utf-8") as f:
            import_rows = list(csv.DictReader(f))
        by_id = {r["participant_id"]: r for r in import_rows}
        self.assertEqual(len(import_rows), 195)
        self.assertEqual(len(by_id), 195)
        self.assertEqual(set(by_id), manifest_ids)
        self.assertFalse(set(by_id) & removal_ids)

        # Navya Shah is now included with her verified classified counts.
        navya = by_id["e38a50d0-3232-461e-924f-df2ccc997d53"]
        self.assertEqual(int(navya["skill_badge_count"]), 10)
        self.assertEqual(int(navya["arcade_game_badge_count"]), 0)
        self.assertEqual(int(navya["total_badge_count"]), 10)

        total_skill = total_arcade = total_badges = 0
        for row in import_rows:
            skill = int(row["skill_badge_count"])
            arcade = int(row["arcade_game_badge_count"])
            total = int(row["total_badge_count"])
            self.assertEqual(skill + arcade, total)
            total_skill += skill
            total_arcade += arcade
            total_badges += total
        self.assertEqual((total_skill, total_arcade, total_badges), (200, 16, 216))

if __name__ == "__main__":
    unittest.main()

