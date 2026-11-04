import csv
import json
import tempfile
import unittest
from pathlib import Path

from scripts.generate_review_roster import (
    DEFAULT_MAPPING_PATH,
    ValidationError,
    generate_workspaces,
    load_and_validate_mapping,
    validate_profile_url,
)

UUID_VALID_1 = "11111111-1111-4111-8111-111111111111"
UUID_VALID_2 = "22222222-2222-4222-8222-222222222222"
UUID_VALID_3 = "33333333-3333-4333-8333-333333333333"
PROFILE_VALID_1 = "https://www.skills.google/public_profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
PROFILE_VALID_2 = "https://cloudskillsboost.google/public_profiles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
PROFILE_VALID_3 = "https://skills.google/public_profiles/cccccccc-cccc-4ccc-8ccc-cccccccccccc"


class GenerateReviewRosterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.mapping_file = self.root / "test-mapping.csv"
        self.source_out = self.root / "source.csv"
        self.workspace_out = self.root / "workspace.csv"

    def tearDown(self):
        self.temp.cleanup()

    def write_mapping(self, rows: list[list[str]]):
        with self.mapping_file.open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["participant_uuid", "participant_name", "profile_url", "match_status"])
            writer.writerows(rows)

    # 1. 114 valid participant records from default mapping
    def test_default_mapping_has_114_valid_records(self):
        if not DEFAULT_MAPPING_PATH.exists():
            self.skipTest(f"Default mapping file not found at {DEFAULT_MAPPING_PATH}")

        count, src, ws = generate_workspaces(
            DEFAULT_MAPPING_PATH,
            self.source_out,
            self.workspace_out,
        )
        self.assertEqual(count, 114)

        with self.source_out.open("r", encoding="utf-8-sig") as f:
            src_rows = list(csv.DictReader(f))
        self.assertEqual(len(src_rows), 114)
        self.assertTrue(all(r["verified_badge_count"] == "" for r in src_rows))
        self.assertTrue(all(r["review_status"] == "pending" for r in src_rows))

        with self.workspace_out.open("r", encoding="utf-8-sig") as f:
            ws_rows = list(csv.DictReader(f))
        self.assertEqual(len(ws_rows), 114)
        self.assertEqual(ws_rows[0]["serial_number"], "1")
        self.assertEqual(ws_rows[-1]["serial_number"], "114")

    # 2. Duplicate UUID rejection
    def test_duplicate_uuid_rejection(self):
        self.write_mapping([
            [UUID_VALID_1, "Alice", PROFILE_VALID_1, "matched"],
            [UUID_VALID_1, "Alice Clone", PROFILE_VALID_2, "matched"],
        ])
        with self.assertRaises(ValidationError) as ctx:
            load_and_validate_mapping(self.mapping_file)
        self.assertIn("Duplicate participant UUID", str(ctx.exception))

    # 3. Duplicate profile URL rejection
    def test_duplicate_profile_url_rejection(self):
        self.write_mapping([
            [UUID_VALID_1, "Alice", PROFILE_VALID_1, "matched"],
            [UUID_VALID_2, "Bob", PROFILE_VALID_1, "matched"],
        ])
        with self.assertRaises(ValidationError) as ctx:
            load_and_validate_mapping(self.mapping_file)
        self.assertIn("Duplicate profile URL", str(ctx.exception))

    # 4. Invalid URL rejection
    def test_invalid_url_rejection(self):
        # Arbitrary domain
        self.write_mapping([[UUID_VALID_1, "Alice", "https://evil.com/public_profiles/abc", "matched"]])
        with self.assertRaises(ValidationError) as ctx:
            load_and_validate_mapping(self.mapping_file)
        self.assertIn("Invalid profile URL", str(ctx.exception))

        # HTTP scheme
        self.write_mapping([[UUID_VALID_1, "Alice", "http://www.skills.google/public_profiles/abc", "matched"]])
        with self.assertRaises(ValidationError) as ctx:
            load_and_validate_mapping(self.mapping_file)
        self.assertIn("Invalid profile URL", str(ctx.exception))

        # URL with query
        self.write_mapping([[UUID_VALID_1, "Alice", f"{PROFILE_VALID_1}?query=1", "matched"]])
        with self.assertRaises(ValidationError) as ctx:
            load_and_validate_mapping(self.mapping_file)
        self.assertIn("Invalid profile URL", str(ctx.exception))

    # 5. Missing UUID rejection
    def test_missing_or_malformed_uuid_rejection(self):
        # Blank UUID
        self.write_mapping([["", "Alice", PROFILE_VALID_1, "matched"]])
        with self.assertRaises(ValidationError) as ctx:
            load_and_validate_mapping(self.mapping_file)
        self.assertIn("Missing participant UUID", str(ctx.exception))

        # Malformed UUID
        self.write_mapping([["not-a-valid-uuid", "Alice", PROFILE_VALID_1, "matched"]])
        with self.assertRaises(ValidationError) as ctx:
            load_and_validate_mapping(self.mapping_file)
        self.assertIn("Malformed participant UUID", str(ctx.exception))

    # 6. Blank badge counts strictly enforced
    def test_badge_counts_are_strictly_blank(self):
        self.write_mapping([
            [UUID_VALID_1, "Alice", PROFILE_VALID_1, "matched"],
            [UUID_VALID_2, "Bob", PROFILE_VALID_2, "matched"],
        ])
        generate_workspaces(self.mapping_file, self.source_out, self.workspace_out)

        with self.source_out.open("r", encoding="utf-8-sig") as f:
            src_rows = list(csv.DictReader(f))
        for row in src_rows:
            self.assertEqual(row["verified_badge_count"], "", "Badge count must be empty string")
            self.assertEqual(row["review_status"], "pending")

        with self.workspace_out.open("r", encoding="utf-8-sig") as f:
            ws_rows = list(csv.DictReader(f))
        for row in ws_rows:
            self.assertEqual(row["verified_badge_count"], "", "Workspace badge count must be empty string")
            self.assertEqual(row["review_status"], "pending")

    # 7. Deterministic output ordering
    def test_deterministic_output(self):
        # Input in non-alphabetical order
        self.write_mapping([
            [UUID_VALID_3, "Zara", PROFILE_VALID_3, "matched"],
            [UUID_VALID_1, "Alice", PROFILE_VALID_1, "matched"],
            [UUID_VALID_2, "Bob", PROFILE_VALID_2, "matched"],
        ])
        generate_workspaces(self.mapping_file, self.source_out, self.workspace_out)

        with self.workspace_out.open("r", encoding="utf-8-sig") as f:
            ws_rows = list(csv.DictReader(f))
        names = [r["participant_name"] for r in ws_rows]
        self.assertEqual(names, ["Alice", "Bob", "Zara"])
        self.assertEqual([r["serial_number"] for r in ws_rows], ["1", "2", "3"])

    # 8. UTF-8 participant names preserved with BOM
    def test_utf8_participant_names(self):
        unicode_name = "Shrīkanth Renuka / यशवर्धन"
        self.write_mapping([
            [UUID_VALID_1, unicode_name, PROFILE_VALID_1, "matched"],
        ])
        generate_workspaces(self.mapping_file, self.source_out, self.workspace_out)

        with self.workspace_out.open("r", encoding="utf-8-sig") as f:
            ws_rows = list(csv.DictReader(f))
        self.assertEqual(ws_rows[0]["participant_name"], unicode_name)


if __name__ == "__main__":
    unittest.main()

