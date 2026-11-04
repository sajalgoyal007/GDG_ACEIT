import csv
import json
import tempfile
import unittest
from pathlib import Path

from scripts.ingest_organizer_report import (
    IngestionError,
    ingest,
    normalized_profile_id,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "organizer-reports"

PROFILE_1 = "https://www.skills.google/public_profiles/11111111-1111-4111-8111-111111111111"
PROFILE_2 = "https://cloudskillsboost.google/public_profiles/22222222-2222-4222-8222-222222222222"
PROFILE_3 = "https://skills.google/public_profiles/33333333-3333-4333-8333-333333333333"


class IngestOrganizerReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.report_file = self.root / "report.csv"
        self.mapping_file = self.root / "mapping.csv"

    def tearDown(self):
        self.temp.cleanup()

    def write_report(self, headers: list[str], rows: list[list[str]]):
        with self.report_file.open("w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(headers)
            writer.writerows(rows)

    def write_mapping(self, rows: list[list[str]]):
        with self.mapping_file.open("w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["participant_uuid", "participant_name", "profile_url", "match_status"])
            writer.writerows(rows)

    # 1. URL Normalization
    def test_normalizes_urls_and_extracts_uuids(self):
        canon1, uid1 = normalized_profile_id(PROFILE_1)
        self.assertEqual(uid1, "11111111-1111-4111-8111-111111111111")
        self.assertEqual(canon1, "https://www.skills.google/public_profiles/11111111-1111-4111-8111-111111111111")

        # CloudSkillsBoost host normalized to skills.google
        canon2, uid2 = normalized_profile_id(PROFILE_2)
        self.assertEqual(uid2, "22222222-2222-4222-8222-222222222222")
        self.assertEqual(canon2, "https://www.skills.google/public_profiles/22222222-2222-4222-8222-222222222222")

    def test_trailing_slashes_and_whitespace(self):
        url_with_slash = f"{PROFILE_3}/  "
        canon, uid = normalized_profile_id(url_with_slash)
        self.assertEqual(uid, "33333333-3333-4333-8333-333333333333")
        self.assertEqual(canon, "https://www.skills.google/public_profiles/33333333-3333-4333-8333-333333333333")

    # 2. Valid CSV with separate skill and arcade game counts
    def test_valid_csv_with_separate_counts(self):
        self.write_report(
            ["Student Name", "Email", "Public Profile URL", "Skill Badges Completed Count", "Arcade Games Completed Count"],
            [
                ["Alice", "alice@example.com", PROFILE_1, "10", "4"],
                ["Bob", "bob@example.com", PROFILE_2, "5", "0"],
            ],
        )
        clean, summary, issues = ingest(self.report_file)
        self.assertEqual(len(clean), 2)
        self.assertEqual(summary["count_strategy"], "separate_skill_and_game_sum")
        self.assertEqual(clean[0]["verified_badge_count"], "14")
        self.assertEqual(clean[1]["verified_badge_count"], "5")
        self.assertIn("10 skill badges, 4 arcade games", clean[0]["review_note"])
        self.assertEqual(len(issues), 0)

    # 3. Valid CSV with single total count
    def test_valid_csv_with_total_count(self):
        self.write_report(
            ["Learner Name", "Profile Link", "Total Badges Completed"],
            [
                ["Charlie", PROFILE_1, "12"],
            ],
        )
        clean, summary, issues = ingest(self.report_file)
        self.assertEqual(len(clean), 1)
        self.assertEqual(summary["count_strategy"], "total_badge_count")
        self.assertEqual(clean[0]["verified_badge_count"], "12")
        self.assertIn("12 total badges", clean[0]["review_note"])

    # 4. Missing badge-count columns MUST fail explicitly without estimating
    def test_missing_badge_count_columns_fails_explicitly(self):
        self.write_report(
            ["Student Name", "Email", "Public Profile URL"],
            [
                ["Sameer", "sameer@example.com", PROFILE_1],
            ],
        )
        with self.assertRaises(IngestionError) as ctx:
            ingest(self.report_file)
        self.assertIn("NO_BADGE_COUNTS_IN_REPORT", str(ctx.exception))
        self.assertIn("cannot be estimated or fabricated", str(ctx.exception))

    # 5. Empty and blank counts
    def test_empty_counts_excluded_as_issues(self):
        self.write_report(
            ["Learner Name", "Profile URL", "Verified Badge Count"],
            [
                ["Valid User", PROFILE_1, "8"],
                ["Empty User", PROFILE_2, ""],
                ["Whitespace User", PROFILE_3, "   "],
            ],
        )
        clean, summary, issues = ingest(self.report_file)
        self.assertEqual(len(clean), 1)
        self.assertEqual(clean[0]["verified_badge_count"], "8")
        missing_issues = [i for i in issues if i["code"] == "missing_badge_count"]
        self.assertEqual(len(missing_issues), 2)

    # 6. Duplicate profiles and conflicting counts
    def test_duplicate_profiles_and_conflicts_excluded(self):
        self.write_report(
            ["Name", "Profile URL", "Badge Count"],
            [
                ["Unique User", PROFILE_1, "5"],
                ["Dup Same 1", PROFILE_2, "10"],
                ["Dup Same 2", PROFILE_2, "10"],
                ["Conflict 1", PROFILE_3, "3"],
                ["Conflict 2", PROFILE_3, "7"],
            ],
        )
        clean, summary, issues = ingest(self.report_file)
        # Only PROFILE_1 is clean
        self.assertEqual(len(clean), 1)
        self.assertEqual(clean[0]["profile_url"], "https://www.skills.google/public_profiles/11111111-1111-4111-8111-111111111111")
        issue_codes = {i["code"] for i in issues}
        self.assertIn("duplicate_profile", issue_codes)
        self.assertIn("conflicting_counts", issue_codes)

    # 7. Invalid URLs rejected
    def test_invalid_urls_rejected(self):
        self.write_report(
            ["Name", "Profile URL", "Badge Count"],
            [
                ["Evil Domain", "https://evil.com/public_profiles/11111111-1111-4111-8111-111111111111", "5"],
                ["HTTP Protocol", "http://www.skills.google/public_profiles/11111111-1111-4111-8111-111111111111", "5"],
                ["With Query", f"{PROFILE_1}?utm_source=test", "5"],
                ["Malformed Path", "https://www.skills.google/user/invalid", "5"],
            ],
        )
        clean, summary, issues = ingest(self.report_file)
        self.assertEqual(len(clean), 0)
        invalid_issues = [i for i in issues if i["code"] == "invalid_profile_url"]
        self.assertEqual(len(invalid_issues), 4)

    # 8. Unmatched participants with mapping
    def test_reconciles_against_participant_mapping(self):
        self.write_mapping([
            ["uuid-1", "Alice", PROFILE_1, "matched"],
            ["uuid-2", "Bob", PROFILE_2, "matched"],
        ])
        self.write_report(
            ["Name", "Profile URL", "Badge Count"],
            [
                ["Alice", PROFILE_1, "10"],
                ["Charlie (Not in mapping)", PROFILE_3, "15"],
            ],
        )
        clean, summary, issues = ingest(self.report_file, self.mapping_file)
        self.assertEqual(len(clean), 2)
        roster_stat = summary["roster_matching"]
        self.assertEqual(roster_stat["matched_count"], 1)
        self.assertEqual(roster_stat["unmatched_count"], 1)
        self.assertEqual(roster_stat["missing_from_report_count"], 1)

    # 9. Different header naming conventions
    def test_flexible_header_naming_conventions(self):
        # Indonesian column names from ArcadeTrack2026
        self.write_report(
            ["nama", "link profil", "keahlian", "game"],
            [
                ["Budi", PROFILE_1, "6", "2"],
            ],
        )
        clean, summary, issues = ingest(self.report_file)
        self.assertEqual(len(clean), 1)
        self.assertEqual(clean[0]["verified_badge_count"], "8")


if __name__ == "__main__":
    unittest.main()

