#!/usr/bin/env python3
"""Unit tests for automated badge collection building and parse evaluation."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_automated_badge_collection import CSV_HEADERS, build_collection


class AutomatedBadgeCollectionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.tmp = Path(self.temp_dir.name)

        # Mock source roster
        self.source_roster = self.tmp / "source_roster.csv"
        self.source_roster.write_text(
            "participant_uuid,participant_name,profile_url,verified_badge_count,review_status,reviewer,reviewed_at,review_note\n"
            "11111111-1111-4111-8111-111111111111,Alice One,https://www.skills.google/public_profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa,,pending,,,\n"
            "22222222-2222-4222-8222-222222222222,Bob Two,https://www.skills.google/public_profiles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb,,pending,,,\n"
            "33333333-3333-4333-8333-333333333333,Charlie Three,https://www.skills.google/public_profiles/cccccccc-cccc-4ccc-8ccc-cccccccccccc,,pending,,,\n"
            "44444444-4444-4444-8444-444444444444,Dave Four,https://www.skills.google/public_profiles/dddddddd-dddd-4ddd-8ddd-dddddddddddd,,pending,,,\n",
            encoding="utf-8",
        )

        # Mock parse results
        self.parse_results = self.tmp / "parse_results.json"
        mock_data = {
            "results": {
                "11111111-1111-4111-8111-111111111111": {
                    "parseStatus": "verified_nonzero",
                    "badgeCount": 7,
                    "uniqueBadgeIds": ["1", "2", "3", "4", "5", "6", "7"],
                },
                "22222222-2222-4222-8222-222222222222": {
                    "parseStatus": "verified_zero",
                    "badgeCount": 0,
                    "uniqueBadgeIds": [],
                },
                "33333333-3333-4333-8333-333333333333": {
                    "parseStatus": "inaccessible",
                    "badgeCount": 0,
                    "details": {"reasons": ["HTTP 404 Not Found"]},
                },
                # Dave Four is intentionally omitted to simulate pending
            }
        }
        self.parse_results.write_text(json.dumps(mock_data), encoding="utf-8")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_build_collection_correctly_classifies_and_formats(self):
        output_csv = self.tmp / "automated-badge-counts.csv"
        export_3col = self.tmp / "reviewed-badge-counts.csv"

        summary = build_collection(
            parse_results_path=self.parse_results,
            source_roster_path=self.source_roster,
            output_csv_path=output_csv,
            export_3col_path=export_3col,
        )

        self.assertEqual(summary["total_participants"], 4)
        self.assertEqual(summary["successfully_verified"], 2)
        self.assertEqual(summary["verified_nonzero"], 1)
        self.assertEqual(summary["verified_zero"], 1)
        self.assertEqual(summary["unavailable_or_private"], 1)
        self.assertEqual(summary["pending"], 1)
        self.assertEqual(summary["min_verified_badge_count"], 0)
        self.assertEqual(summary["max_verified_badge_count"], 7)
        self.assertEqual(summary["avg_verified_badge_count"], 3.5)

        # Verify output CSV lines
        import csv
        with open(output_csv, "r", encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f))

        self.assertEqual(len(rows), 4)
        # Alice
        self.assertEqual(rows[0]["verified_badge_count"], "7")
        self.assertEqual(rows[0]["review_status"], "verified")
        # Bob
        self.assertEqual(rows[1]["verified_badge_count"], "0")
        self.assertEqual(rows[1]["review_status"], "verified")
        # Charlie (inaccessible)
        self.assertEqual(rows[2]["verified_badge_count"], "")
        self.assertEqual(rows[2]["review_status"], "flagged")
        # Dave (pending)
        self.assertEqual(rows[3]["verified_badge_count"], "")
        self.assertEqual(rows[3]["review_status"], "pending")

        # Verify 3col export contains only verified rows
        with open(export_3col, "r", encoding="utf-8-sig") as f:
            export_rows = list(csv.DictReader(f))

        self.assertEqual(len(export_rows), 2)
        self.assertEqual(export_rows[0]["verified_badge_count"], "7")
        self.assertEqual(export_rows[1]["verified_badge_count"], "0")


if __name__ == "__main__":
    unittest.main()

