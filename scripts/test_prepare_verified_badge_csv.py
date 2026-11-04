import csv
import json
import tempfile
import unittest
from pathlib import Path

from scripts.prepare_verified_badge_csv import InputError, normalized_profile_id, prepare

ID_ONE = "11111111-1111-4111-8111-111111111111"
ID_TWO = "22222222-2222-4222-8222-222222222222"
PROFILE_ONE = "https://www.skills.google/public_profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
PROFILE_TWO = "https://cloudskillsboost.google/public_profiles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


class PrepareVerifiedBadgeCsvTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.roster = self.root / "roster.csv"
        self.source = self.root / "source.csv"
        self.roster.write_text(
            f"participant_id,profile_url\n{ID_ONE},{PROFILE_ONE}\n{ID_TWO},{PROFILE_TWO}\n",
            encoding="utf-8",
        )

    def tearDown(self):
        self.temp.cleanup()

    def write_source(self, rows, header="profile_url,verified_badge_count,review_note"):
        with self.source.open("w", encoding="utf-8", newline="") as output:
            writer = csv.writer(output)
            writer.writerow(header.split(","))
            writer.writerows(rows)

    def test_normalizes_allowed_profile_hosts_to_profile_uuid(self):
        self.assertEqual(normalized_profile_id(PROFILE_ONE), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        self.assertEqual(normalized_profile_id(PROFILE_TWO), "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")

    def test_prepares_zero_and_positive_counts_with_participant_uuids(self):
        self.write_source([[PROFILE_ONE, "0", "Reviewed as zero"], [PROFILE_TWO, "12", "Reviewed credential evidence"]])
        clean, report, skipped = prepare(self.roster, self.source)
        self.assertEqual(clean, [
            {"participant_id": ID_ONE, "verified_badge_count": "0", "review_note": "Reviewed as zero"},
            {"participant_id": ID_TWO, "verified_badge_count": "12", "review_note": "Reviewed credential evidence"},
        ])
        self.assertEqual(report["clean_rows"], 2)
        self.assertEqual(skipped, [])

    def test_rejects_unsafe_urls_and_invalid_counts_or_notes(self):
        self.write_source([
            ["http://skills.google/public_profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "1", "note"],
            [PROFILE_ONE, "-1", "note"], [PROFILE_ONE, "1.5", "note"], [PROFILE_ONE, "10001", "note"],
            [PROFILE_ONE, "1", ""],
        ])
        clean, report, skipped = prepare(self.roster, self.source)
        self.assertEqual(clean, [])
        self.assertEqual(report["skipped_rows"], 5)
        self.assertEqual(len(skipped), 5)
        self.assertNotIn(PROFILE_ONE, json.dumps(report))

    def test_duplicate_profiles_and_conflicting_counts_exclude_all_rows(self):
        self.write_source([[PROFILE_ONE, "2", "note"], [PROFILE_ONE + "/", "2", "note again"],
                           [PROFILE_TWO, "3", "note"], [PROFILE_TWO + "/", "4", "conflict"]])
        clean, report, skipped = prepare(self.roster, self.source)
        self.assertEqual(clean, [])
        self.assertEqual([row["reason_code"] for row in skipped], ["duplicate_profile", "duplicate_profile", "conflicting_counts", "conflicting_counts"])

    def test_unknown_and_duplicate_roster_profiles_are_not_assigned(self):
        self.write_source([["https://skills.google/public_profiles/cccccccc-cccc-4ccc-8ccc-cccccccccccc", "1", "note"],
                           [PROFILE_ONE, "2", "note"]])
        self.roster.write_text(f"participant_id,profile_url\n{ID_ONE},{PROFILE_ONE}\n{ID_TWO},{PROFILE_ONE}/\n", encoding="utf-8")
        clean, _, skipped = prepare(self.roster, self.source)
        self.assertEqual(clean, [])
        self.assertEqual([row["reason_code"] for row in skipped], ["unknown_profile", "ambiguous_roster_profile"])

    def test_bad_schema_and_more_than_500_rows_fail_closed(self):
        self.write_source([[PROFILE_ONE, "1", "note"]], header="url,count,note")
        with self.assertRaisesRegex(InputError, "unexpected_headers"):
            prepare(self.roster, self.source)
        self.write_source([[PROFILE_ONE, "1", "note"] for _ in range(501)])
        with self.assertRaisesRegex(InputError, "row_limit_exceeded"):
            prepare(self.roster, self.source)


if __name__ == "__main__":
    unittest.main()
